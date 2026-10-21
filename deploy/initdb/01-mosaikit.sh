#!/bin/sh
# Primo avvio del container PostgreSQL: ruolo applicativo (non superutente,
# con CREATEROLE per i ruoli dei plugin) e database di Mosaikit.
# Con un'immagine PostGIS (POSTGRES_IMAGE=postgis/postgis:...) l'estensione viene
# creata qui: il ruolo applicativo non puo' farlo da solo.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE mosaikit_app LOGIN CREATEROLE PASSWORD '${MOSAIKIT_DB_PASSWORD}';
CREATE DATABASE mosaikit OWNER mosaikit_app;
SQL
if psql -tA --username "$POSTGRES_USER" --dbname mosaikit -c "select 1 from pg_available_extensions where name = 'postgis'" | grep -q 1; then
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname mosaikit -c "CREATE EXTENSION IF NOT EXISTS postgis"
fi
