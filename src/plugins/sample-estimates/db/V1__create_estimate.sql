-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- Schema p_sample_estimates (MK-020): the field that the extension adds to activities, in a table
-- of its own keyed by the identifier of the activity. No foreign key to the schema of the
-- Activities plugin: its activities are read through its data contract, the view activity_v1.

create table estimate (
    activity_id     uuid          primary key,
    organization_id uuid          not null default mk_kernel.current_organization(),
    hours           numeric(8, 2) not null check (hours >= 0),
    updated_at      timestamptz   not null
);

alter table estimate enable row level security;

create policy estimate_organization on estimate
    using (organization_id = mk_kernel.current_organization())
    with check (organization_id = mk_kernel.current_organization());
