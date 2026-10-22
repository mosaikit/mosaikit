#!/bin/sh
# First start of the PostgreSQL container: application role (not a superuser,
# with CREATEROLE for the roles of the plugins) and the database of Mosaikit.
# With a PostGIS image (POSTGRES_IMAGE=postgis/postgis:...) the extension is
# created here: the application role cannot do it by itself.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE mosaikit_app LOGIN CREATEROLE PASSWORD '${MOSAIKIT_DB_PASSWORD}';
CREATE DATABASE mosaikit OWNER mosaikit_app;
SQL
if psql -tA --username "$POSTGRES_USER" --dbname mosaikit -c "select 1 from pg_available_extensions where name = 'postgis'" | grep -q 1; then
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname mosaikit -c "CREATE EXTENSION IF NOT EXISTS postgis"
fi
