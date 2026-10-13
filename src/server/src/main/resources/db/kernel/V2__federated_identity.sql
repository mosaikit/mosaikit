-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- Federated identity (MK-012): each organization may sign in through its own Keycloak realm,
-- chosen from the sub-domain or from the email domain. Local accounts stay available.

alter table organization add column identity_realm varchar(63);
alter table organization add constraint organization_identity_realm_uk unique (identity_realm);
alter table organization add constraint organization_identity_realm_ck
    check (identity_realm ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$');

-- One email domain belongs to one organization at most.
create table organization_email_domain (
    domain          varchar(253) primary key,
    organization_id uuid not null,
    constraint organization_email_domain_ck check (domain = lower(domain)),
    constraint organization_email_domain_organization_fk foreign key (organization_id)
        references organization (id) on delete cascade
);

create index organization_email_domain_organization_ix on organization_email_domain (organization_id);

-- Federated accounts have no local password and are linked by the subject of the realm.
alter table user_account alter column password_hash drop not null;
alter table user_account add column identity_subject varchar(255);
alter table user_account add constraint user_account_identity_subject_uk
    unique (organization_id, identity_subject);
