#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Massimo Antonini
# SPDX-License-Identifier: MPL-2.0
#
# Fails a merge request that changes the product but neither CHANGELOG.md nor the documentation
# (ADR-0023). The label "no-changelog" skips it, for changes that users do not see.
#
#   check-changelog.sh <base commit>
set -euo pipefail

base="${1:?usage: $0 <base commit>}"
cd "$(dirname "$0")/../.."
if [[ ",${PR_LABELS:-}," == *",no-changelog,"* ]]; then
  echo "Label no-changelog: not checked."
  exit 0
fi
changed="$(git diff --name-only "$base"...HEAD)"
product="$(grep -E '^(src/server/src/main|sdk/[^/]+/src|src/plugins/|distribution/)' <<<"$changed" || true)"
if [[ -z "$product" ]]; then
  echo "No change to the product."
  exit 0
fi
if ! grep -qx 'CHANGELOG.md' <<<"$changed"; then
  echo "The merge request changes the product but not CHANGELOG.md:" >&2
  sed 's/^/  /' <<<"$product" >&2
  echo "Add an entry under ## [Unreleased], or the label no-changelog if users do not see the change." >&2
  exit 1
fi
if ! grep -q '^docs/' <<<"$changed"; then
  echo "Warning: no file of docs/ changes; check that the guides still describe the product."
fi
echo "CHANGELOG.md is updated."
