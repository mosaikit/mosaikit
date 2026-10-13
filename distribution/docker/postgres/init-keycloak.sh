#!/bin/sh
# SPDX-FileCopyrightText: 2026 Massimo Antonini
# SPDX-License-Identifier: MPL-2.0
#
# First start of PostgreSQL: a database and a user for Keycloak, next to the one of Mosaikit.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v password="$KEYCLOAK_DB_PASSWORD" <<'SQL'
CREATE USER keycloak WITH PASSWORD :'password';
CREATE DATABASE keycloak OWNER keycloak;
SQL
