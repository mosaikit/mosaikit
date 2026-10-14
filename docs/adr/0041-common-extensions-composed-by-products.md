# 0041. Common extensions in mosaikit-ext, composed by products

- Status: accepted
- Date: 2026-10-14
- Deciders: Massimo Antonini
- Refines [ADR-0025](0025-github-pages-and-maven-namespace.md) (names of extension repositories)
  and [ADR-0035](0035-plugins-outside-the-kernel-repository.md) (the repository of the samples)

## Context and problem statement

Products built on Mosaikit need the same capabilities again and again: a catalog of files and
data sources, dashboards, processes. Written inside each product, they are written several times,
diverge, and tie each product to its own copy. The kernel must stay agnostic of these domains
(ADR-0025), so they cannot move into it either. The products need a shared place for these
extensions, a way to name them so that a product's own extensions and the common ones never
collide, and rules that let a product take some of them and leave out others.

## Decision

- **A public repository `mosaikit/mosaikit-ext`** holds the common extensions that products
  compose. The first ones are a file catalog, dashboards and processes. Each extension is a
  directory that builds and tests alone on the parent POM of extensions and the test bench of
  `@mosaikit/testing`, like the samples (ADR-0035).
- **Licence MPL-2.0**, as Mosaikit (ADR-0002).
- **Requirements of its own**, with the prefix `EXT-nnn`, kept in that repository under
  `docs/requirements/` in the same format and with the same schema as Mosaikit's. An `EXT`
  requirement may depend on `MK` requirements; the platform capabilities it needs are written here
  as `MK` requirements.
- **The samples are renamed** `mosaikit/mosaikit-ext-samples`: the sample extensions for extension
  developers, distinct from the common extensions that products install.
- **Naming.** The folder, the Maven artifact and the npm package of an extension are named
  `ext-<extension>[-<sub-extension>]...`: `ext-catalog`, and a connector of the catalog
  `ext-catalog-connection-postgres`. The manifest id is the reverse-DNS name of the owner followed
  by the same segments: `io.github.mosaikit.ext.catalog.connection.postgres` for mosaikit-ext,
  `<product reverse-DNS>.ext.<extension>...` for the extensions of a product
  (`org.example.ext.permits`). The kind of the extension (app, theme, ...) is in the manifest, not
  in the name; the per-kind repository names of ADR-0025 remain for the repositories that already
  have them.
- **A product is** its branding (a theme extension), a set of extensions from mosaikit-ext and its
  own extensions. There is no product descriptor for now: the distribution of a product lists the
  extensions it installs.
- **Extensions are independent of each other.** An extension that can use another one works
  without it, and handles its absence: it hides or explains what needs the other extension, and
  takes it up again when the other comes back. A hard dependency is the exception, declared in the
  manifest.

## Consequences

- The platform needs what composition relies on, written as requirements of the phase
  "Composition": libraries brought by extensions (MK-131), required and optional dependencies
  between extensions (MK-132), knowing whether another extension is present (MK-133), contracts
  between extensions on the server and in the frontend (MK-134), and references between resources
  of different extensions that survive the absence of one of them (MK-135).
- Common extensions are versioned and released on their own; a product pins the versions it
  installs, and a breaking change of a contract publishes a new version next to the old one
  (ADR-0019).
- The samples keep their identifiers (`dev.mosaikit.sample.*`): they are examples, not extensions
  that products install.
- A product descriptor (a manifest that lists the extensions of a product, its theme and its
  settings) may come later, when distributions of several products need to share it.

## Alternatives considered

- **Common capabilities in the kernel.** Fewer packages to install, but the kernel would carry the
  domain of some products and grow with each of them.
- **One repository per common extension.** As ADR-0025 names them; with several extensions that
  move together and share fixtures, one repository keeps their changes in one pull request.
- **Common extensions in each product.** No coordination, but the same code written and fixed
  several times.
