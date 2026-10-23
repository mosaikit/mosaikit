-- Follow-ups of the QA walkthrough (docs/reports/qa-walkthrough.md, mockup-vs-product.md).

-- ---------------------------------------------------------------- memory of an uninstalled plugin
-- Uninstalling drops a plugin with its schema and, in cascade, the choices of the tenants. Installing it
-- again brings back its state of then: on or off in the platform, the default availability and, for each
-- tenant that still exists, whether it was available and on. The memory goes away at the next install.
create table core.plugin_memory (
    plugin_id           text primary key,
    status              text not null,
    available_default   boolean not null,
    -- [{tenant_id, available, enabled}]
    tenants             jsonb not null default '[]',
    uninstalled_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------- details of a tenant
-- the contact person and the registration data of the mockup (tenant/details)
alter table core.tenants
    add column contact_name   text not null default '',
    add column contact_email  text not null default '',
    add column contact_phone  text not null default '',
    add column registration   text not null default '';

-- ---------------------------------------------------------------- due date of an item
-- the date field a resource declares as its due date (`due = "<field>"` in the manifest), copied by the
-- kernel at every write: the Home of a person lists what is due soon without asking every plugin
alter table core.resources add column due_at timestamptz;
create index resources_due on core.resources (tenant_id, due_at) where due_at is not null;

-- ---------------------------------------------------------------- events about a person
-- the Activity of a person shows what they did and what was done on them (`detail.user`)
create index events_about_user on core.events ((detail->>'user')) where detail ? 'user';
