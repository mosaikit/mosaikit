-- Data of the load test on PostgreSQL (cargo xtask perf, docs/reports/performance.md).
-- Variables (psql -v): tenants, people (per tenant), notes, tasks, files (per tenant), events (total).
-- Deterministic: the same variables give the same data. Run as the owner of the database, after the
-- server has created the schema and installed the plugins.

\set ON_ERROR_STOP on
select setseed(0.42);
set synchronous_commit = off;

-- ---------------------------------------------------------------- tenants and people
insert into core.tenants (slug, name)
select format('t%s', lpad(i::text, 4, '0')), format('Tenant %s', i)
from generate_series(1, :tenants) i;

create temp table pt as
select t.id as tenant_id, row_number() over (order by t.slug)::int as ti from core.tenants t where not t.is_system;

insert into core.permission_profiles (tenant_id, name, description, is_default)
select tenant_id, 'Standard', 'The permissions every plugin gives by default.', true from pt;

-- the people get the password of the administrator (one argon2 hash, already computed)
insert into core.users (home_tenant_id, username, display_name, email, password_hash, last_sign_in_at)
select pt.tenant_id, format('u%s-%s', lpad(pt.ti::text, 4, '0'), lpad(j::text, 3, '0')),
       format('Person %s of tenant %s', j, pt.ti), format('u%s-%s@example.org', pt.ti, j),
       (select password_hash from core.users where username = 'admin'), now() - random() * interval '30 days'
from pt, generate_series(0, :people - 1) j;

create temp table pu as
select u.id as user_id, pt.tenant_id, pt.ti, split_part(u.username, '-', 2)::int as uj
from core.users u join pt on pt.tenant_id = u.home_tenant_id;
create index on pu (ti, uj);
analyze pu;

insert into core.memberships (tenant_id, user_id, role)
select tenant_id, user_id, case when uj < 2 then 'tenant_manager' else 'user' end from pu;
-- guests: 5% of the people are also members of the next tenant
insert into core.memberships (tenant_id, user_id, role)
select n.tenant_id, pu.user_id, 'user'
from pu join pt n on n.ti = (pu.ti % :tenants) + 1
where pu.uj % 20 = 7 and n.tenant_id <> pu.tenant_id;

-- groups: 5 per tenant, everyone in one or two of them
insert into core.groups (tenant_id, name)
select tenant_id, format('Group %s', g) from pt, generate_series(1, 5) g;
create temp table pg_ as
select g.id as group_id, pt.ti, split_part(g.name, ' ', 2)::int as gj
from core.groups g join pt on pt.tenant_id = g.tenant_id;
insert into core.group_members (group_id, user_id)
select g.group_id, pu.user_id from pu join pg_ g on g.ti = pu.ti and g.gj = (pu.uj % 5) + 1;
insert into core.group_members (group_id, user_id)
select g.group_id, pu.user_id from pu join pg_ g on g.ti = pu.ti and g.gj = ((pu.uj + 2) % 5) + 1
where pu.uj % 3 = 0
on conflict do nothing;

-- ---------------------------------------------------------------- items
-- owner: a random person of the tenant; dates over the last year
create temp table pr (id uuid, tenant_id uuid, ti int, plugin text, kind text, owner uuid, title text, n int);

insert into pr
select gen_random_uuid(), x.tenant_id, x.ti, 'com.mosaikit.notes', 'notes', pu.user_id,
       format('Note %s of tenant %s about %s', x.n, x.ti,
              (array['budget','roadmap','meeting','invoice','contract','travel','design','release'])[1 + x.n % 8]),
       x.n
from (select pt.tenant_id, pt.ti, n, floor(random() * :people)::int as oj from pt, generate_series(1, :notes) n) x
join pu on pu.ti = x.ti and pu.uj = x.oj;

insert into pr
select gen_random_uuid(), x.tenant_id, x.ti, 'com.mosaikit.tasks', 'tasks', pu.user_id,
       format('Task %s of tenant %s', x.n, x.ti), x.n
from (select pt.tenant_id, pt.ti, n, floor(random() * :people)::int as oj from pt, generate_series(1, :tasks) n) x
join pu on pu.ti = x.ti and pu.uj = x.oj;

insert into core.resources (id, tenant_id, plugin_id, kind, owner_id, title, size_bytes, search_text, created_at, updated_at)
select id, tenant_id, plugin, kind, owner, title, 0,
       case when n % 20 = 0 then null
            when kind = 'notes' then format('Text of the note %s: words alpha%s beta%s', n, n % 97, n % 31)
            else '' end,
       ts, ts + random() * interval '10 days'
from (select pr.*, now() - random() * interval '365 days' as ts from pr) x;

