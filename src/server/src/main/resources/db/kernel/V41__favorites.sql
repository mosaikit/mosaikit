-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-094: the favorites of each person, one list across extensions. A favorite names a resource of
-- the registry (MK-054) by its reference, not by the id of the entry: the entries of an extension
-- that is uninstalled go away and come back with it, and the favorite must not be lost meanwhile
-- (MK-135). The title is the one the resource had when it was marked, for the placeholder shown
-- while its extension is absent. Under row-level security per organization, as the registry (V16).

create table favorite (
    id              uuid          primary key,
    organization_id uuid          not null default current_organization(),
    account_id      uuid          not null,
    extension_id    varchar(255)  not null,
    type            varchar(48)   not null,
    ref_id          varchar(200)  not null,
    title           varchar(200)  not null,
    created_at      timestamptz   not null,
    constraint favorite_ref_uk unique (organization_id, account_id, extension_id, type, ref_id),
    constraint favorite_organization_fk foreign key (organization_id) references organization (id) on delete cascade,
    constraint favorite_account_fk foreign key (account_id) references user_account (id) on delete cascade
);

create index favorite_account_ix on favorite (account_id);

alter table favorite enable row level security;
create policy favorite_organization on favorite
    using (organization_id = current_organization())
    with check (organization_id = current_organization());
