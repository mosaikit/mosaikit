# Installation

Mosaikit comes in four forms, all built from the same kernel and accepting the same extension
packages. A build writes them to `target/dist` (see [building](../development/development.md));
a release publishes them on the GitHub release page.

| Distribution | For | Needs | Guide |
|---|---|---|---|
| Portable archive | One organization, a PC or a small server, trials | nothing: Java and PostgreSQL are inside | [portable](../../distribution/portable/README.md) |
| Installation | A server with its own Java and PostgreSQL | Java 25, PostgreSQL 18 | [install](../../distribution/install/README.md) |
| Docker Compose | A server or a workstation with Docker; includes Keycloak | Docker or Podman | [docker](../../distribution/docker/README.md) |
| Kubernetes | Production, several organizations | Kubernetes, Helm 4, PostgreSQL, Keycloak | [k8s](../../distribution/k8s/README.md) |

## Portable or installation?

The portable archive (`mosaikit-portable-<version>-<platform>.zip` or `.tar.gz`) is complete:
unpack it and run `mosaikit` (Linux, macOS) or `mosaikit.cmd` (Windows). At the first start it
creates its PostgreSQL database in `data/`, generates its passwords, and writes the password of
the administrator to `data/initial-admin-password.txt`. Copying `data/` is a full backup.

The installation (`target/dist/mosaikit`) is the same layout without Java and PostgreSQL: set the
database and the administrator password in `config/application.properties` first.

## Layout of an installation

```
mosaikit, mosaikit.cmd   start scripts
README.md
config/                  application.properties, trusted-keys/ (keys of trusted extension publishers)
extensions/                 extension packages (*.zip), copied as they are
data/                    portable only: database and generated secrets
bin/                     kernel (with UI and launcher), java/ and pgsql/ (portable only)
```

## First start

1. Start Mosaikit and open <http://localhost:8080>.
2. Sign in as `admin` with the administrator password: the one set in
   `config/application.properties` (`mosaikit.bootstrap.admin-password`), in `.env` for Docker
   Compose, or in `data/initial-admin-password.txt` for the portable archive.
3. Change that password, then remove it from the configuration (or delete the file): it is used
   only when the database is empty.
4. Create the organizations ([administration](administration.md)) and install the extensions
   ([extensions](extensions.md)).

## Behind a reverse proxy

Serve Mosaikit over HTTPS only: in production the kernel sends `Strict-Transport-Security`. When the
proxy terminates TLS, the kernel must take the scheme from its `X-Forwarded-Proto` header, or the
session cookie and the cookie of "remember me" lack `Secure`
([configuration](configuration.md#behind-a-reverse-proxy)). Each distribution:

| Distribution | Forwarded headers | What to set |
|---|---|---|
| Installation | off | `quarkus.http.proxy.proxy-address-forwarding=true`, `quarkus.http.proxy.allow-x-forwarded=true` and `quarkus.http.proxy.trusted-proxies=<address of the proxy>` in `config/application.properties` (commented there) |
| Portable | off | the same, with `trusted-proxies=127.0.0.1` for a proxy on the same computer (commented in `config/application.properties`) |
| Docker Compose | on, believed from the container itself only | `MOSAIKIT_TRUSTED_PROXIES` in `.env`: the address, range or service name of the proxy as the container sees it ([docker](../../distribution/docker/README.md#behind-a-reverse-proxy)) |
| Kubernetes | on, believed from any address that reaches the pod of a `ClusterIP` service | `proxy.trustedProxies`, such as the pod network of the ingress controller; required with `NodePort` or `LoadBalancer` ([k8s](../../distribution/k8s/README.md#behind-an-ingress)) |

In every distribution `mosaikit.accounts.secure-cookies=true` makes the cookies `Secure` whatever the
proxy forwards, for an installation reached only over HTTPS. To check the result, sign in through
the proxy and look at the `Set-Cookie` header of `POST /api/v1/accounts/session` in the developer
tools of the browser: it ends with `Secure`.
