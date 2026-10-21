-- Mosaikit: schema core.
-- Tenant, identita', risorse, permessi, link pubblici, eventi.
-- Vedi docs/architettura.md §3-§7.

create schema if not exists core;

-- ---------------------------------------------------------------- tenant e identita'

create table core.tenants (
    id          uuid primary key default gen_random_uuid(),
    slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
    name        text not null,
    status      text not null default 'active' check (status in ('active', 'suspended')),
    is_system   boolean not null default false,
    -- policy: public_links_enabled, public_link_max_days, managers_see_titles
    settings    jsonb not null default '{}',
    created_at  timestamptz not null default now()
);

create table core.users (
    id              uuid primary key default gen_random_uuid(),
    home_tenant_id  uuid not null references core.tenants(id),
    username        text not null check (username ~ '^[a-z0-9][a-z0-9._-]{1,63}$'),
    display_name    text not null default '',
    email           text,
    password_hash   text,
    status          text not null default 'active' check (status in ('active', 'disabled')),
    is_system_admin boolean not null default false,
    created_at      timestamptz not null default now(),
    unique (home_tenant_id, username)
);

create table core.memberships (
    tenant_id   uuid not null references core.tenants(id) on delete cascade,
    user_id     uuid not null references core.users(id) on delete cascade,
    role        text not null check (role in ('manager', 'member')),
    invited_by  uuid references core.users(id) on delete set null,
    joined_at   timestamptz not null default now(),
    primary key (tenant_id, user_id)
);
create index on core.memberships (user_id);

create table core.invitations (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references core.tenants(id) on delete cascade,
    user_id     uuid not null references core.users(id) on delete cascade,
    role        text not null check (role in ('manager', 'member')),
    invited_by  uuid references core.users(id) on delete set null,
    status      text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked')),
    created_at  timestamptz not null default now(),
    expires_at  timestamptz not null default now() + interval '14 days'
);
create index on core.invitations (user_id, status);

create table core.sessions (
    token_hash  bytea primary key,
    user_id     uuid not null references core.users(id) on delete cascade,
    csrf        text not null,
    created_at  timestamptz not null default now(),
    expires_at  timestamptz not null,
    last_seen   timestamptz not null default now()
);
create index on core.sessions (user_id);

create table core.groups (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references core.tenants(id) on delete cascade,
    name        text not null,
    created_at  timestamptz not null default now(),
    unique (tenant_id, name)
);

create table core.group_members (
    group_id    uuid not null references core.groups(id) on delete cascade,
    user_id     uuid not null references core.users(id) on delete cascade,
    primary key (group_id, user_id)
);
create index on core.group_members (user_id);

create table core.user_prefs (
    user_id     uuid not null references core.users(id) on delete cascade,
    tenant_id   uuid not null references core.tenants(id) on delete cascade,
    prefs       jsonb not null default '{}',
    primary key (user_id, tenant_id)
);

-- ---------------------------------------------------------------- plugin

