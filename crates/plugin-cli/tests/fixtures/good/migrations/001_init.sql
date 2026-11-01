-- the table of the items
create table items_extra (
  resource_id uuid not null,
  tenant_id uuid not null,
  note text
);
create index on items_extra (resource_id);
