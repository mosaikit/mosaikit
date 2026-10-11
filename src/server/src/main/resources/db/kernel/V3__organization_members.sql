-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-017: a person has one account and may belong to several organizations, with roles and, for
-- a federated organization, a subject in its realm for each. The account keeps only the roles of
-- the platform. Each organization says how its members sign in.

create table organization_member (
    id               uuid primary key,
    account_id       uuid         not null,
    organization_id  uuid         not null,
    roles            varchar(255) not null,
    identity_subject varchar(255),
    created_at       timestamptz  not null,
    constraint organization_member_uk unique (account_id, organization_id),
    constraint organization_member_subject_uk unique (organization_id, identity_subject),
    constraint organization_member_account_fk foreign key (account_id)
        references user_account (id) on delete cascade,
    constraint organization_member_organization_fk foreign key (organization_id)
        references organization (id) on delete cascade
);

create index organization_member_organization_ix on organization_member (organization_id);

insert into organization_member (id, account_id, organization_id, roles, identity_subject, created_at)
select gen_random_uuid(), id, organization_id, roles, identity_subject, created_at
from user_account
where organization_id is not null;

update user_account
set roles = case when (',' || roles || ',') like '%,platform-admin,%' then 'platform-admin' else '' end;

alter table user_account drop constraint user_account_identity_subject_uk;
alter table user_account drop column identity_subject;
alter table user_account drop column organization_id;

-- PASSWORD: local passwords only; REALM: the realm only; PASSWORD_OR_REALM: both.
alter table organization add column sign_in varchar(20) not null default 'PASSWORD';
update organization set sign_in = 'PASSWORD_OR_REALM' where identity_realm is not null;
alter table organization add constraint organization_sign_in_ck
    check (sign_in in ('PASSWORD', 'REALM', 'PASSWORD_OR_REALM'));
