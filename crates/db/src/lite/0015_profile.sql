-- The picture of Account › Profile (see migrations/0017_profile.sql for PostgreSQL).

alter table core_users add column picture_type text;
alter table core_users add column picture_v text;
