-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- ADR-0037, MK-032 on MK-055: the documents of extensions shared with a team move onto the one
-- sharing model. Each such document becomes a registered resource (V16) of type 'data-document' of
-- its extension, owned by the organization, and its team gets a grant (V18) at the level 'edit', the
-- highest of the type: what the members of the team could do before. The kernel writes the levels of
-- 'data-document' in sharing_level at start, for every extension with collections, as it does for the
-- types that manifests declare. Documents of the whole organization do not change.
--
-- A document of a team stays for the members of the team only, as MK-032 decided: the administrators
-- of the organization, who hold every level on the resources of their organization (ADR-0037), do
-- not hold it on 'data-document', a type of the kernel private to its subjects. sharing_level says it
-- per type, and allows() reads it.

alter table sharing_level add column administrators boolean not null default true;

insert into resource (id, organization_id, extension_id, type, ref_id, owner_id, title, link, parent_id,
                      created_at, updated_at)
select gen_random_uuid(), d.organization_id, d.extension_id, 'data-document', d.id::text, null,
       left('Document of ' || d.collection, 200), '/', null, d.created_at, d.updated_at
from extension_document d
where d.team_id is not null
on conflict do nothing;

-- Who shared: the account of the person who wrote the document; the nil identifier when that account
-- no longer exists (granted_by has no foreign key, so that grants outlive the people who made them).
insert into resource_grant (id, organization_id, resource_id, subject_kind, team_id, level, granted_by,
                            granted_at)
select gen_random_uuid(), r.organization_id, r.id, 'group', d.team_id, 'edit',
       coalesce((select a.id from user_account a where a.username = d.created_by),
                '00000000-0000-0000-0000-000000000000'::uuid),
       d.created_at
from extension_document d
join resource r
  on r.organization_id = d.organization_id and r.extension_id = d.extension_id
 and r.type = 'data-document' and r.ref_id = d.id::text
where d.team_id is not null
on conflict do nothing;

-- A document of the organization is for its members, not its guests, as before; a document of a team
-- is for those to whom mk_kernel.allows() gives a level on it: the members of the team through its
-- grant, and the people it was then shared with; not the administrators by being administrators.
-- Reading needs 'view', writing 'edit'.
drop policy extension_document_access on extension_document;
create policy extension_document_access on extension_document
    using (organization_id = current_organization()
        and case
            when team_id is null then not current_guest()
            else allows(extension_id, 'data-document', id::text, 'view')
        end)
    with check (organization_id = current_organization()
        and case
            when team_id is null then not current_guest()
            else allows(extension_id, 'data-document', id::text, 'edit')
        end);

-- As in V18, but the administrators of the organization hold every level only on the types where
-- sharing_level says so.
create or replace function allows(p_extension text, p_type text, p_ref_id text, p_level text)
    returns boolean
    language sql stable
    set search_path = mk_kernel, pg_temp
    as $$
    select exists (
        select 1
        from resource r
        join sharing_level needed
          on needed.extension_id = r.extension_id and needed.type = r.type and needed.level = p_level
        where r.organization_id = current_organization()
          and r.extension_id = p_extension and r.type = p_type and r.ref_id = p_ref_id
          and (
            (current_account() is not null and r.owner_id = current_account())
            or (current_administrator() and needed.administrators)
            or exists (
                select 1
                from resource_grant g
                join sharing_level given
                  on given.extension_id = r.extension_id and given.type = r.type and given.level = g.level
                where g.resource_id = r.id
                  and case when g.subject_kind = 'public' then 0 else given.rank end >= needed.rank
                  and (
                    g.subject_kind = 'public'
                    or (g.subject_kind = 'organization' and current_account() is not null and not current_guest())
                    or (g.subject_kind = 'person' and g.account_id = current_account())
                    or (g.subject_kind = 'group' and exists (
                            select 1 from team_member m
                            where m.team_id = g.team_id and m.account_id = current_account()))
                  )
            )
          )
    ) $$;
