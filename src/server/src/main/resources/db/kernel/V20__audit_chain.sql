-- SPDX-FileCopyrightText: 2026 Massimo Antonini
-- SPDX-License-Identifier: MPL-2.0
--
-- MK-059: the audit log becomes tamper-evident. Each organization has one chain of entries, and the
-- platform one more (entries without organization): every entry carries its position in the chain,
-- the hash of the entry before it and its own hash, over its canonical content (AuditChain). The
-- kernel appends under a row lock of the chain, so that writers in several kernels stay in order.
-- Entries also say through which channel the action came. The member role of requests may read and
-- add entries of its organization only, and never change nor delete them (RowSecurity revokes it);
-- the retention job, as the owner, deletes the oldest entries and keeps the hash of the last one it
-- deleted as the anchor the chain is verified from.

alter table audit_event add column channel varchar(16);
-- Before MK-059 the actions of assistants and MCP clients were the only ones not made in the console.
update audit_event set channel = case when action like 'ai.%' then 'ASSISTANT' else 'WEB' end;
alter table audit_event alter column channel set not null;

alter table audit_event add column chain_index bigint;
alter table audit_event add column previous_hash varchar(64);
alter table audit_event add column hash varchar(64);

-- One row per chain: the organization, or the nil UUID for the platform. Its last entry, the anchor
-- (the last entry deleted by the retention, index 0 and 64 zeros while none was) and the retention
-- set by the administrators, in days; null keeps every entry.
create table audit_chain (
    chain_id       uuid        primary key,
    last_index     bigint      not null,
    last_hash      varchar(64) not null,
    anchor_index   bigint      not null,
    anchor_hash    varchar(64) not null,
    retention_days integer,
    constraint audit_chain_retention_ck check (retention_days is null or retention_days > 0)
);

-- The hash of an entry, as AuditChain.hash computes it: SHA-256 of 'mosaikit-audit-v1' followed, for
-- each field, by a new line and either '~' (null) or the length of the value in UTF-8 bytes, ':' and
-- the value. The time is in microseconds since the epoch. Kept for the check of AuditChainTest.
create function audit_entry_hash(
        id uuid, chain_index bigint, organization_id uuid, occurred_at timestamptz, channel text,
        actor text, action text, subject text, outcome text, detail text, previous_hash text)
    returns varchar language sql immutable parallel safe
    as $$
        select encode(sha256(convert_to(
            'mosaikit-audit-v1'
            || (select string_agg(E'\n' || coalesce(octet_length(convert_to(v, 'UTF8')) || ':' || v, '~'), ''
                                  order by n)
                from unnest(array[
                    id::text, chain_index::text, organization_id::text,
                    (extract(epoch from occurred_at) * 1000000)::bigint::text, channel,
                    actor, action, subject, outcome, detail, previous_hash]) with ordinality as f(v, n)),
            'UTF8')), 'hex')
    $$;

-- The entries written before MK-059 are chained in the order they were written.
do $$
declare
    nil   constant uuid := '00000000-0000-0000-0000-000000000000';
    zeros constant varchar(64) := repeat('0', 64);
    entry record;
    chain uuid;
    idx bigint;
    previous varchar(64);
begin
    for entry in
        select e.*, coalesce(e.organization_id, nil) as chain_id
        from audit_event e
        order by coalesce(e.organization_id, nil), e.occurred_at, e.id
    loop
        if chain is distinct from entry.chain_id then
            if chain is not null then
                insert into audit_chain values (chain, idx, previous, 0, zeros, null);
            end if;
            chain := entry.chain_id;
            idx := 0;
            previous := zeros;
        end if;
        idx := idx + 1;
        update audit_event
        set chain_index = idx,
            previous_hash = previous,
            hash = audit_entry_hash(
                entry.id, idx, entry.organization_id, entry.occurred_at, entry.channel, entry.actor,
                entry.action, entry.subject, entry.outcome, entry.detail, previous)
        where id = entry.id
        returning hash into previous;
    end loop;
    if chain is not null then
        insert into audit_chain values (chain, idx, previous, 0, zeros, null);
    end if;
end
$$;

alter table audit_event alter column chain_index set not null;
alter table audit_event alter column previous_hash set not null;
alter table audit_event alter column hash set not null;

create unique index audit_event_chain_uk
    on audit_event ((coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid)), chain_index);

-- The kernel reads and writes the audit log as the owner and filters its own queries; the policies
-- are for the member role of requests, which sees and adds only entries of its organization.
alter table audit_event enable row level security;
create policy audit_event_read on audit_event for select
    using (organization_id = current_organization());
create policy audit_event_write on audit_event for insert
    with check (organization_id = current_organization());
