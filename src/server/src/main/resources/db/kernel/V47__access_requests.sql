-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-058 on MK-055: requests for access. A person refused a resource asks for a level on it, with a
-- message, from the page that refused them; the people who may share the resource (its owner, the
-- administrators of the organization) approve or reject the request, and an approved request grants
-- the level with the sharing model.
--
-- A request names the resource by its reference, as the refused page knew it, not by the entry of
-- the registry: it is kept also when no such resource is registered, so that sending a request says
-- nothing about whether the resource exists. Only the requester and the people who may share the
-- resource see it. Under row-level security like the grants (V18): a request sees and writes only
-- the requests of its organization.

create table access_request (
    id              uuid          primary key,
    organization_id uuid          not null default current_organization(),
    requester_id    uuid          not null,
    extension_id    varchar(255)  not null,
    type            varchar(48)   not null,
    ref_id          varchar(200)  not null,
    -- The level asked, one of the type.
    level           varchar(64)   not null,
    message         varchar(1000) not null,
    status          varchar(16)   not null,
    created_at      timestamptz   not null,
    -- Who decided and when; the level granted, which the decider may lower; the reason of a rejection.
    decided_by      uuid,
    decided_at      timestamptz,
    granted_level   varchar(64),
    reason          varchar(1000),
    constraint access_request_status_ck check (status in ('pending', 'approved', 'rejected')),
    constraint access_request_decided_ck check ((status = 'pending') = (decided_at is null)),
    constraint access_request_granted_ck check ((status = 'approved') = (granted_level is not null)),
    constraint access_request_organization_fk
        foreign key (organization_id) references organization (id) on delete cascade,
    constraint access_request_requester_fk
        foreign key (requester_id) references user_account (id) on delete cascade,
    constraint access_request_decided_by_fk
        foreign key (decided_by) references user_account (id) on delete set null
);

-- At most one pending request of a person for a resource: asking again replaces its message.
create unique index access_request_pending_uk on access_request
    (organization_id, requester_id, extension_id, type, ref_id) where status = 'pending';
-- The list of the pending requests of an organization, and those of a person.
create index access_request_pending_ix on access_request (organization_id, created_at) where status = 'pending';
create index access_request_requester_ix on access_request (requester_id, created_at desc);

alter table access_request enable row level security;
create policy access_request_organization on access_request
    using (organization_id = current_organization())
    with check (organization_id = current_organization());