insert into plg_com_mosaikit_notes.notes (resource_id, tenant_id, title, body, tag)
select id, tenant_id, title, format('Text of the note %s: words alpha%s beta%s', n, n % 97, n % 31),
       (array['personal','work','urgent', null])[1 + n % 4]
from pr where plugin = 'com.mosaikit.notes';

insert into plg_com_mosaikit_tasks.tasks (resource_id, tenant_id, title, due, priority, done, completed_on)
select id, tenant_id, title, (now() + (n % 60 - 30) * interval '1 day')::date,
       (array['low','medium','high'])[1 + n % 3], n % 3 = 0, case when n % 3 = 0 then now()::date end
from pr where plugin = 'com.mosaikit.tasks';

-- files: a fifth are folders at the top, the rest files inside them
create temp table pf as
select gen_random_uuid() as id, x.tenant_id, x.ti, x.n, pu.user_id as owner
from (select pt.tenant_id, pt.ti, n, floor(random() * :people)::int as oj from pt, generate_series(1, :files) n) x
join pu on pu.ti = x.ti and pu.uj = x.oj;
insert into core.resources (id, tenant_id, plugin_id, kind, owner_id, title, meta, search_text)
select id, tenant_id, 'com.mosaikit.files', 'folder', owner, format('Folder %s', n), '{}', ''
from pf where n % 5 = 0;
insert into core.resources (id, tenant_id, plugin_id, kind, parent_id, ancestors, owner_id, title, size_bytes, meta, search_text)
select f.id, f.tenant_id, 'com.mosaikit.files', 'file', d.id, array[d.id], f.owner,
       format('Document %s.pdf', f.n), 1000 + (f.n * 7919) % 5000000, '{"mime":"application/pdf"}', ''
from pf f join pf d on d.tenant_id = f.tenant_id and d.n = ((f.n / 5) * 5 + 5)
where f.n % 5 <> 0 and d.n <= :files;

-- shares: 2% of the items, to a person or a group of the tenant
insert into core.grants (resource_id, principal_type, principal_id, level)
select r.id, case when r.n % 2 = 0 then 'user' else 'group' end,
       case when r.n % 2 = 0 then pu.user_id else g.group_id end,
       1 + r.n % 2
from pr r
join pu on pu.ti = r.ti and pu.uj = (r.n * 13) % :people
join pg_ g on g.ti = r.ti and g.gj = 1 + r.n % 5
where r.n % 50 = 1
on conflict do nothing;

-- public links on 0.5% of the notes
insert into core.public_links (resource_id, token_hash, created_by)
select r.id, sha256(convert_to('perf-link-' || r.id, 'utf8')), r.owner
from pr r where r.plugin = 'com.mosaikit.notes' and r.n % 200 = 3;

-- trash: 1% of the items
update core.resources r set deleted_at = now() - random() * interval '20 days', deleted_by = r.owner_id
from pr where pr.id = r.id and pr.n % 100 = 9;

-- ---------------------------------------------------------------- log, notifications, sessions
-- events in time order, as the server writes them (the id grows with the instant)
insert into core.events (ts, tenant_id, user_id, plugin_id, resource_id, action, detail, ok, ip, agent)
select now() - (1 - i::float / :events) * interval '365 days', pu.tenant_id, pu.user_id,
       case when i % 3 = 0 then 'com.mosaikit.notes' end,
       null,
       (array['auth.login','crud.create','crud.update','crud.delete','share.grant','link.create','auth.logout','files.upload'])[1 + i % 8],
       '{}', i % 50 <> 0, '10.0.' || (i % 250) || '.' || (i % 200), 'Mozilla/5.0 perf'
from generate_series(1, :events) i
join pu on pu.ti = 1 + (i * 7) % :tenants and pu.uj = (i * 11) % :people;

insert into core.notifications (user_id, tenant_id, kind, title, body, link, created_at, read_at)
select pu.user_id, pu.tenant_id, (array['share','link','system','plugin'])[1 + k % 4],
       format('Notification %s', k), 'Something happened', '#/', now() - k * interval '1 day',
       case when k > 3 then now() end
from pu, generate_series(1, 10) k;

-- sessions for the measures: the token is hex(sha256("perf-<username>")), the CSRF "perf-csrf"
insert into core.sessions (token_hash, user_id, csrf, expires_at)
select sha256(convert_to(encode(sha256(convert_to('perf-' || u.username, 'utf8')), 'hex'), 'utf8')), u.id,
       'perf-csrf', now() + interval '7 days'
from core.users u
where case when u.username ~ '^u[0-9]+-[0-9]+$' then split_part(u.username, '-', 2)::int < 12
           else u.username = 'admin' end;

analyze core.tenants, core.users, core.memberships, core.groups, core.group_members, core.resources,
    core.grants, core.public_links, core.events, core.notifications, core.sessions,
    plg_com_mosaikit_notes.notes, plg_com_mosaikit_tasks.tasks;
