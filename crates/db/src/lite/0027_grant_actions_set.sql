-- A grant made with a list of actions (even an empty one) limits what its holder may do among the actions of the
-- plugin; a grant made without one leaves them as they were (see kernel/src/actions.rs).
alter table core_grants add column actions_set integer not null default 0;
