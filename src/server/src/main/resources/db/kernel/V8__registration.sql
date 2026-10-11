-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- Local registration with the confirmation of the email address, which the platform administrator
-- can turn off.

-- When the person proved to own the address; null until a self-registered person confirms it. The
-- accounts that exist already, and those that administrators or realms create, are confirmed.
alter table user_account add column email_confirmed_at timestamptz;
update user_account set email_confirmed_at = created_at;

-- The links sent to confirm an address, kept as the SHA-256 digest of their token.
create table email_confirmation (
    id           uuid        primary key,
    account_id   uuid        not null,
    token_digest varchar(64) not null,
    created_at   timestamptz not null,
    expires_at   timestamptz not null,
    constraint email_confirmation_digest_uk unique (token_digest),
    constraint email_confirmation_account_fk foreign key (account_id) references user_account (id) on delete cascade
);

create index email_confirmation_account_ix on email_confirmation (account_id);

-- Settings of the platform that administrators change from the interface.
create table platform_setting (
    name       varchar(100) primary key,
    value      varchar(1000) not null,
    updated_at timestamptz   not null,
    updated_by varchar(254)  not null
);
