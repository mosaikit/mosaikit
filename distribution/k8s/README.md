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

## Behind an ingress

The ingress, or a load balancer, terminates TLS and talks to the kernel over HTTP. The chart has the
kernel take the scheme and the address of the client from `X-Forwarded-Proto` and `X-Forwarded-For`
(`proxy.forwardedHeaders`, on by default), so that the session cookie carries `Secure`. With the
default `ClusterIP` service only the cluster reaches the pod, and the headers are believed from any
address; name the proxies with `proxy.trustedProxies`, such as the pod network of the ingress
controller, so that other pods cannot set them either. With `service.type` `NodePort` or
`LoadBalancer` clients reach the kernel directly, and the chart refuses to render without
`proxy.trustedProxies`:

```bash
helm upgrade mosaikit ./mosaikit --reuse-values --set proxy.trustedProxies=10.244.0.0/16
```

`proxy.secureCookies=true` makes the cookies `Secure` whatever the ingress forwards, for an
installation reached only over HTTPS.

## Settings of the kernel and of extensions

The chart names the settings it needs. Every other setting of the kernel
([configuration](../../docs/guide/configuration.md)) goes in `kernel.extraSettings`, and the settings of
an extension under its identifier in `extensions.<id>.settings`, without changing the chart (MK-129).
Each becomes an environment variable of the kernel: the name of the setting in upper case, with every
character that is not a letter or a digit replaced by `_`. A value is written in clear only when it
is not secret; a password, a token or a key stays in a Kubernetes secret, named with
`valueFrom.secretKeyRef`. For example, an extension `org.example.reports` whose documentation names
the settings `example.reports.endpoint` and `example.reports.api-key`, in a values file:

```yaml
extensions:
  org.example.reports:
    settings:
      example.reports.endpoint: https://reports.example.org
      example.reports.api-key:
        valueFrom:
          secretKeyRef: { name: reports, key: api-key }
kernel:
  extraSettings:
    mosaikit.accounts.session-timeout: 4h
```

```bash
kubectl create secret generic reports --from-literal=api-key='<key>'
helm upgrade mosaikit ./mosaikit --reuse-values -f settings.yaml
```

A setting that is not a name of letters, digits, `.`, `_`, `-` and `"`, or a map without
`valueFrom.secretKeyRef` or `valueFrom.configMapKeyRef`, stops the rendering with a message.
`kernel.extraEnv` adds variables as in a container, and `kernel.extraEnvFrom` takes every key of a
Secret or a ConfigMap as a variable (`envFrom`), such as a Secret holding
`MOSAIKIT_SECRETS_MASTER_KEY`. A setting given both by the chart and here takes the value given here.
Prefer a values file to `--set`, where the dots of a name must be escaped
(`--set 'extensions.org\.example\.reports.settings.example\.reports\.endpoint=https://reports.example.org'`).

Every value is described in `mosaikit/values.yaml`.
