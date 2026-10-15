-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-097 on MK-054: free tags on the resources of extensions. A tag belongs to an entry of the
-- registry (V16) and goes with it when the entry is removed. The kernel stores it normalized (trimmed,
-- inner spaces collapsed, lowercase), at most once per resource. Under row-level security like the
-- registry: a request sees and writes only the tags of its organization.

create table resource_tag (
    id              uuid         primary key,
    organization_id uuid         not null default current_organization(),
    resource_id     uuid         not null,
    tag             varchar(48)  not null,
    created_at      timestamptz  not null,
    constraint resource_tag_uk unique (resource_id, tag),
    constraint resource_tag_organization_fk foreign key (organization_id) references organization (id) on delete cascade,
    constraint resource_tag_resource_fk foreign key (resource_id) references resource (id) on delete cascade,
    constraint resource_tag_lowercase_ck check (tag = lower(tag) and tag = btrim(tag) and tag <> '')
);

-- The unique key serves the tags of a resource; this one the suggestions while a person types and
-- the filter of a list by tag.
create index resource_tag_organization_ix on resource_tag (organization_id, tag varchar_pattern_ops);

alter table resource_tag enable row level security;
create policy resource_tag_organization on resource_tag
    using (organization_id = current_organization())
    with check (organization_id = current_organization());
