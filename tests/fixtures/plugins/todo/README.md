<!--
SPDX-FileCopyrightText: 2026 Massimo Antonini
SPDX-License-Identifier: MPL-2.0
-->
# To do (fixture)

An app without a backend ([ADR-0031](../../../../docs/adr/0031-frontend-plugins-on-the-data-api.md)):
its items are documents of the collection `items`, declared in `data.collections` of the manifest
and kept by the kernel for the organization of the person, under row-level security. The frontend
reads and writes them with `context.data('items')`. No Java, no schema, nothing to build: installed
from the Plugins page, it is active at once, without a restart.
