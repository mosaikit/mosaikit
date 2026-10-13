-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- Row-level security (MK-019): the database itself keeps the notes of each organization apart,
-- also for queries that forget to filter. Notes without organization, written before MK-017, stay
-- hidden to every request.

alter table note alter column organization_id set default mk_kernel.current_organization();

alter table note enable row level security;

create policy note_organization on note
    using (organization_id = mk_kernel.current_organization())
    with check (organization_id = mk_kernel.current_organization());
