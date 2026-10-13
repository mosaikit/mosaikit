# 0036. Extensions, not plugins

- Status: accepted
- Date: 2026-10-12
- Deciders: Massimo Antonini

## Context and problem statement

Mosaikit is extended by packages of several kinds: apps, themes, languages, services, connectors,
packages that extend other packages. Until now they were called plugins: a technical word, which the
administrators of the public administrations who install them do not use, and which says nothing
about how they work. They add to the extension points of the kernel and of each other. Nothing has
been released yet, so a new name costs now less than it ever will.

## Decision

- **Extension** everywhere: in the code (`dev.mosaikit.kernel.api.extension`, `ExtensionRegistry`),
  the API (`/api/v1/extensions`, `/api/v1/ext/<api>/`, `/api/v1/extension-assets`), the settings
  (`mosaikit.extensions.*`), the installation (`extensions/`), the database (the schema of an
  extension is `ext_<name>`; migration V15 renames the objects of the kernel), the SDK
  (`@mosaikit/create-extension`, `io.github.mosaikit:mosaikit-extension-parent`) and the
  documentation. An extension declares and uses **extension points**.
- The kind stays in the manifest (`kind: [app]`, `[theme]`…), and the shell may name it: an app, a
  theme, a language.
- The extensions of the framework of the kernel are always called **Quarkus extensions**, in full:
  an extension of Mosaikit cannot bring one.
- Accepted ADRs and released notes keep the old word: they are history.

## Consequences

- Every name that carried "plugin" changes at once, before the first release; existing development
  databases are migrated, schemas `p_<name>` of extensions installed before are left behind.
- The repositories of extensions (`mosaikit/mosaikit-samples`, the reusable workflow of the
  organization) follow in the same change.
