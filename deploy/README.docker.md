# {{name}} {{version}} con Docker

Installazione di {{name}} su un server con **Docker Compose**: l'app e il suo
database PostgreSQL, con volumi persistenti.

```
{{id}}-{{version}}-docker/
├── {{id}}-{{version}}-image.tar   immagine dell'app
├── compose.yml                    PostgreSQL + app
├── .env                           immagine, password, indirizzi e porte
├── initdb/                        prima inizializzazione del database
└── README.md
```

## Requisiti

Docker Engine 24 o successivo con il plugin Compose (`docker compose`).

## Installazione

1. **Immagine:**

   ```sh
   docker load -i {{id}}-{{version}}-image.tar
   ```

2. **Configurazione:** modifica `.env`:
   - password (`POSTGRES_PASSWORD`, `MOSAIKIT_DB_PASSWORD`,
     `MOSAIKIT_ADMIN_PASSWORD`);
   - indirizzi pubblici (`MOSAIKIT_URL`, `MOSAIKIT_PLUGIN_URL`);
   - porte pubblicate sull'host (`MOSAIKIT_HTTP_PORT`, `MOSAIKIT_PLUGIN_PORT`).

   Il database usa l'immagine `{{postgres_image}}`, scaricata da Docker Hub al
   primo avvio.

3. **Avvio:**

   ```sh
   docker compose up -d
   docker compose ps                 # attendi che "app" sia healthy
   ```

   Al primo avvio l'app applica le migrazioni del database e installa i plugin
   inclusi. Accesso: `MOSAIKIT_URL` + `#/admin` (*Accesso amministratori*), utente `admin`, password
   `MOSAIKIT_ADMIN_PASSWORD`; cambiala subito dalla pagina Account. Al primo
   accesso registri il secondo fattore (app di autenticazione, QR code) e ricevi
   i codici di recupero. Telefono perso: `docker compose exec app
   /app/mosaikit-server reset-totp --user admin`.

## Produzione

Metti un reverse proxy HTTPS davanti, con **due hostname**: uno per l'app (porta
`MOSAIKIT_HTTP_PORT`) e uno per plugin, file caricati e link pubblici (porta
`MOSAIKIT_PLUGIN_PORT`). Le due origini devono essere diverse: il codice dei
plugin non deve poter leggere i cookie dell'app. Poi in `.env`:

```sh
MOSAIKIT_URL=https://{{id}}.esempio.it            # anche con percorso base: .../{{id}}
MOSAIKIT_PLUGIN_URL=https://plugins.{{id}}.esempio.it
MOSAIKIT_TRUST_PROXY=true                          # il proxy imposta X-Forwarded-For
```

Con `https://` il cookie di sessione diventa `Secure`.

## Configurazione

Ogni proprieta' di `mosaikit.toml` si imposta con la variabile `MOSAIKIT_*`
corrispondente nella sezione `environment` dell'app in `compose.yml`; l'elenco
completo, con le descrizioni, e' in `mosaikit.example.toml` nell'immagine
(`/app/mosaikit.example.toml`).

Comandi di amministrazione:

```sh
docker compose exec app /app/mosaikit-server config
docker compose exec -it app /app/mosaikit-server reset-password --user admin
```

## Dati, backup, aggiornamento

- Volumi: `pgdata` (database) e `appdata` (file caricati, pacchetti dei plugin).
- Backup: `docker compose exec db pg_dump -U postgres mosaikit > backup.sql` e
  una copia del volume `appdata`.
- Aggiornamento: `docker load` della nuova immagine, `MOSAIKIT_VERSION` in
  `.env`, poi `docker compose up -d` (le migrazioni si applicano all'avvio).

Per Kubernetes vedi la cartella `{{id}}-{{version}}-k8s` della stessa release.
