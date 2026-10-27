-- The ID token of a sign-in through a provider, encrypted (see migrations/0016_session_id_token.sql).
alter table core_sessions add column oidc_id_token bytea;
