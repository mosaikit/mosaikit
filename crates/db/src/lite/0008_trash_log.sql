-- Trash and log (phase 5), as in the PostgreSQL migration 0010: deleted resources stay in the trash
-- (deleted_at) until they are restored or purged; the events get the outcome, the address and the
-- browser of the request. The levels (sql-guard) return 0 for what is in the trash.

alter table core_resources add column deleted_at timestamptz;
alter table core_resources add column deleted_by uuid references core_users(id) on delete set null;
create index core_resources_trash on core_resources (tenant_id, deleted_at) where deleted_at is not null;

alter table core_events add column ok boolean not null default true;
alter table core_events add column ip text;
alter table core_events add column agent text;
create index core_events_ts on core_events (ts);
create index core_events_user on core_events (tenant_id, user_id, ts);
create index core_events_resource on core_events (resource_id) where resource_id is not null;
