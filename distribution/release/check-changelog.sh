#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Massimo Antonini
# SPDX-License-Identifier: MPL-2.0
#
# Fails a merge request that changes the product without an entry for the changelog (ADR-0023): a
# fragment added in changelog.d/ (see changelog.d/README.md), or, for now, an edit of CHANGELOG.md.
# The label "no-changelog" skips it, for changes that users do not see. `npm run check:pr` runs it
# against origin/main.
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
product="$(grep -E '^(src/server/src/main|sdk/[^/]+/src|distribution/)' <<<"$changed" || true)"
if [[ -z "$product" ]]; then
  echo "No change to the product."
  exit 0
fi
# A fragment that the merge request adds or changes (README.md describes the directory).
fragments="$(git diff --name-only --diff-filter=AM "$base"...HEAD -- 'changelog.d/*.md' \
  | grep -vx 'changelog.d/README.md' || true)"
if [[ -z "$fragments" ]] && ! grep -qx 'CHANGELOG.md' <<<"$changed"; then
  echo "The merge request changes the product but adds no changelog fragment:" >&2
  sed 's/^/  /' <<<"$product" >&2
  echo "Add changelog.d/<requirement or slug>.md (see changelog.d/README.md), or the label" >&2
  echo "no-changelog if users do not see the change." >&2
  exit 1
fi
if ! grep -q '^docs/' <<<"$changed"; then
  echo "Warning: no file of docs/ changes; check that the guides still describe the product."
fi
if [[ -n "$fragments" ]]; then
  echo "Changelog fragment(s): $(paste -sd ' ' <<<"$fragments")"
else
  echo "CHANGELOG.md is updated."
fi
