# 0037. A registry of resources and one sharing model

- Status: accepted
- Date: 2026-10-13
- Deciders: Massimo Antonini

## Context and problem statement

Extensions keep resources (documents, records, files, connections) that people want to share, mark as
favorites, restore from the trash, version, tag and find. Each extension doing it alone would give as
many models, dialogs and permission checks as there are extensions, and none of these features could
work across them.

## Decision

- Extensions **register their resources** with the kernel (type, id, title, owner, organization, link)
  and keep them up to date (MK-054). The data stay in the extension.
- **One sharing model** (MK-055): a resource is shared with a subject (a person, a group, the whole
  organization, a link with a role and an expiry, the public) at a level the extension declares for
  the type (for example view, use, edit, manage). The kernel offers the dialog and answers "may this
  person do this on this resource", and every grant is audited (MK-059).
- Favorites, trash, versions, tags, presence, search of resources and transfer of resources build on
  the registry.

### Refined on 2026-10-13

Answers of the maintainer to the review of the extension API (pull request #42), before acceptance:

- The calling extension passes its identifier in every call, as `Notifications.send` does; the
  kernel checks it against an installed extension and its manifest.
- A resource registered without a person (a job, an import, a migration) is owned by the
  organization, and the administrators of the organization manage it.
- Grants do not pass from a parent resource to its children, for now; to revisit when folders exist.
- The owner, the people with the highest level and the administrators of the organization share.
  The administrators of the organization hold every level on every resource of their organization;
  platform administrators hold none.
- Links and the public get at most the lowest ("view") level by default; a resource type may raise
  links, not the public, to its "use" level, never to a level that edits. A link always expires,
  within a longest validity set by the installation.
- The Java API answers with sets for list pages; the implementation adds a SQL function, such as
  `mk_kernel.allows(...)`, that extensions use in their own queries to filter large lists in the
  database.
- Granting again to the same subject replaces its level, also lowering it, and is audited.
- An extension update that removes a resource type or a level on which grants exist is refused,
  with the list of those grants; a declared migration may come later.
- The frontend counterpart in `@mosaikit/sdk` and the REST API come with the implementation.
- The team sharing of data collections (MK-032) moves onto this model in the implementation.
- 2026-10-13, review of the implementation (pull request #76): resource types of the kernel may
  exclude the implicit level of the administrators of the organization, being private to their
  subjects; the documents of a team (`data-document`) do, so that they stay readable only by the
  members of the team, as MK-032 decided. The owner and explicit grants still apply. Types of
  extensions cannot opt out for now; a later change of `kernel-api` may let them.
- 2026-10-15, with folders in extensions (MK-136): grants pass from a parent to its children for the
  resource types that declare `inherits: parent` in the manifest; the level on a resource is the
  highest of its own and of those on the resources above it, and every answer of the kernel uses it.
  Types that do not declare it keep no inheritance.

## Consequences

- An extension that registers its resources gets sharing and the other features without code of its
  own, and enforces the answers of the kernel in its backend.
- Extensions that enforce access somewhere else (an external server, a gateway) translate the grants
  of the kernel into their own rules; the kernel stays the authority.
