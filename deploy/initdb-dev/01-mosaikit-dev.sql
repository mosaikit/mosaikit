-- Ruolo e database di sviluppo (stessi del cluster locale di `cargo xtask db up`).
CREATE ROLE mosaikit_dev LOGIN CREATEDB CREATEROLE PASSWORD 'mosaikit_dev';
CREATE DATABASE mosaikit OWNER mosaikit_dev;
-- PostGIS, se l'immagine lo include (anche nei database dei test, tramite template1)
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
