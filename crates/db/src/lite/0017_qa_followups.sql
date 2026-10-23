-- Follow-ups of the QA walkthrough (see migrations/0019_qa_followups.sql for PostgreSQL).

create table core_plugin_memory (
    plugin_id           text primary key,
    status              text not null,
    available_default   boolean not null,
    tenants             jsonb not null default '[]',
    uninstalled_at      timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

alter table core_tenants add column contact_name text not null default '';
alter table core_tenants add column contact_email text not null default '';
alter table core_tenants add column contact_phone text not null default '';
alter table core_tenants add column registration text not null default '';

alter table core_resources add column due_at timestamptz;
create index core_resources_due on core_resources (tenant_id, due_at) where due_at is not null;

create index core_events_about_user on core_events ((detail->>'user'));
