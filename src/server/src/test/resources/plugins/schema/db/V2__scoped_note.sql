-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- A table of organizations under row-level security (MK-019), as a plugin declares it.

create table scoped_note (
    id              serial primary key,
    organization_id uuid not null default mk_kernel.current_organization(),
    text            varchar(100) not null
);

alter table scoped_note enable row level security;

create policy scoped_note_organization on scoped_note
    using (organization_id = mk_kernel.current_organization())
    with check (organization_id = mk_kernel.current_organization());