create table core.plugins (
    id                  text primary key,
    version             text not null,
    manifest            jsonb not null,
    sha256              text not null,
    signed_by           text,
    status              text not null default 'installed' check (status in ('installed', 'active', 'blocked')),
    dev                 boolean not null default false,
    schema_name         text not null unique,
    role_name           text not null unique,
    role_password       text not null,
    installed_at        timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create table core.plugin_migrations (
    plugin_id   text not null references core.plugins(id) on delete cascade,
    version     int not null,
    name        text not null,
    checksum    text not null,
    applied_at  timestamptz not null default now(),
    primary key (plugin_id, version)
);

-- ---------------------------------------------------------------- risorse e permessi

create table core.resources (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references core.tenants(id) on delete cascade,
    plugin_id   text not null references core.plugins(id) on delete cascade,
    kind        text not null,
    parent_id   uuid references core.resources(id) on delete cascade,
    -- antenati dalla radice al genitore: ereditarieta' dei permessi senza ricorsione
    ancestors   uuid[] not null default '{}',
    owner_id    uuid not null references core.users(id),
    title       text not null default '',
    size_bytes  bigint not null default 0,
    meta        jsonb not null default '{}',
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index on core.resources (tenant_id, plugin_id, kind);
create index on core.resources (owner_id);
create index on core.resources (parent_id);
create index on core.resources using gin (ancestors);

-- level: 1 lettura, 2 scrittura, 3 gestione
create table core.grants (
    resource_id     uuid not null references core.resources(id) on delete cascade,
    principal_type  text not null check (principal_type in ('user', 'group')),
    principal_id    uuid not null,
    level           smallint not null check (level between 1 and 3),
    granted_by      uuid references core.users(id) on delete set null,
    granted_at      timestamptz not null default now(),
    primary key (resource_id, principal_type, principal_id)
);
create index on core.grants (principal_type, principal_id);

create table core.public_links (
    id              uuid primary key default gen_random_uuid(),
    resource_id     uuid not null references core.resources(id) on delete cascade,
    token_hash      bytea not null unique,
    expires_at      timestamptz,
    password_hash   text,
    created_by      uuid references core.users(id) on delete set null,
    created_at      timestamptz not null default now(),
    revoked_at      timestamptz,
    view_count      bigint not null default 0
);
create index on core.public_links (resource_id);

-- ticket di lettura per i contenuti in iframe (siti, anteprime)
create table core.tickets (
    token_hash      bytea primary key,
    resource_id     uuid not null references core.resources(id) on delete cascade,
    user_id         uuid not null references core.users(id) on delete cascade,
    tenant_id       uuid not null references core.tenants(id) on delete cascade,
    session_hash    bytea not null references core.sessions(token_hash) on delete cascade,
    download        boolean not null default false,
    expires_at      timestamptz not null
);

create table core.events (
    id          bigserial primary key,
    ts          timestamptz not null default now(),
    tenant_id   uuid references core.tenants(id) on delete cascade,
    user_id     uuid references core.users(id) on delete set null,
    plugin_id   text,
    resource_id uuid,
    action      text not null,
    detail      jsonb not null default '{}'
);
create index on core.events (tenant_id, ts);

-- ---------------------------------------------------------------- contesto di sicurezza

create table core.secrets (
    name    text primary key,
    value   bytea not null
);

-- contesto della transazione corrente, per backend: vedi core.set_ctx
create unlogged table core.session_ctx (
    pid             int primary key,
    xid             xid8 not null,
    user_id         uuid,
    tenant_id       uuid,
    plugin_id       text,
    link_resource   uuid
);

-- Imposta il contesto (utente, tenant, plugin, link pubblico) per la transazione
-- corrente. Richiede il segreto `ctx`, che i ruoli dei plugin non possono leggere.
create function core.set_ctx(p_secret bytea, p_user uuid, p_tenant uuid, p_plugin text, p_link uuid)
returns void language plpgsql security definer set search_path = core, pg_temp as $$
begin
    if not exists (select 1 from core.secrets where name = 'ctx' and value = p_secret) then
        raise exception 'mosaikit: contesto non autorizzato' using errcode = '42501';
    end if;
    insert into core.session_ctx (pid, xid, user_id, tenant_id, plugin_id, link_resource)
    values (pg_backend_pid(), pg_current_xact_id(), p_user, p_tenant, p_plugin, p_link)
    on conflict (pid) do update
        set xid = excluded.xid, user_id = excluded.user_id, tenant_id = excluded.tenant_id,
            plugin_id = excluded.plugin_id, link_resource = excluded.link_resource;
end $$;

-- Il contesto vale solo nella transazione che l'ha impostato.
create function core.ctx_row() returns core.session_ctx
language sql stable security definer set search_path = core, pg_temp as $$
    select * from core.session_ctx
    where pid = pg_backend_pid() and xid = pg_current_xact_id_if_assigned()
$$;

create function core.ctx_user() returns uuid
language sql stable security definer set search_path = core, pg_temp as $$ select (core.ctx_row()).user_id $$;

create function core.ctx_tenant() returns uuid
language sql stable security definer set search_path = core, pg_temp as $$ select (core.ctx_row()).tenant_id $$;

create function core.ctx_plugin() returns text
language sql stable security definer set search_path = core, pg_temp as $$ select (core.ctx_row()).plugin_id $$;

create function core.is_member(p_user uuid, p_tenant uuid) returns boolean
language sql stable security definer set search_path = core, pg_temp as $$
    select exists (
        select 1 from core.memberships m
        join core.users u on u.id = m.user_id and u.status = 'active'
        join core.tenants t on t.id = m.tenant_id and t.status = 'active'
        where m.tenant_id = p_tenant and m.user_id = p_user
    )
$$;

-- Livello effettivo di un utente su una risorsa: massimo tra proprieta' e grant
-- (diretti o tramite gruppo) sulla risorsa e sui suoi antenati.
create function core.level_for(p_user uuid, p_tenant uuid, p_rid uuid, p_ancestors uuid[]) returns int
language plpgsql stable security definer set search_path = core, pg_temp as $$
declare
    v_chain uuid[] := p_ancestors || p_rid;
begin
    if p_user is null or not core.is_member(p_user, p_tenant) then
        return 0;
    end if;
    if exists (select 1 from core.resources where id = any(v_chain) and owner_id = p_user) then
        return 3;
    end if;
    return coalesce((
        select max(g.level) from core.grants g
        where g.resource_id = any(v_chain)
          and ((g.principal_type = 'user' and g.principal_id = p_user)
            or (g.principal_type = 'group' and g.principal_id in (
                    select gm.group_id from core.group_members gm
                    join core.groups gr on gr.id = gm.group_id
                    where gm.user_id = p_user and gr.tenant_id = p_tenant)))
    ), 0);
end $$;

-- Livello del contesto corrente su una risorsa (0-3).
create function core.level_of(p_rid uuid) returns int
language plpgsql stable security definer set search_path = core, pg_temp as $$
declare
    c core.session_ctx;
    r record;
begin
    c := core.ctx_row();
    if c.pid is null or p_rid is null then
        return 0;
    end if;
    select id, tenant_id, plugin_id, ancestors into r from core.resources where id = p_rid;
    if not found or c.tenant_id is null or r.tenant_id <> c.tenant_id then
        return 0;
    end if;
    if c.plugin_id is not null and r.plugin_id <> c.plugin_id then
        return 0;
    end if;
    if c.link_resource is not null then
        -- link pubblico: sola lettura della risorsa e dei suoi discendenti
        if r.id = c.link_resource or c.link_resource = any(r.ancestors) then
            return 1;
        end if;
        return 0;
    end if;
    return core.level_for(c.user_id, r.tenant_id, r.id, r.ancestors);
end $$;

create function core.can_access(p_rid uuid, p_level int) returns boolean
language sql stable security definer set search_path = core, pg_temp as $$
    select core.level_of(p_rid) >= p_level
$$;

-- Metadati delle risorse del plugin corrente visibili nel contesto.
-- security_barrier: i predicati del chiamante non vedono righe non filtrate.
create view core.visible_resources with (security_barrier) as
    select r.id, r.tenant_id, r.plugin_id, r.kind, r.parent_id, r.ancestors, r.owner_id,
           u.username as owner_username, coalesce(nullif(u.display_name, ''), u.username) as owner_name,
           r.title, r.size_bytes, r.meta, r.created_at, r.updated_at,
           core.level_of(r.id) as my_level,
           exists (select 1 from core.grants g where g.resource_id = r.id) as shared
    from core.resources r
    join core.users u on u.id = r.owner_id
    where r.tenant_id = core.ctx_tenant()
      and r.plugin_id = core.ctx_plugin()
      and core.level_of(r.id) >= 1;

-- ---------------------------------------------------------------- operazioni sulle risorse

create function core.create_resource(p_kind text, p_title text, p_parent uuid, p_meta jsonb) returns uuid
language plpgsql volatile security definer set search_path = core, pg_temp as $$
declare
    c core.session_ctx;
    p record;
    v_anc uuid[] := '{}';
    v_id uuid;
begin
    c := core.ctx_row();
    if c.pid is null or c.user_id is null or c.plugin_id is null or c.link_resource is not null
       or not core.is_member(c.user_id, c.tenant_id) then
        raise exception 'mosaikit: contesto non valido per creare risorse' using errcode = '42501';
    end if;
    if p_kind is null or p_kind !~ '^[a-z][a-z0-9_]{0,47}$' then
        raise exception 'mosaikit: tipo di risorsa non valido' using errcode = '22023';
    end if;
    if p_parent is not null then
        select * into p from core.resources where id = p_parent;
        if not found or p.tenant_id <> c.tenant_id or p.plugin_id <> c.plugin_id then
            raise exception 'mosaikit: genitore non valido' using errcode = '22023';
        end if;
        if core.level_of(p_parent) < 2 then
            raise exception 'mosaikit: permesso di scrittura sul genitore richiesto' using errcode = '42501';
        end if;
        v_anc := p.ancestors || p.id;
    end if;
    insert into core.resources (tenant_id, plugin_id, kind, parent_id, ancestors, owner_id, title, meta)
    values (c.tenant_id, c.plugin_id, p_kind, p_parent, v_anc, c.user_id, coalesce(p_title, ''), coalesce(p_meta, '{}'))
    returning id into v_id;
    return v_id;
end $$;

-- Aggiorna titolo, meta (unione) e dimensione; richiede scrittura.
create function core.update_resource(p_id uuid, p_title text, p_meta jsonb, p_size bigint) returns void
language plpgsql volatile security definer set search_path = core, pg_temp as $$
begin
    if core.level_of(p_id) < 2 then
        raise exception 'mosaikit: permesso di scrittura richiesto' using errcode = '42501';
    end if;
    update core.resources set
        title = coalesce(p_title, title),
        meta = case when p_meta is null then meta else meta || p_meta end,
        size_bytes = coalesce(p_size, size_bytes),
        updated_at = now()
    where id = p_id;
end $$;

-- Sposta una risorsa (gestione sulla risorsa, scrittura sul nuovo genitore).
create function core.move_resource(p_id uuid, p_parent uuid) returns void
language plpgsql volatile security definer set search_path = core, pg_temp as $$
declare
    r record;
    p record;
    v_anc uuid[] := '{}';
begin
    if core.level_of(p_id) < 3 then
        raise exception 'mosaikit: permesso di gestione richiesto' using errcode = '42501';
    end if;
    select * into r from core.resources where id = p_id;
    if p_parent is not null then
        select * into p from core.resources where id = p_parent;
        if not found or p.tenant_id <> r.tenant_id or p.plugin_id <> r.plugin_id then
            raise exception 'mosaikit: destinazione non valida' using errcode = '22023';
        end if;
        if p.id = p_id or p_id = any(p.ancestors) then
            raise exception 'mosaikit: impossibile spostare una cartella dentro se stessa' using errcode = '22023';
        end if;
        if core.level_of(p_parent) < 2 then
            raise exception 'mosaikit: permesso di scrittura sulla destinazione richiesto' using errcode = '42501';
        end if;
        v_anc := p.ancestors || p.id;
    end if;
    update core.resources set parent_id = p_parent, ancestors = v_anc, updated_at = now() where id = p_id;
    -- discendenti: nuovo prefisso + parte dopo la risorsa spostata
    update core.resources
       set ancestors = v_anc || p_id || ancestors[array_position(ancestors, p_id) + 1 :]
     where p_id = any(ancestors);
end $$;

-- Elimina una risorsa e i discendenti (gestione richiesta). Ritorna gli id eliminati.
create function core.delete_resource(p_id uuid) returns setof uuid
language plpgsql volatile security definer set search_path = core, pg_temp as $$
begin
    if core.level_of(p_id) < 3 then
        raise exception 'mosaikit: permesso di gestione richiesto' using errcode = '42501';
    end if;
    return query
        with gone as (
            delete from core.resources where id = p_id or p_id = any(ancestors) returning id
        ) select id from gone;
end $$;

-- ---------------------------------------------------------------- privilegi

-- Le funzioni sono eseguibili da PUBLIC per default: si revoca tutto e si
-- concede esplicitamente ai ruoli dei plugin al provisioning.
revoke all on all functions in schema core from public;
revoke all on all tables in schema core from public;
revoke all on schema core from public;
