# {{name}} {{version}} on Kubernetes

**kustomize** manifests to install {{name}} on a Kubernetes cluster: the app and
its PostgreSQL database, with persistent volumes and an Ingress with two hostnames.

```
{{id}}-{{version}}-k8s/
├── kustomization.yaml   set of the manifests, images, generated ConfigMap and Secret
├── namespace.yaml       namespace {{id}}
├── postgres.yaml        PostgreSQL: StatefulSet + Service + 10 Gi volume
├── app.yaml             app: Deployment + Service + 10 Gi volume
├── ingress.yaml         two hostnames: app and plugins (separate origins)
├── config.env           addresses and options (ConfigMap)
├── secret.env           passwords (Secret)
├── initdb/              first initialization of the database
└── README.md
```

## Requirements

- Kubernetes 1.27 or later, `kubectl` (kustomize is included);
- a default StorageClass (`ReadWriteOnce` volumes);
- an Ingress controller (the manifests use **ingress-nginx**: `ingressClassName: nginx`);
- a registry the cluster can reach for the image of the app;
- for HTTPS: a certificate in the Secret `{{id}}-tls` or **cert-manager**.

## Installation

1. **Image.** Push the image to the registry of the cluster:

   ```sh
   docker load -i ../{{id}}-{{version}}-docker/{{id}}-{{version}}-image.tar
   docker tag {{image}}:{{version}} registry.example.com/{{image}}:{{version}}
   docker push registry.example.com/{{image}}:{{version}}
   ```

   then in `kustomization.yaml`, section `images`, set
   `newName: registry.example.com/{{image}}`. With a private registry add
   `imagePullSecrets` to the Deployment.

2. **Hostnames.** The app and the "plugin" part (plugin UIs, uploaded files, public
   links) must be on **two different origins**: it is a security rule, the code of
   the plugins must not be able to read the cookies of the app. Replace
   `{{id}}.example.com` and `plugins.{{id}}.example.com` in `ingress.yaml` and in
   `config.env` (`MOSAIKIT_URL`, `MOSAIKIT_PLUGIN_URL`). The app can also live
   under a base path, e.g. `MOSAIKIT_URL=https://gis.example.com/{{id}}`:
   in that case the Ingress still forwards the whole domain.

3. **Passwords.** Change the values in `secret.env`. Do not commit the file: in
   production generate the Secret with the secret manager of the cluster (Sealed
   Secrets, External Secrets, Vault) and remove `secretGenerator` from
   `kustomization.yaml`.

4. **HTTPS.** Create the Secret `{{id}}-tls` with the certificate of the two hostnames,
   or with cert-manager uncomment the annotation
   `cert-manager.io/cluster-issuer` in `ingress.yaml`.

5. **Install:**

   ```sh
   kubectl apply -k .
   kubectl -n {{id}} get pods -w          # wait until app and postgres are Ready
   ```

   At the first start the app applies the database migrations and installs the included
   plugins. Sign-in: `MOSAIKIT_URL` + `#/admin` (*Administrator access*), user `admin`, password
   `MOSAIKIT_ADMIN_PASSWORD`; change it at once from the Account page. At the first
   sign-in you register the second factor (authenticator app, QR code) and receive
   the recovery codes. Lost phone:
   `kubectl -n {{id}} exec deploy/{{id}} -- /app/mosaikit-server reset-totp --user admin`.

## Configuration

Every property of `mosaikit.toml` is set with the matching `MOSAIKIT_*` variable
in `config.env`; the full list, with descriptions, is in
`mosaikit.example.toml` inside the image (`/app/mosaikit.example.toml`) and in the
desktop release. After a change: `kubectl apply -k .` (the ConfigMap changes
name and the Deployment restarts by itself).

Administration commands inside the pod:

```sh
kubectl -n {{id}} exec deploy/{{id}} -- /app/mosaikit-server config
kubectl -n {{id}} exec -it deploy/{{id}} -- /app/mosaikit-server reset-password --user admin
```

## Database

- **Included** (`postgres.yaml`): a PostgreSQL instance with a 10 Gi volume.
  Image: `{{postgres_image}}`.
- **Managed** (recommended in production: backups and high availability of the
  provider): remove `postgres.yaml` from `kustomization.yaml`, create on the server the
  role and the database as `initdb/01-mosaikit.sh` does (role `mosaikit_app` with
  `CREATEROLE`, database `mosaikit`, optionally `CREATE EXTENSION postgis`) and
  set `MOSAIKIT_DATABASE_URL` in `app.yaml` with the address of the server.

## Scalability and data

- The app runs with **one replica**: uploaded files and plugin packages are on the
  volume `{{id}}-data` (`ReadWriteOnce`). Sessions and data are in the database.
- `Recreate` update: the new version starts after the old one stops
  and applies the migrations at start.
- Size of the volumes: edit `storage` in `postgres.yaml` and `app.yaml`
  before the first installation.

## Backup

- Database: `kubectl -n {{id}} exec {{id}}-postgres-0 -- pg_dump -U postgres mosaikit > backup.sql`
  (or the backups of the managed PostgreSQL).
- Files: a copy of the volume `{{id}}-data` (snapshot of the StorageClass or
  `kubectl cp {{id}}/<pod>:/data ./data`).
- System › Backup and restore makes complete daily backups in `/data/backups` of the volume (the image
  has the PostgreSQL 17 client; for a newer server rebuild it with `--build-arg PG_CLIENT_MAJOR=<major>`).
  Keep `/data/secret.key` apart from the backups.

## Update

1. Push the new image to the registry and update `newTag` in `kustomization.yaml`.
2. `kubectl apply -k .`

## Uninstall

```sh
kubectl delete -k .                       # app, services, ingress
kubectl delete namespace {{id}}           # the volumes too (data!)
```
