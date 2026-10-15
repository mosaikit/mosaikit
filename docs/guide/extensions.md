# Extensions

Every feature of Mosaikit beyond organizations and accounts comes from an extension. An extension is one
zip file (`<name>-<version>.zip`) that can hold a web frontend, Java code, database migrations and
translations.

## Installing, updating and removing

| To | Do |
|---|---|
| install | copy the zip into `extensions/` as it is, and restart Mosaikit |
| update | replace the zip with the new version, and restart |
| remove | delete the zip, and restart; its database schema is kept (or ask the kernel, see [Dependencies](#dependencies-between-extensions)) |

Extensions with Java code are built into the kernel by the launcher at the next start, which takes a
few seconds. If the kernel cannot be rebuilt or does not start with a new extension, the launcher
restores the previous build, starts again, and the extension stays disabled ("Rolled back") until a
different version is installed.

In Docker Compose, copy the zip into `mosaikit-docker/extensions/` and run
`docker compose restart mosaikit`. In Kubernetes, build a derived image with the extensions (see the
[Kubernetes guide](../../distribution/k8s/README.md)); frontend-only extensions can also be put on
the extensions volume.

## Marketplace

Platform administrators find **Extensions** in the menu (MK-022,
[ADR-0021](../adr/0021-minimal-marketplace.md)). The page lists the catalogs of the installation
and what they offer next to what is installed, with **Install** and **Update** buttons, and accepts
a package file for installations without network. Every package must be signed by a trusted
publisher and, from a catalog, match its signed index. The package goes into `extensions/` (the one it
replaces into `extensions/.previous/`) and takes effect at the next restart.

### Dependencies between extensions

An extension may require other extensions in a range of versions, or use them optionally (MK-132):

- **Installing** an extension whose required extension is missing, or installed in a version
  outside the range it accepts, is refused, naming each of them and the range. Install them
  together: `POST /api/v1/marketplace/operations` with
  `{"installations": [{"source": ..., "id": ..., "version": ...}, ...]}` places every package or
  none. An extension copied into `extensions/` in that state shows as `INCOMPATIBLE` with the same
  explanation. Optional dependencies never prevent an installation.
- **Updating** an extension to a version that an installed extension does not accept is refused,
  naming that extension; update both in the same operation.
- **Removing** an extension, `DELETE /api/v1/extensions/<id>`, moves its package to
  `extensions/.previous/` and keeps its schema and data; it stops at once when it has no Java code
  nor schema, otherwise at the next restart. It is refused while an active extension requires it,
  naming those extensions: remove them first, or together by hand. Extensions that use it
  optionally stay active. An extension installed as a directory is removed by hand.
- **Turning off** an extension in an organization (all its apps off, see
  [Administration](administration.md)) is refused while an extension that stays on there requires
  it; turn both off in the same change.

Catalogs are directories with a signed `index.json`, listed in `mosaikit.marketplace.sources`. A
path without scheme is a directory of the installation:

```properties
# the catalog of the installation, the one of the project, and a USB stick for an offline transfer
mosaikit.marketplace.sources=catalog/,https://mosaikit.github.io/catalog/,file:/media/usb/mosaikit-extensions/
```

Each installation brings the sample extensions as a catalog in `catalog/`, its default source, signed
with a key it already trusts; the build also leaves the packages in `target/dist/extensions`. Remove
`catalog/` from the sources, or the directory, to offer none of them.

To publish your own catalog, sign its index with your key:

```bash
java -cp bin/kernel/lib/main/io.github.mosaikit.mosaikit-kernel-api-*.jar \
  dev.mosaikit.kernel.api.signature.PackageSigningTool index ~/keys/acme /srv/extensions/stable
```

## Status

`GET /api/v1/extensions` (platform administrators) lists every extension found:

| Status | Meaning | What to do |
|---|---|---|
| `ACTIVE` | in use | |
| `INCOMPATIBLE` | needs another kernel version, or an extension that is missing or disabled | install the right versions |
| `RESTART_REQUIRED` | its Java code is not in the running kernel | start Mosaikit with its launcher (`mosaikit`, `mosaikit.cmd`) |
| `INVALID` | unreadable, broken manifest, refused signature, or rolled back | read `problems`, fix or replace the package |

## Signed packages and trusted publishers

A package can be signed by its publisher (see
[ADR-0014](../adr/0014-signed-plugin-packages.md)). The installation trusts the public keys in
`config/trusted-keys/` (`<name>.pub.pem`); the packages shipped with a distribution are signed with
a key that is already there.

- A signed package whose content was changed is **always refused**.
- A package signed with a trusted key shows its publisher key (`publisherKey`).
- Unsigned packages and packages of unknown publishers are accepted, as long as
  `mosaikit.extensions.signatures` is `optional` (the default).
- With `mosaikit.extensions.signatures=required` only packages signed with a trusted key are
  accepted; extension directories and unsigned packages are refused. Use it in production.

The frontends of extensions whose publisher is not verified run isolated in a sandboxed iframe
(`mosaikit.extensions.unverified-frontends=iframe`, the default): they cannot reach the rest of the
page nor the credentials of the person, and exchange with the shell only the events and calls
declared in their manifest. If such an app misses events or cannot load its data, its manifest
does not declare them; trust its publisher, or ask for a manifest with a complete `bridge`.

To trust a publisher, copy its `.pub.pem` file into `config/trusted-keys/` and restart. To check
a package before installing it:

```bash
java -cp bin/kernel/lib/main/io.github.mosaikit.mosaikit-kernel-api-*.jar \
  dev.mosaikit.kernel.api.signature.PackageSigningTool verify config/trusted-keys my-extension-1.0.0.zip
```

To stop trusting a publisher (for example after a leaked key), delete its file and restart:
its packages are refused at once when signatures are required.
