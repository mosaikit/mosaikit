-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-019: the organization of the request, for the row-level security policies of the plugins.
-- The kernel sets it on every connection it hands out during a request (RowSecurity); outside a
-- request, and for a request without organization, it is null, so policies let no row through.

create or replace function current_organization() returns uuid
    language sql stable parallel safe
    as $$ select nullif(current_setting('mosaikit.organization', true), '')::uuid $$;
