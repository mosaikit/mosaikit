-- Development role and database (the same as the local cluster of `cargo xtask db up`).
CREATE ROLE mosaikit_dev LOGIN CREATEDB CREATEROLE PASSWORD 'mosaikit_dev';
CREATE DATABASE mosaikit OWNER mosaikit_dev;
-- PostGIS, if the image includes it (in the test databases too, through template1)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'postgis') THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS postgis';
  END IF;
END $$;
\c template1
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'postgis') THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS postgis';
  END IF;
END $$;
