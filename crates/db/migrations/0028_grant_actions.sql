-- Actions of a share: names a plugin declares per resource type (see kernel/src/actions.rs), set per person or
-- group next to the level. Comma separated names ("download,run"); empty: none. Manage implies every action.
alter table core.grants add column actions text not null default '';
