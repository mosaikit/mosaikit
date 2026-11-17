-- Actions of a share: names a plugin declares per resource type (see kernel/src/actions.rs), set per person or
-- group next to the level. Comma separated names ("download,run"); empty: none. Manage implies every action.
alter table core.grants add column actions text not null default '';

-- The caller may do the action on the resource: manage level, or a grant (own or of one of their groups, on the
-- resource or on a folder above it) that lists the action. For the policies of the tables a plugin declares with
-- `write_actions`, and for plugin SQL (`core.can_action`). Read access to the resource is required.
create function core.can_action(p_rid uuid, p_action text) returns boolean
language plpgsql stable security definer set search_path = core, pg_temp as $$
declare
    c core.session_ctx;
    r record;
    lv int;
begin
    lv := core.level_of(p_rid);
    if lv < 1 then
        return false;
    end if;
    if lv >= 3 then
        return true;
    end if;
    c := core.ctx_row();
    if c.user_id is null then
        return false;
    end if;
    select id, ancestors into r from core.resources where id = p_rid;
    return exists (
        select 1 from core.grants g
        where (g.resource_id = r.id or g.resource_id = any(r.ancestors))
          and position(',' || p_action || ',' in ',' || g.actions || ',') > 0
          and ((g.principal_type = 'user' and g.principal_id = c.user_id)
            or (g.principal_type = 'group' and g.principal_id in
                  (select gm.group_id from core.group_members gm where gm.user_id = c.user_id)))
    );
end $$;
