-- Actions of a share (see kernel/src/actions.rs): comma separated names, empty: none.
alter table core_grants add column actions text not null default '';
