# 0037. A registry of resources and one sharing model

- Status: proposed
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

## Consequences

- An extension that registers its resources gets sharing and the other features without code of its
  own, and enforces the answers of the kernel in its backend.
- Extensions that enforce access somewhere else (an external server, a gateway) translate the grants
  of the kernel into their own rules; the kernel stays the authority.
