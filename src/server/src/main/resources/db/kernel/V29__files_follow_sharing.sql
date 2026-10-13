-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-041 on MK-055: a file attached to a registered resource (V24, resource_id) follows the sharing of
-- that resource, as the kernel decides in FileService. A person reads it when they hold any level on
-- the resource (allows() at its lowest level) or stored the file; a file without a resource keeps the
-- rules of V24: of the organization for its members, not its guests, of a team for its people. A
-- request without a person, the code of an extension acting alone, keeps the rules of V24 too.

-- Whether the person of the request holds any level on a registered resource: allows() at the lowest
-- level of its type.
create or replace function reads_resource(p_resource uuid)
    returns boolean
    language sql stable
    set search_path = mk_kernel, pg_temp
    as $$
    select exists (
        select 1
        from resource r
        join sharing_level lowest
          on lowest.extension_id = r.extension_id and lowest.type = r.type
         and lowest.rank = (select min(l.rank) from sharing_level l
                            where l.extension_id = r.extension_id and l.type = r.type)
        where r.id = p_resource
          and allows(r.extension_id, r.type, r.ref_id, lowest.level)
    ) $$;

drop policy stored_file_access on stored_file;
create policy stored_file_access on stored_file
    using (organization_id = current_organization()
        and case
            when resource_id is not null and current_account() is not null
                then owner_id = current_account() or reads_resource(resource_id)
            when team_id is null then not current_guest()
            else exists (select 1 from team_member m
                         where m.team_id = stored_file.team_id and m.account_id = current_account())
        end)
    with check (organization_id = current_organization()
        and case
            when resource_id is not null and current_account() is not null
                then owner_id = current_account() or reads_resource(resource_id)
            when team_id is null then not current_guest()
            else exists (select 1 from team_member m
                         where m.team_id = stored_file.team_id and m.account_id = current_account())
        end);

-- MK-093 on MK-055: a signed link made by a person carries their account, and serves only what they
-- still read: nothing once they are no longer a member of the organization, and a file attached to a
-- resource only while they hold a level on it, as allows() decides for the person of a request. The
-- request that opens a link has no session: security definer, as signed_file(), and called only after
-- the kernel verified the signature of the link.
create or replace function signed_link_reads(p_organization uuid, p_creator uuid, p_resource uuid)
    returns boolean
    language sql stable security definer
    set search_path = mk_kernel, pg_temp
    as $$
    with member as (
        select string_to_array(replace(m.roles, ' ', ''), ',') as roles
        from organization_member m
        where m.organization_id = p_organization and m.account_id = p_creator
    ),
    creator as (
        select 'organization-admin' = any (roles) as administrator,
               'organization-guest' = any (roles)
                   and not 'organization-user' = any (roles)
                   and not 'organization-admin' = any (roles) as guest
        from member
    )
    select exists (select 1 from creator)
       and (p_resource is null or exists (
            select 1
            from creator c, resource r
            join sharing_level lowest
              on lowest.extension_id = r.extension_id and lowest.type = r.type
             and lowest.rank = (select min(l.rank) from sharing_level l
                                where l.extension_id = r.extension_id and l.type = r.type)
            where r.id = p_resource and r.organization_id = p_organization
              and (
                r.owner_id = p_creator
                or (c.administrator and lowest.administrators)
                or exists (
                    select 1
                    from resource_grant g
                    where g.resource_id = r.id
                      and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())
                      and (
                        g.subject_kind = 'public'
                        or (g.subject_kind = 'organization' and not c.guest)
                        or (g.subject_kind = 'person' and g.account_id = p_creator)
                        or (g.subject_kind = 'group' and exists (
                                select 1 from team_member m
                                where m.team_id = g.team_id and m.account_id = p_creator))
                      )
                )
              )
        )) $$;
