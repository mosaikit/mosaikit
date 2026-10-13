#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Massimo Antonini
# SPDX-License-Identifier: MPL-2.0
#
# Builds the portable archives (MK-016) from the installation in target/dist/mosaikit. Run by
# ./mvnw install -Pportable, or by hand after ./mvnw install:
#
#   distribution/portable/build.sh linux-x64,windows-x64,macos-arm64,macos-x64 [output directory]
#
# Output: <output>/mosaikit-portable-<version>-<platform>.zip (Windows) or .tar.gz, and .sha256.
# The Java runtime is reduced with jlink from the jmods of the target platform (cross-linking), so
# every archive can be built on any machine; PostgreSQL comes from the zonky embedded-postgres
# binaries, repackaged on npm. Downloads are cached in target/portable-cache and verified.
# Runs on Linux, macOS and Windows (Git Bash); needs curl, tar, npm and node.
set -euo pipefail

platforms="${1:?usage: $0 <platform>[,<platform>...] [output directory]}"

# Versions (Renovate updates them).
JDK_VERSION="25.0.4.1+1"
POSTGRES_PACKAGE_VERSION="18.4.0-beta.17" # PostgreSQL 18.4

# The files of the portable archive sit next to this script, which products run too, on their own
# installation (the artifact io.github.mosaikit:mosaikit-distributions:zip:portable-tools):
#   PORTABLE_INSTALLATION  the installation to package     PORTABLE_NAME     the name of the archives
#   PORTABLE_SETTINGS      config/application.properties   PORTABLE_README   README.md of the archive
#   PORTABLE_VERSION       the version in the names        PORTABLE_CACHE    where downloads are kept
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here/../.."
root="$PWD"
installation="${PORTABLE_INSTALLATION:-$root/target/dist/mosaikit}"
cache="${PORTABLE_CACHE:-$root/target/portable-cache}"
prefix="${PORTABLE_NAME:-mosaikit-portable}"
settings="${PORTABLE_SETTINGS:-$here/application.properties}"
readme="${PORTABLE_README:-$here/README.md}"
output="${2:-$root/target/dist/$prefix}"
mkdir -p "$cache" "$output"
output="$(cd "$output" && pwd)"

kernel_jar="$(find "$installation/bin/kernel/app" -maxdepth 1 -name 'mosaikit-kernel-*.jar' 2>/dev/null | head -1)"
[[ -n "$kernel_jar" ]] || { echo "Build the installation first: ./mvnw install" >&2; exit 1; }
version="$(basename "$kernel_jar" .jar)"
version="${PORTABLE_VERSION:-${version#mosaikit-kernel-}}"

jdk_tag="jdk-${JDK_VERSION/+/%2B}"
jdk_file_version="${JDK_VERSION/+/_}"
temurin_url="https://github.com/adoptium/temurin25-binaries/releases/download/$jdk_tag"

sha256() {
  if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# Downloads a Temurin archive once and checks it against the published SHA-256.
download_temurin() {
  local name="$1" file="$cache/$1"
  if [[ ! -f "$file" ]]; then
    curl --fail --silent --show-error --location --output "$file.part" "$temurin_url/$name"
    curl --fail --silent --show-error --location --output "$file.sha256.txt" "$temurin_url/$name.sha256.txt"
    [[ "$(sha256 "$file.part")" == "$(cut -d' ' -f1 "$file.sha256.txt")" ]] \
      || { echo "checksum mismatch for $name" >&2; exit 1; }
    mv "$file.part" "$file"
  fi
  echo "$file"
}

extract() {
  local archive="$1" target="$2"
  rm -rf "$target" && mkdir -p "$target"
  case "$archive" in
    *.zip)
      if command -v unzip >/dev/null; then
        unzip -q "$archive" -d "$target"
      elif command -v powershell.exe >/dev/null; then
        # Git Bash has no unzip: let Windows extract it.
        powershell.exe -NoProfile -Command "Expand-Archive -LiteralPath '$(cygpath -w "$archive")' -DestinationPath '$(cygpath -w "$target")'"
      else
        (cd "$target" && jar xf "$archive")
      fi
      ;;
    *) tar -xzf "$archive" -C "$target" ;;
  esac
}

# 1. jlink of the host, in the same version as the target jmods.
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) host=x64_linux host_ext=tar.gz ;;
  Linux-aarch64) host=aarch64_linux host_ext=tar.gz ;;
  Darwin-arm64) host=aarch64_mac host_ext=tar.gz ;;
  Darwin-x86_64) host=x64_mac host_ext=tar.gz ;;
  MINGW*|MSYS*|CYGWIN*) host=x64_windows host_ext=zip ;;
  *) echo "unsupported build machine: $(uname -s) $(uname -m)" >&2; exit 2 ;;
esac
if [[ -n "${JLINK_JDK:-}" && -x "$JLINK_JDK/bin/jlink" ]]; then
  host_jdk="$JLINK_JDK"
