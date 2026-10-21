-- Administrator come account di piattaforma: esistono solo nel tenant di sistema,
-- che non e' uno spazio di lavoro (nessun membro, nessuna risorsa). Accesso locale
-- con secondo fattore TOTP. Vedi docs/architettura.md §3.

-- secondo fattore (TOTP, RFC 6238) e codici di recupero (sha256 in esadecimale, JSON)
alter table core.users
    add column totp_secret    text,
    add column totp_enabled   boolean not null default false,
    add column totp_last_step bigint not null default 0,
    add column totp_recovery  text not null default '[]';

-- sessione in attesa del secondo fattore: vale solo per completare l'accesso
alter table core.sessions
    add column pending text check (pending in ('totp', 'totp_setup'));

-- gli Administrator di altri tenant diventano account del tenant di sistema (stessa
-- password); l'account originale resta, senza il ruolo
insert into core.users (home_tenant_id, username, display_name, email, password_hash, is_system_admin)
select s.id,
       case when exists (select 1 from core.users x where x.home_tenant_id = s.id and x.username = u.username)
            then left(u.username || '-' || t.slug, 64) else u.username end,
       u.display_name, u.email, u.password_hash, true
from core.users u
join core.tenants t on t.id = u.home_tenant_id and not t.is_system
cross join (select id from core.tenants where is_system) s
where u.is_system_admin;

update core.users set is_system_admin = false
where is_system_admin and home_tenant_id not in (select id from core.tenants where is_system);

-- nel tenant di sistema solo Administrator
update core.users set status = 'disabled'
where not is_system_admin and home_tenant_id in (select id from core.tenants where is_system);

-- nessuna membership che coinvolga il tenant di sistema o i suoi account
delete from core.grants
where principal_type = 'user'
  and principal_id in (select u.id from core.users u join core.tenants t on t.id = u.home_tenant_id where t.is_system);
delete from core.group_members
where user_id in (select u.id from core.users u join core.tenants t on t.id = u.home_tenant_id where t.is_system);
delete from core.invitations
where tenant_id in (select id from core.tenants where is_system)
   or user_id in (select u.id from core.users u join core.tenants t on t.id = u.home_tenant_id where t.is_system);
delete from core.memberships
where tenant_id in (select id from core.tenants where is_system)
   or user_id in (select u.id from core.users u join core.tenants t on t.id = u.home_tenant_id where t.is_system);

-- ruoli cambiati: nuovo accesso per tutti
delete from core.sessions;
