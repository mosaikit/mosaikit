-- Email required for local accounts (review round 1, D9).
-- An account without an address (made before the rule) keeps working: it is flagged in the lists
-- ("email missing") and the next edit of the account must give one. An empty text counts as no address.
update core.users set email = null where email is not null and btrim(email) = '';
-- the lookup of "Forgot your password?" by address
create index users_email_lower on core.users (lower(email)) where email is not null;
