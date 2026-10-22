# syntax=docker/dockerfile:1.7
# Image of the server of a Mosaikit distribution (multi-stage).
#
# The context contains mosaikit, the plugin folders (e.g. mosaikit-plugins) and the
# folder of the distribution, side by side as locally: `cargo xtask release docker`
# prepares it in a temporary folder reading distribution.toml and passes the signing
# key as a secret:
#   cargo xtask release docker                       # Mosaikit
#   cargo xtask --dist ../product release docker     # a distribution
# or by hand, from the parent folder:
#   docker build -f mosaikit/deploy/Dockerfile --build-arg DIST=mosaikit \
#     --secret id=signing_key,src=<file> -t mosaikit:1.0.0 .
# Without the secret the plugins are signed with a throwaway key generated in the build.
# The files excluded from the context are in Dockerfile.dockerignore.

ARG DIST=mosaikit

FROM node:24-bookworm-slim AS node

# ---------------------------------------------------------------- build (Rust + Node)
FROM rust:1-bookworm AS build
ARG DIST
RUN rustup target add wasm32-unknown-unknown
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
WORKDIR /src
COPY . .
# host UI, signed plugins (WASM and UI), registry and configuration in /out
RUN --mount=type=secret,id=signing_key,required=false \
    --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/mosaikit/target \
    --mount=type=cache,target=/root/.npm \
    if [ -s /run/secrets/signing_key ]; then export MOSAIKIT_SIGNING_KEY_FILE=/run/secrets/signing_key; fi && \
    cd /src/mosaikit && \
    cargo xtask --dist "/src/${DIST}" release bundle --out /out --flavor server

# ---------------------------------------------------------------- runtime
FROM debian:bookworm-slim
# PostgreSQL client tools for the scheduled backups (System › Backup and restore): pg_dump from the
# PostgreSQL apt repository, of the newest major version the releases support. pg_dump dumps servers of
# its own major version or older, never newer: keep PG_CLIENT_MAJOR >= the major version of the server
# (the default database image is postgres:17). With an older pg_dump the backup records the reason and
# still holds every tenant.
ARG PG_CLIENT_MAJOR=17
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
       | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends "postgresql-client-${PG_CLIENT_MAJOR}" \
    && apt-get purge -y gnupg && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home /data mosaikit \
    && mkdir -p /data && chown mosaikit /data
COPY --from=build /out/ /app/
WORKDIR /app
ENV MOSAIKIT_CONFIG=/app/mosaikit.toml \
    MOSAIKIT_LOG=info,sqlx=warn \
    MOSAIKIT_PG_BIN=/usr/lib/postgresql/${PG_CLIENT_MAJOR}/bin
VOLUME ["/data"]
EXPOSE 8080 8081
USER mosaikit
# the base path of the app comes from MOSAIKIT_URL (e.g. https://gis.example.com/mosaikit)
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD \
    p=$(printf '%s' "${MOSAIKIT_URL:-}" | sed -E 's#^[a-z]+://[^/]*##; s#/$##'); \
    curl -fsS "http://127.0.0.1:8080${p}/api/health" || exit 1
ENTRYPOINT ["/app/mosaikit-server"]
CMD ["serve"]
