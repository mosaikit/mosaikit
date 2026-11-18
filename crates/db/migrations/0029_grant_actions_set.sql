-- A grant made with a list of actions (even an empty one) limits what its holder may do among the actions of the
-- plugin; a grant made without one (every share before this, and the plain ones) leaves them as they were. The
-- kernel asks this for the actions it enforces itself, like the download of a file (kernel/src/actions.rs).
alter table core.grants add column actions_set boolean not null default false;
