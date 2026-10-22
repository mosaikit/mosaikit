-- Notifications (docs/architecture.md, notifications): what the kernel and the plugins tell a person,
-- the preferences of each person and the queue of the emails.
--
-- A notification belongs to one person; `tenant_id` says which tenant it is about (null: the
-- platform, for the Administrators). `data` carries the parameters of the text (`code`, names) so that
-- the interface can show it in the language of the person; `title` and `body` are the English text,
-- also used in the emails.

create table core.notifications (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references core.users(id) on delete cascade,
    tenant_id   uuid references core.tenants(id) on delete cascade,
    kind        text not null check (kind in ('invitation', 'share', 'link', 'plugin', 'system')),
    title       text not null,
    body        text not null default '',
    link        text not null default '',
    -- 'kernel' or the id of the plugin that sent it
    source      text not null default 'kernel',
    resource_id uuid,
    data        jsonb not null default '{}',
    read_at     timestamptz,
    -- sent by email (at once or in the daily digest)
    emailed     boolean not null default false,
    created_at  timestamptz not null default now()
);
create index notifications_user on core.notifications (user_id, created_at);
create index notifications_unread on core.notifications (user_id) where read_at is null;

-- What a person receives by email: `email` is the mode (null: the default of the tenant or of the
-- platform), `kinds` the kinds sent by email (kind -> bool, missing: the default of the kind).
create table core.notification_prefs (
    user_id     uuid primary key references core.users(id) on delete cascade,
    email       text check (email in ('off', 'immediate', 'digest')),
    kinds       jsonb not null default '{}',
    updated_at  timestamptz not null default now()
);

-- Emails to send, with retries.
create table core.mail_outbox (
    id          uuid primary key default gen_random_uuid(),
    to_addr     text not null,
    subject     text not null,
    body        text not null,
    status      text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
    attempts    int not null default 0,
    next_at     timestamptz not null default now(),
    last_error  text not null default '',
    created_at  timestamptz not null default now(),
    sent_at     timestamptz
);
create index mail_outbox_due on core.mail_outbox (status, next_at);
