-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-100: views of extensions embedded in the pages of other sites.
--
-- embed_site lists the sites (origins scheme://host[:port]) on which an organization lets its views
-- be shown in an iframe: the kernel sends them in frame-ancestors for the addresses /embed/<slug>/...
-- and for no other address, so the console itself is never framed. The list decides who may frame the
-- installation, a decision of security: only the kernel reads and writes it, as the owner of the
-- tables, for the administrators of the organization. The member role of requests has no right on it
-- (RowSecurity revokes them at every start), so the SQL of an extension cannot widen it; row-level
-- security without a policy shows it no row should a grant come back.

create table embed_site (
    id              uuid         primary key,
    organization_id uuid         not null,
    -- Normal form: scheme://host[:port], in lower case, without the default port.
    origin          varchar(300) not null,
    added_at        timestamptz  not null,
    -- Who added it; no foreign key: the row stays when they leave.
    added_by        varchar(320) not null,
    constraint embed_site_uk unique (organization_id, origin),
    constraint embed_site_organization_fk foreign key (organization_id) references organization (id) on delete cascade
);

alter table embed_site enable row level security;

-- The organization of a slug when it shares a resource of the extension with the public (MK-055):
-- a request without an account that names it may then call the routes of that extension open to
-- links and to the public, where Sharing decides, resource by resource, what it reads. Not for a
-- deleted organization (MK-130) nor for a resource in the trash (MK-095). Security definer: such a
-- request has no organization yet, and the row-level security shows it no row.
create or replace function public_shares(p_organization text, p_extension text)
    returns uuid
    language sql stable security definer
    set search_path = mk_kernel, pg_temp
    as $$
    select o.id
    from organization o
    where o.slug = p_organization
      and o.deleted_at is null
      and exists (select 1
                  from resource_grant g
                  join resource r on r.id = g.resource_id
                  where g.organization_id = o.id
                    and g.subject_kind = 'public'
                    and r.extension_id = p_extension
                    and r.trashed_at is null) $$;
