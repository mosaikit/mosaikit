# Composing products and common extensions

A product built on Mosaikit is its branding (a [theme extension](frontend.md#theme-extensions)), a set of common
extensions and its own extensions; its distribution lists the extensions it installs
([ADR-0041](../../adr/0041-common-extensions-composed-by-products.md)). The common extensions, such as
a file catalog, dashboards and processes, are in
[mosaikit/mosaikit-ext](https://github.com/mosaikit/mosaikit-ext), under the MPL-2.0 licence like
Mosaikit, with requirements of their own (`EXT-nnn`, in its `docs/requirements`). The sample
extensions of this guide are in
[mosaikit/mosaikit-ext-samples](https://github.com/mosaikit/mosaikit-ext-samples).

- **Names.** The folder, the Maven artifact and the npm package of an extension are
  `ext-<extension>[-<sub-extension>]...`, such as `ext-catalog` and its connector
  `ext-catalog-connection-postgres`. The manifest id is the reverse-DNS name of the owner followed
  by the same segments: `io.github.mosaikit.ext.catalog.connection.postgres` in mosaikit-ext,
  `org.example.ext.permits` for an extension of a product whose domain is `example.org`.
- **Independence.** An extension works without the others it can use: it hides or explains what
  needs a missing extension, and takes it up again when that extension comes back. Declare a
  required dependency in `requires` only when the extension cannot work at all without the other.

## Required and optional dependencies

The manifest names the other extensions an extension depends on, each with its id and a range of
versions (the same syntax as `platform`), in one of two lists (MK-132):

- **`requires`**: the extension cannot work without them. It is not installed while one of them is
  missing or in a version outside its range: the marketplace refuses it, naming each such
  dependency and its range, and an extension copied into `extensions/` in that state is
  `INCOMPATIBLE` with the same explanation (`Requires extension dev.example.base ^2, found 1.4.0`).
  The kernel migrates it after them, so its migrations may use their views.
- **`optional`**: the extension uses them when they are installed in an accepted version, and works
  without them otherwise. A missing optional dependency, or one in another version, never prevents
  installation or start; the extension sees it as absent.

An id is in one list or the other, not both. The dependencies protect the extensions that declare
them: an update that takes an extension out of the range that an installed extension requires is
refused, naming that extension, unless both are updated in the same operation
(`POST /api/v1/marketplace/operations`); removing an extension, or turning it off in an
organization, is refused while an active extension requires it. Extensions that use it optionally
stay active.