else
  host_archive="$(download_temurin "OpenJDK25U-jdk_${host}_hotspot_${jdk_file_version}.${host_ext}")"
  [[ -d "$cache/host-jdk-$host" ]] || extract "$host_archive" "$cache/host-jdk-$host"
  host_jdk="$(find "$cache/host-jdk-$host" -maxdepth 1 -mindepth 1 -type d | head -1)"
  [[ "$host" != *_mac ]] || host_jdk="$host_jdk/Contents/Home"
fi
export PATH="$host_jdk/bin:$PATH"

build() {
  local platform="$1" temurin ext postgres
  case "$platform" in
    linux-x64) temurin=x64_linux ext=tar.gz postgres=linux-x64 ;;
    windows-x64) temurin=x64_windows ext=zip postgres=windows-x64 ;;
    macos-arm64) temurin=aarch64_mac ext=tar.gz postgres=darwin-arm64 ;;
    macos-x64) temurin=x64_mac ext=tar.gz postgres=darwin-x64 ;;
    *) echo "unknown platform: $platform" >&2; exit 2 ;;
  esac

  # 2. jmods of the target platform.
  local jmods_archive jmods
  jmods_archive="$(download_temurin "OpenJDK25U-jmods_${temurin}_hotspot_${jdk_file_version}.${ext}")"
  jmods="$cache/jmods-$platform"
  [[ -d "$jmods" ]] || extract "$jmods_archive" "$jmods"
  jmods="$(dirname "$(find "$jmods" -name java.base.jmod | head -1)")"

  # 3. PostgreSQL binaries of the target platform.
  local pg_cache="$cache/postgres-$platform"
  if [[ ! -d "$pg_cache/package/native" ]]; then
    rm -rf "$pg_cache" && mkdir -p "$pg_cache"
    (cd "$pg_cache" && npm pack --silent "@embedded-postgres/$postgres@$POSTGRES_PACKAGE_VERSION" >/dev/null \
      && tar -xzf ./*.tgz)
  fi

  # 4. The installation, with bin/java, bin/pgsql and the portable settings.
  local name="$prefix-$version" staging
  staging="$cache/staging-$platform/$name"
  rm -rf "$cache/staging-$platform"
  mkdir -p "$staging"
  cp -R "$installation/." "$staging/"
  cp "$settings" "$staging/config/application.properties"
  cp "$readme" "$staging/README.md"

  # --strip-debug also strips native symbols with the objcopy of the host, which reads only Linux
  # binaries: for other targets only the Java debug attributes are stripped.
  local strip=--strip-java-debug-attributes
  [[ "$platform" == linux-* && "$host" == *_linux ]] && strip=--strip-debug
  jlink --module-path "$jmods" \
    --add-modules java.se,jdk.unsupported,jdk.zipfs,jdk.naming.dns,jdk.management,jdk.charsets,jdk.localedata \
    --include-locales=en,it "$strip" --no-man-pages --no-header-files --compress=zip-6 \
    --output "$staging/bin/java"

  cp -R "$pg_cache/package/native" "$staging/bin/pgsql"
  if [[ -f "$staging/bin/pgsql/pg-symlinks.json" && "$platform" != windows-* ]]; then
    # npm cannot store symbolic links; restore the ones of the shared libraries (copies where the
    # build machine cannot create links).
    (cd "$staging/bin" && node -e '
      const fs = require("node:fs"), path = require("node:path");
      for (const { source, target } of JSON.parse(fs.readFileSync("pgsql/pg-symlinks.json", "utf8"))) {
        const link = target.replace(/^native\//, "pgsql/");
        if (fs.existsSync(link)) continue;
        try { fs.symlinkSync(path.basename(source), link); }
        catch { fs.copyFileSync(source.replace(/^native\//, "pgsql/"), link); }
      }')
  fi
  rm -f "$staging/bin/pgsql/pg-symlinks.json"
  mkdir -p "$staging/bin/licenses"
  cp "$pg_cache/package/LICENSE.md" "$staging/bin/licenses/embedded-postgres-LICENSE.md"
  cp "$here"/licenses/* "$staging/bin/licenses/"
  cp LICENSE "$staging/bin/licenses/Mosaikit-MPL-2.0.txt"

  # 5. The archive.
  local archive
  if [[ "$ext" == zip ]]; then
    archive="$output/$name-$platform.zip"
    rm -f "$archive" && (cd "$cache/staging-$platform" && jar --create --no-manifest --file "$archive" "$name")
  else
    archive="$output/$name-$platform.tar.gz"
    (cd "$cache/staging-$platform" && tar -czf "$archive" "$name")
  fi
  (cd "$output" && echo "$(sha256 "$archive")  $(basename "$archive")" > "$archive.sha256")
  rm -rf "$cache/staging-$platform"
  echo "$archive ($(du -h "$archive" | cut -f1))"
}

IFS=',' read -ra requested <<< "$platforms"
for platform in "${requested[@]}"; do
  build "$platform"
done
