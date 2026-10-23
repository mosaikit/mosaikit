-- The picture a person sets in Account › Profile: its type and a version that changes with every new
-- picture (the file is with the identity images of the home tenant, docs/architecture.md).

alter table core.users add column picture_type text;
alter table core.users add column picture_v text;
