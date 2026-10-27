-- Email required for local accounts (see migrations/0020_email_required.sql for PostgreSQL).
update core_users set email = null where email is not null and trim(email) = '';
create index core_users_email_lower on core_users (lower(email)) where email is not null;
