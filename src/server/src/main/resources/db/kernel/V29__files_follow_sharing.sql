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
