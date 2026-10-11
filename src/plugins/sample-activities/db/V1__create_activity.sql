-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- Schema p_sample_activities, owned by the plugin (MK-020). The table is private to the plugin;
-- other plugins read the view activity_v1, its published data contract.

create table activity (
    id              uuid primary key,
    organization_id uuid         not null default mk_kernel.current_organization(),
    title           varchar(200) not null,
    done            boolean      not null default false,
    created_at      timestamptz  not null
);

create index activity_organization_ix on activity (organization_id, created_at);

-- MK-019: each organization sees only its own activities, whatever the query.
alter table activity enable row level security;

create policy activity_organization on activity
    using (organization_id = mk_kernel.current_organization())
    with check (organization_id = mk_kernel.current_organization());

-- Version 1 of the data contract. security_invoker: the view is read with the rights and the
-- policies of the caller, so that it never shows the activities of another organization.
-- Changing it means publishing activity_v2 and keeping activity_v1 for a major version.
create view activity_v1 with (security_invoker = true) as
    select id, organization_id, title, done from activity;

comment on view activity_v1 is 'Data contract v1 of dev.mosaikit.sample.activities';
