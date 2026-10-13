#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Massimo Antonini
# SPDX-License-Identifier: MPL-2.0
#
# Fails when the artifacts of the repository do not all carry the given version, or when a
# release version has no section in CHANGELOG.md or still has fragments in changelog.d/. Used by
# the release pipeline on tags.
#
#   check-version.sh 0.2.0
set -euo pipefail

version="${1:?usage: $0 <version>}"
cd "$(dirname "$0")/../.."
errors=0

fail() {
  echo "✗ $1" >&2
  errors=$((errors + 1))
}

# Maven: the version of a POM is its own <version> or, when absent, the one of its <parent>.
# Only the header of the POM is read, before properties, dependencies and build sections.
pom_version() {
  awk '
    /<(modules|properties|dependencyManagement|dependencies|build|profiles)>/ { exit }
    /<parent>/ { in_parent = 1 }
    /<\/parent>/ { in_parent = 0; next }
    match($0, /<version>[^<]+<\/version>/) {
      value = substr($0, RSTART + 9, RLENGTH - 19)
      if (in_parent) { parent = value } else { own = value }
    }
    END { print (own != "" ? own : parent) }
  ' "$1"
}
while IFS= read -r pom; do
  found="$(pom_version "$pom")"
  [[ "$found" == "$version" ]] || fail "$pom has version $found"
done < <(git ls-files '*pom.xml')

# npm workspaces
for pkg in sdk/js/package.json src/web/package.json; do
  found="$(node -p "require('./$pkg').version")"
  [[ "$found" == "$version" ]] || fail "$pkg has version $found"
done

# Helm chart
chart=distribution/k8s/mosaikit/Chart.yaml
grep -q "^version: $version$" "$chart" || fail "$chart version is not $version"
grep -q "^appVersion: \"$version\"$" "$chart" || fail "$chart appVersion is not $version"

# Changelog
if [[ "$version" != *-* ]]; then
  grep -q "^## \[$version\]" CHANGELOG.md || fail "CHANGELOG.md has no section for $version"
  # Fragments left in changelog.d/ would be missing from the release notes.
  left="$(git ls-files 'changelog.d/*.md' | grep -vx 'changelog.d/README.md' || true)"
  [[ -z "$left" ]] || fail "changelog.d/ still has fragments: $(paste -sd ' ' <<<"$left")"
fi

if ((errors > 0)); then
  echo "$errors problem(s). Run distribution/release/prepare.sh $version and commit." >&2
  exit 1
fi
echo "✓ every artifact is at version $version"
