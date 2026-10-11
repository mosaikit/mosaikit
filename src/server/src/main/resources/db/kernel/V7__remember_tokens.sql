-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- "Remember me" of the sign-in of the shell: a long random token in an HttpOnly cookie, kept here
-- only as its SHA-256 digest, so that a copy of the database signs nobody in. Ending the session
-- deletes it; it expires by itself after mosaikit.accounts.remember-for.

create table remember_token (
    id           uuid         primary key,
    account_id   uuid         not null,
    token_digest varchar(64)  not null,
    created_at   timestamptz  not null,
    expires_at   timestamptz  not null,
    constraint remember_token_digest_uk unique (token_digest),
    constraint remember_token_account_fk foreign key (account_id) references user_account (id) on delete cascade
);

create index remember_token_account_ix on remember_token (account_id);
create index remember_token_expires_ix on remember_token (expires_at);
