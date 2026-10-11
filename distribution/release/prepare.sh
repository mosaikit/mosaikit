#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Massimo Antonini
# SPDX-License-Identifier: MPL-2.0
#
# Sets the version of every artifact of the repository.
#
#   prepare.sh 0.2.0             release: also turns "## [Unreleased]" into "## [0.2.0] - <today>"
#   prepare.sh 0.3.0-SNAPSHOT    next development version: versions only
#
# Review the diff, commit, then tag the release with `git tag -s v0.2.0` (see docs/development/release.md).
set -euo pipefail

version="${1:-}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "usage: $0 <semantic version>, for example 0.2.0 or 0.3.0-SNAPSHOT" >&2
  exit 2
fi
cd "$(dirname "$0")/../.."

# Maven modules
./mvnw --batch-mode --quiet versions:set -DnewVersion="$version" -DgenerateBackupPoms=false -DprocessAllModules=true

# npm workspaces (the root package is private and has no version). The versions are written
# directly, together with the dependency of the kernel UI on the SDK, so that the lockfile can
# be refreshed without looking the new SDK version up in a registry.
node -e '
  const fs = require("node:fs");
  const version = process.argv[1];
  for (const file of ["sdk/js/package.json", "src/web/package.json"]) {
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
    pkg.version = version;
    if (pkg.dependencies?.["@mosaikit/sdk"]) pkg.dependencies["@mosaikit/sdk"] = version;
    fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
  }
' "$version"
npm install --package-lock-only --no-audit --no-fund >/dev/null

# Helm chart
chart=distribution/k8s/mosaikit/Chart.yaml
sed -i.bak -E "s/^version: .*/version: $version/; s/^appVersion: .*/appVersion: \"$version\"/" "$chart"
rm -f "$chart.bak"

# Changelog, only for releases
if [[ "$version" != *-SNAPSHOT ]]; then
  if grep -q "^## \[$version\]" CHANGELOG.md; then
    echo "CHANGELOG.md already has a section for $version" >&2
  else
    today="$(date +%Y-%m-%d)"
    sed -i.bak "s/^## \[Unreleased\]$/## [Unreleased]\n\n## [$version] - $today/" CHANGELOG.md
    rm -f CHANGELOG.md.bak
  fi
fi

echo "Version set to $version. Review with: git diff"
