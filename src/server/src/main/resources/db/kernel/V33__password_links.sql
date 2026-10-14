-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- Accounts that an administrator creates (MK-048): the person sets the password with a link that
-- works once, for mosaikit.accounts.set-password-valid-for. The link is mailed to the person, or,
-- when the installation sends no mail, shown once to the administrator; the database keeps only the
-- SHA-256 digest of its token, and a new link replaces the previous one.
--
-- Like email_confirmation, the table belongs to accounts and is read before any organization is
-- known: it is not under row-level security, and requests read it but only the kernel writes it.

create table password_link (
    id              uuid        primary key,
    account_id      uuid        not null,
    -- The organization the account was created in, for the audit of the use of the link.
    organization_id uuid,
    token_digest    varchar(64) not null,
    created_at      timestamptz not null,
    expires_at      timestamptz not null,
    constraint password_link_digest_uk unique (token_digest),
    constraint password_link_account_fk foreign key (account_id) references user_account (id) on delete cascade
);

create index password_link_account_ix on password_link (account_id);
