-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-085: events of the platform for the Java code of extensions. An event is written in the
-- transaction of the change that raises it, with one delivery for each subscriber of its type known
-- at that moment; a dispatcher of the kernel hands each delivery to its subscriber, in the
-- organization of the event, and marks it delivered, or retries it later. So an event survives a
-- stop of the kernel, and each subscriber keeps its own progress.
--
-- No foreign key to the organization: the event that an organization was deleted outlives it. Only
-- the kernel reads and writes these tables, as their owner: row-level security is on without a
-- policy, so the member role of requests sees no row; platform_event_raise writes them from a
-- request of any organization, or of none, in the transaction of the caller.

create table platform_event (
    id              bigint        generated always as identity primary key,
    organization_id uuid          not null,
    type            varchar(120)  not null,
    -- 'kernel', or the extension that raised it.
    source          varchar(255)  not null,
    payload         text          not null,
    created_at      timestamptz   not null default now()
);

create index platform_event_organization_ix on platform_event (organization_id);

create table platform_delivery (
    event_id        bigint        not null,
    -- <extension>/<name of the subscriber>
    subscriber      varchar(320)  not null,
    attempts        integer       not null default 0,
    next_attempt_at timestamptz   not null default now(),
    delivered_at    timestamptz,
    -- Set when it was given up after the most attempts, or skipped (the extension turned off).
    failed_at       timestamptz,
    last_error      varchar(1000),
    constraint platform_delivery_pk primary key (event_id, subscriber),
    constraint platform_delivery_event_fk foreign key (event_id) references platform_event (id) on delete cascade
);

-- The deliveries still to make, by when they are due.
create index platform_delivery_due_ix on platform_delivery (next_attempt_at, event_id)
    where delivered_at is null and failed_at is null;

alter table platform_event enable row level security;
alter table platform_delivery enable row level security;

-- Writes an event and its deliveries, one for each subscriber in the comma-separated list, as the
-- owner of the tables: an organization is created by a request of the platform administrator, which
-- acts on another organization or on none.
create function platform_event_raise(
        p_organization uuid, p_type varchar, p_source varchar, p_payload text, p_subscribers text)
        returns bigint
    language plpgsql security definer
    set search_path = mk_kernel, pg_temp
    as $$
declare
    v_id bigint;
begin
    insert into platform_event (organization_id, type, source, payload)
        values (p_organization, p_type, p_source, p_payload)
        returning id into v_id;
    insert into platform_delivery (event_id, subscriber)
        select v_id, s from unnest(string_to_array(p_subscribers, ',')) as s;
    return v_id;
end
$$;
