-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- The activity feed of each person (MK-038): the notifications that plugins send, kept until read
-- and after, in the organization they come from.

create table notification (
    id              uuid          primary key,
    organization_id uuid          not null,
    account_id      uuid          not null,
    plugin_id       varchar(100)  not null,
    kind            varchar(64)   not null,
    title           varchar(200)  not null,
    body            varchar(1000) not null,
    link            varchar(500),
    created_at      timestamptz   not null,
    read_at         timestamptz,
    constraint notification_organization_fk foreign key (organization_id) references organization (id) on delete cascade,
    constraint notification_account_fk foreign key (account_id) references user_account (id) on delete cascade
);

create index notification_feed_ix on notification (account_id, organization_id, created_at desc);
