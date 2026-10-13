-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-015: the actions that assistants and MCP clients run on behalf of a person are audited, and
-- the actions that change data wait as drafts until the person confirms them. The audit log is
-- append-only: the kernel never updates or deletes its rows.

create table audit_event (
    id              uuid primary key,
    occurred_at     timestamptz  not null,
    actor           varchar(255) not null,
    organization_id uuid,
    action          varchar(100) not null,
    subject         varchar(255),
    outcome         varchar(20)  not null,
    detail          text
);

create index audit_event_occurred_ix on audit_event (occurred_at desc);
create index audit_event_organization_ix on audit_event (organization_id, occurred_at desc);

create table ai_action_draft (
    id              uuid primary key,
    username        varchar(255) not null,
    organization_id uuid         not null,
    tool            varchar(128) not null,
    input           text         not null,
    status          varchar(20)  not null,
    created_at      timestamptz  not null,
    expires_at      timestamptz  not null,
    decided_at      timestamptz,
    result_status   integer,
    result          text,
    version         integer      not null,
    constraint ai_action_draft_organization_fk foreign key (organization_id)
        references organization (id) on delete cascade
);

create index ai_action_draft_owner_ix on ai_action_draft (username, organization_id, status);
