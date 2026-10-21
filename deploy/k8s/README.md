# {{name}} {{version}} su Kubernetes

Manifest **kustomize** per installare {{name}} su un cluster Kubernetes: l'app e
il suo database PostgreSQL, con volumi persistenti e un Ingress con due hostname.

```
{{id}}-{{version}}-k8s/
├── kustomization.yaml   insieme dei manifest, immagini, ConfigMap e Secret generati
├── namespace.yaml       namespace {{id}}
├── postgres.yaml        PostgreSQL: StatefulSet + Service + volume da 10 Gi
├── app.yaml             app: Deployment + Service + volume da 10 Gi
├── ingress.yaml         due hostname: app e plugin (origini separate)
├── config.env           indirizzi e opzioni (ConfigMap)
├── secret.env           password (Secret)
├── initdb/              prima inizializzazione del database
└── README.md
```

## Requisiti

- Kubernetes 1.27 o successivo, `kubectl` (kustomize e' incluso);
- una StorageClass di default (volumi `ReadWriteOnce`);
- un Ingress controller (i manifest usano **ingress-nginx**: `ingressClassName: nginx`);
- un registry raggiungibile dal cluster per l'immagine dell'app;
- per HTTPS: un certificato nel Secret `{{id}}-tls` oppure **cert-manager**.

## Installazione

1. **Immagine.** Carica l'immagine nel registry del cluster:

   ```sh
   docker load -i ../{{id}}-{{version}}-docker/{{id}}-{{version}}-image.tar
   docker tag {{image}}:{{version}} registry.esempio.it/{{image}}:{{version}}
   docker push registry.esempio.it/{{image}}:{{version}}
   ```

   poi in `kustomization.yaml`, sezione `images`, imposta
   `newName: registry.esempio.it/{{image}}`. Con un registry privato aggiungi
   `imagePullSecrets` al Deployment.

2. **Hostname.** L'app e la parte "plugin" (UI dei plugin, file caricati, link
   pubblici) devono stare su **due origini diverse**: e' una regola di sicurezza,
   il codice dei plugin non deve poter leggere i cookie dell'app. Sostituisci
   `{{id}}.esempio.it` e `plugins.{{id}}.esempio.it` in `ingress.yaml` e in
   `config.env` (`MOSAIKIT_URL`, `MOSAIKIT_PLUGIN_URL`). L'app puo' stare anche
   sotto un percorso base, es. `MOSAIKIT_URL=https://gis.esempio.it/{{id}}`:
   in quel caso l'Ingress continua a inoltrare tutto il dominio.

3. **Password.** Cambia i valori in `secret.env`. Non committare il file: in
   produzione genera il Secret con il gestore di segreti del cluster (Sealed
   Secrets, External Secrets, Vault) e togli `secretGenerator` da
   `kustomization.yaml`.

4. **HTTPS.** Crea il Secret `{{id}}-tls` con il certificato dei due hostname,
   oppure con cert-manager togli il commento all'annotazione
   `cert-manager.io/cluster-issuer` in `ingress.yaml`.

5. **Installa:**

   ```sh
   kubectl apply -k .
   kubectl -n {{id}} get pods -w          # attendi che app e postgres siano Ready
   ```

   Al primo avvio l'app applica le migrazioni del database e installa i plugin
   inclusi. Accesso: `MOSAIKIT_URL` + `#/admin` (*Accesso amministratori*), utente `admin`, password
   `MOSAIKIT_ADMIN_PASSWORD`; cambiala subito dalla pagina Account. Al primo
   accesso registri il secondo fattore (app di autenticazione, QR code) e ricevi
   i codici di recupero. Telefono perso:
   `kubectl -n {{id}} exec deploy/{{id}} -- /app/mosaikit-server reset-totp --user admin`.

## Configurazione

Ogni proprieta' di `mosaikit.toml` si imposta con la variabile `MOSAIKIT_*`
corrispondente in `config.env`; l'elenco completo, con le descrizioni, e' in
`mosaikit.example.toml` dentro l'immagine (`/app/mosaikit.example.toml`) e nella
release desktop. Dopo una modifica: `kubectl apply -k .` (la ConfigMap cambia
nome e il Deployment si riavvia da solo).

Comandi di amministrazione dentro il pod:

```sh
kubectl -n {{id}} exec deploy/{{id}} -- /app/mosaikit-server config
kubectl -n {{id}} exec -it deploy/{{id}} -- /app/mosaikit-server reset-password --user admin
```

## Database

- **Incluso** (`postgres.yaml`): un'istanza PostgreSQL con volume da 10 Gi.
  Immagine: `{{postgres_image}}`.
- **Gestito** (consigliato in produzione: backup e alta affidabilita' del
  fornitore): togli `postgres.yaml` da `kustomization.yaml`, crea sul server il
  ruolo e il database come fa `initdb/01-mosaikit.sh` (ruolo `mosaikit_app` con
  `CREATEROLE`, database `mosaikit`, eventuale `CREATE EXTENSION postgis`) e
  imposta `MOSAIKIT_DATABASE_URL` in `app.yaml` con l'indirizzo del server.

## Scalabilita' e dati

- L'app gira con **una replica**: file caricati e pacchetti dei plugin stanno sul
  volume `{{id}}-data` (`ReadWriteOnce`). Sessioni e dati sono nel database.
- Aggiornamento `Recreate`: la nuova versione parte dopo l'arresto della vecchia
  e applica le migrazioni all'avvio.
- Dimensioni dei volumi: modifica `storage` in `postgres.yaml` e `app.yaml`
  prima della prima installazione.

## Backup

- Database: `kubectl -n {{id}} exec {{id}}-postgres-0 -- pg_dump -U postgres mosaikit > backup.sql`
  (o i backup del PostgreSQL gestito).
- File: copia del volume `{{id}}-data` (snapshot della StorageClass o
  `kubectl cp {{id}}/<pod>:/data ./data`).

## Aggiornamento

1. Carica la nuova immagine nel registry e aggiorna `newTag` in `kustomization.yaml`.
2. `kubectl apply -k .`

## Disinstallazione

```sh
kubectl delete -k .                       # app, servizi, ingress
kubectl delete namespace {{id}}           # anche i volumi (dati!)
```
