-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-076: the quotas of organizations. A measure is a counter per month (calls, renders, credits)
-- or a gauge (the bytes kept now); storage is the gauge of the kernel. quota_total holds what an
-- organization used of a measure in a period, one row that a check locks so that two actions cannot
-- both pass a limit; quota_usage holds the same by person, for the administrators. A gauge has the
-- period '' (now). The storage gauge follows the files of the kernel (V24) and the space that
-- extensions report for their resources, through triggers, so that a file that goes with its team or
-- a resource that goes with its organization leaves the count too. quota_limit holds the limits that
-- platform administrators set for one organization, over the defaults of the installation
-- (mosaikit.quotas.*); a null limit there is no limit. Under row-level security per organization.

create table quota_limit (
    organization_id uuid          not null default current_organization(),
    measure_id      varchar(320)  not null,
    -- Null: no limit for this organization, whatever the default of the installation.
    limit_value     bigint,
    updated_at      timestamptz   not null,
    -- Who set it; no foreign key: the row stays when they leave.
    updated_by      varchar(320)  not null,
    constraint quota_limit_pk primary key (organization_id, measure_id),
    constraint quota_limit_value_ck check (limit_value is null or limit_value >= 0),
    constraint quota_limit_organization_fk foreign key (organization_id) references organization (id) on delete cascade
);

create table quota_total (
    organization_id uuid          not null default current_organization(),
    measure_id      varchar(320)  not null,
    -- The month of a counter, such as 2026-10; '' for a gauge.
    period          varchar(7)    not null,
    amount          bigint        not null default 0,
    updated_at      timestamptz   not null default now(),
    constraint quota_total_pk primary key (organization_id, measure_id, period),
    constraint quota_total_organization_fk foreign key (organization_id) references organization (id) on delete cascade
);

create table quota_usage (
    organization_id uuid          not null default current_organization(),
    measure_id      varchar(320)  not null,
    period          varchar(7)    not null,
    -- The person, or null for what was used without one or by people who left. No foreign key: the
    -- consumption of a person stays counted after they leave.
    account_id      uuid,
    amount          bigint        not null default 0,
    updated_at      timestamptz   not null default now(),
    constraint quota_usage_uk unique nulls not distinct (organization_id, measure_id, period, account_id),
    constraint quota_usage_organization_fk foreign key (organization_id) references organization (id) on delete cascade
);

-- The space that an extension reports for one of its registered resources (MK-054): its data kept
-- outside the files of the kernel, such as tables or tiles. Goes with the resource.
create table quota_space (
    resource_id     uuid          primary key,
    organization_id uuid          not null default current_organization(),
    extension_id    varchar(255)  not null,
    -- The owner of the resource when reported, who the space is counted to.
    account_id      uuid,
    bytes           bigint        not null,
    updated_at      timestamptz   not null,
    constraint quota_space_bytes_ck check (bytes >= 0),
    constraint quota_space_resource_fk foreign key (resource_id) references resource (id) on delete cascade,
    constraint quota_space_organization_fk foreign key (organization_id) references organization (id) on delete cascade
);

create index quota_space_organization_ix on quota_space (organization_id, extension_id);

-- Adds an amount, positive or negative, to the storage of an organization and of a person. Runs as
-- the owner of the tables: a file can leave with its team or its organization in a request of
-- another organization, or of none, which row-level security would not let count. Never inserts on
-- a decrease, so that a row the cascade of an organization already removed does not come back.
create function quota_storage_add(p_organization uuid, p_account uuid, p_delta bigint) returns void
    language plpgsql security definer
    set search_path = mk_kernel, pg_temp
    as $$
begin
    if p_delta = 0 then
        return;
    end if;
    if p_delta > 0 then
        insert into quota_total as t (organization_id, measure_id, period, amount, updated_at)
            values (p_organization, 'storage', '', p_delta, now())
            on conflict on constraint quota_total_pk
            do update set amount = t.amount + excluded.amount, updated_at = excluded.updated_at;
        insert into quota_usage as u (organization_id, measure_id, period, account_id, amount, updated_at)
            values (p_organization, 'storage', '', p_account, p_delta, now())
            on conflict on constraint quota_usage_uk
            do update set amount = u.amount + excluded.amount, updated_at = excluded.updated_at;
    else
        update quota_total set amount = greatest(amount + p_delta, 0), updated_at = now()
            where organization_id = p_organization and measure_id = 'storage' and period = '';
        update quota_usage set amount = greatest(amount + p_delta, 0), updated_at = now()
            where organization_id = p_organization and measure_id = 'storage' and period = ''
              and account_id is not distinct from p_account;
    end if;
end
$$;

create function quota_stored_file_changed() returns trigger
    language plpgsql security definer
    set search_path = mk_kernel, pg_temp
    as $$
begin
    if tg_op in ('UPDATE', 'DELETE') then
        perform quota_storage_add(old.organization_id, old.owner_id, -old.size);
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
        perform quota_storage_add(new.organization_id, new.owner_id, new.size);
    end if;
    return null;
end
$$;

create trigger stored_file_quota after insert or delete or update of size, owner_id, organization_id on stored_file
    for each row execute function quota_stored_file_changed();

create function quota_space_changed() returns trigger
    language plpgsql security definer
    set search_path = mk_kernel, pg_temp
    as $$
begin
    if tg_op in ('UPDATE', 'DELETE') then
        perform quota_storage_add(old.organization_id, old.account_id, -old.bytes);
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
        perform quota_storage_add(new.organization_id, new.account_id, new.bytes);
    end if;
    return null;
end
$$;

create trigger quota_space_quota after insert or delete or update of bytes, account_id, organization_id on quota_space
    for each row execute function quota_space_changed();

-- The files kept before quotas.
insert into quota_total (organization_id, measure_id, period, amount)
    select organization_id, 'storage', '', sum(size) from stored_file group by organization_id;
insert into quota_usage (organization_id, measure_id, period, account_id, amount)
    select organization_id, 'storage', '', owner_id, sum(size) from stored_file group by organization_id, owner_id;

alter table quota_limit enable row level security;
create policy quota_limit_organization on quota_limit
    using (organization_id = current_organization())
    with check (organization_id = current_organization());

alter table quota_total enable row level security;
create policy quota_total_organization on quota_total
    using (organization_id = current_organization())
    with check (organization_id = current_organization());

alter table quota_usage enable row level security;
create policy quota_usage_organization on quota_usage
    using (organization_id = current_organization())
    with check (organization_id = current_organization());

alter table quota_space enable row level security;
create policy quota_space_organization on quota_space
    using (organization_id = current_organization())
    with check (organization_id = current_organization());
