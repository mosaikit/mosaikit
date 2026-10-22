-- Notifications, preferences and the queue of the emails (see migrations/0006_notifications.sql for
-- PostgreSQL).

create table core_notifications (
    id          uuid primary key default (gen_random_uuid()),
    user_id     uuid not null references core_users(id) on delete cascade,
    tenant_id   uuid references core_tenants(id) on delete cascade,
    kind        text not null check (kind in ('invitation', 'share', 'link', 'plugin', 'system')),
    title       text not null,
    body        text not null default '',
    link        text not null default '',
    source      text not null default 'kernel',
    resource_id uuid,
    data        jsonb not null default '{}',
    read_at     timestamptz,
    emailed     boolean not null default false,
    created_at  timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index core_notifications_user on core_notifications (user_id, created_at);
create index core_notifications_unread on core_notifications (user_id) where read_at is null;

create table core_notification_prefs (
    user_id     uuid primary key references core_users(id) on delete cascade,
    email       text check (email in ('off', 'immediate', 'digest')),
    kinds       jsonb not null default '{}',
    updated_at  timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table core_mail_outbox (
    id          uuid primary key default (gen_random_uuid()),
    to_addr     text not null,
    subject     text not null,
    body        text not null,
    status      text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
    attempts    int not null default 0,
    next_at     timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_error  text not null default '',
    created_at  timestamptz not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    sent_at     timestamptz
);
create index core_mail_outbox_due on core_mail_outbox (status, next_at);
