# syntax=docker/dockerfile:1.7
# Immagine del server di una distribuzione Mosaikit (multi-stage).
#
# Il contesto di build e' la cartella che contiene mosaikit, mosaikit-plugins e
# le eventuali distribuzioni (es. geoportal): i plugin stanno in progetti separati.
# Costruzione (passa la chiave di firma come secret):
#   cargo xtask release docker                       # Mosaikit
#   cargo xtask --dist ../geoportal release docker   # un'altra distribuzione
# oppure a mano, dalla cartella superiore:
#   docker build -f mosaikit/deploy/Dockerfile --build-arg DIST=mosaikit \
#     --secret id=signing_key,src=<file> -t mosaikit:1.0.0 .
# Senza secret i plugin vengono firmati con una chiave usa e getta generata nella build.
# I file esclusi dal contesto sono in Dockerfile.dockerignore.

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
# UI host, plugin (WASM e UI) firmati, registry e configurazione in /out
RUN --mount=type=secret,id=signing_key,required=false \
    --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/mosaikit/target \
    --mount=type=cache,target=/root/.npm \
    if [ -s /run/secrets/signing_key ]; then export MOSAIKIT_SIGNING_KEY_FILE=/run/secrets/signing_key; fi && \
    cd /src/mosaikit && \
    cargo xtask --dist "/src/${DIST}" release bundle --out /out --flavor server

# ---------------------------------------------------------------- runtime
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home /data mosaikit \
    && mkdir -p /data && chown mosaikit /data
COPY --from=build /out/ /app/
WORKDIR /app
ENV MOSAIKIT_CONFIG=/app/mosaikit.toml \
    MOSAIKIT_LOG=info,sqlx=warn
VOLUME ["/data"]
EXPOSE 8080 8081
USER mosaikit
# il percorso base dell'app viene da MOSAIKIT_URL (es. https://gis.esempio.it/mosaikit)
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD \
    p=$(printf '%s' "${MOSAIKIT_URL:-}" | sed -E 's#^[a-z]+://[^/]*##; s#/$##'); \
    curl -fsS "http://127.0.0.1:8080${p}/api/health" || exit 1
ENTRYPOINT ["/app/mosaikit-server"]
CMD ["serve"]
