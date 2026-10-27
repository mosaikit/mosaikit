-- The ID token of a sign-in through the identity provider of a tenant, encrypted with the key of the
-- installation, kept with its session for the sign-out (`id_token_hint` to the end-session endpoint).
-- It goes away with the session (sign-out, expiry, closed sessions).
alter table core.sessions add column oidc_id_token bytea;
