-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- Kernel schema: organizations and local accounts.
-- Every table lives in the kernel schema; plugins never reference it with foreign keys.

create table organization (
    id                uuid primary key,
    slug              varchar(63)  not null,
    name              varchar(120) not null,
    self_registration boolean      not null default false,
    created_at        timestamptz  not null,
    constraint organization_slug_uk unique (slug),
    constraint organization_slug_ck check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$')
);

create table user_account (
    id              uuid primary key,
    username        varchar(254) not null,
    display_name    varchar(120) not null,
    password_hash   varchar(255) not null,
    roles           varchar(255) not null,
    organization_id uuid,
    created_at      timestamptz  not null,
    constraint user_account_username_uk unique (username),
    constraint user_account_username_ck check (username = lower(username)),
    constraint user_account_organization_fk foreign key (organization_id) references organization (id)
);

create index user_account_organization_ix on user_account (organization_id);
