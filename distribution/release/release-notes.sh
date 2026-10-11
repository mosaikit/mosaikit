#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Massimo Antonini
# SPDX-License-Identifier: MPL-2.0
#
# Prints the CHANGELOG.md section of a version, used as the description of the GitHub release.
#
#   release-notes.sh 0.2.0 > release-notes.md
set -euo pipefail

version="${1:?usage: $0 <version>}"
cd "$(dirname "$0")/../.."
awk -v heading="## [$version]" '
  index($0, heading) == 1 { found = 1; next }
  found && /^## \[/ { exit }
  found { print }
' CHANGELOG.md | sed '/./,$!d'
