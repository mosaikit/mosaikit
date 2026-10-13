# Mosaikit on Kubernetes

The Helm chart `mosaikit/` runs the kernel image on a cluster, with a read-only root filesystem.
PostgreSQL 18 (and Keycloak, for federated sign-in) are expected to run separately, for example
with their own operators or managed services.

```bash
kubectl create secret generic mosaikit-database \
  --from-literal=username=mosaikit --from-literal=password='<password>'
kubectl create secret generic mosaikit-bootstrap --from-literal=password='<admin password>'
helm install mosaikit ./mosaikit \
  --set database.url=jdbc:postgresql://<host>:5432/mosaikit \
  --set bootstrap.existingSecret=mosaikit-bootstrap \
  --set identity.keycloakUrl=https://auth.example.org
```

The released chart is also in the Helm registry of the project (`docs/development/release.md` in the
repository). Extensions with Java code are added by building a derived image:

```dockerfile
FROM ghcr.io/mosaikit/mosaikit:<version>
COPY --chown=185 my-extension-1.0.0.zip /opt/mosaikit/extensions/
RUN /opt/mosaikit/mosaikit build
```

The files of extensions (MK-041) go to a volume claimed by the chart (`files.persistence`), or with
`files.store=s3` to a bucket of an S3-compatible store (`files.s3.*`, with the access key in the
secret `files.s3.existingSecret`, keys `access-key-id` and `secret-access-key`):

```bash
kubectl create secret generic mosaikit-files \
  --from-literal=access-key-id=mosaikit --from-literal=secret-access-key='<secret>'
helm upgrade mosaikit ./mosaikit --reuse-values \
  --set files.store=s3 --set files.s3.endpoint=https://s3.example.org \
  --set files.s3.bucket=mosaikit-files --set files.s3.pathStyle=true \
  --set files.s3.existingSecret=mosaikit-files
```

Every value is described in `mosaikit/values.yaml`.
