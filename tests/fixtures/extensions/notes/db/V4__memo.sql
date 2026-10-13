-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- Memos (MK-055): notes that only their author reads until they share them through the sharing
-- dialog of the kernel. Each memo is a registered resource of type memo; the kernel keeps who may
-- read it, the extension checks it at every request with Sharing.require.

create table memo (
    id              uuid primary key,
    organization_id uuid not null default mk_kernel.current_organization(),
    text            varchar(500) not null,
    created_at      timestamp with time zone not null
);

create index memo_organization_ix on memo (organization_id, created_at);

alter table memo enable row level security;

create policy memo_organization on memo
    using (organization_id = mk_kernel.current_organization())
    with check (organization_id = mk_kernel.current_organization());
