# 0017. Plugin actions as AI tools, confirmed drafts and an audit log

- Status: accepted
- Date: 2026-09-30
- Deciders: Massimo Antonini
- Extends [ADR-0004](0004-plugin-model-restart-and-packages.md) and
  [ADR-0016](0016-membership-of-several-organizations.md)

## Context and problem statement

Assistants and MCP clients should use the functions of the plugins (list the notes, close a road,
start an export) on behalf of a person. They must never get more rights than the person, never
act on another organization, and never change data without the person seeing and accepting the
change (MK-015). What they do must be traceable (C-29, C-45 of the compliance matrix).

## Decision

- **Declared actions.** A plugin with a backend lists `actions` in its manifest: a `name`, a
  `title`, a `description`, a `risk` (`read`, `write`, `execute`), an `input` JSON Schema and a
  `call` (`method`, `path` relative to its API, with `{argument}` placeholders). The SDK accepts
  only a subset of JSON Schema that it can check itself (`type`, `properties`, `required`,
  `additionalProperties`, `items`, `enum`, lengths and bounds); `read` actions must use `GET`.
- **Tools.** The kernel offers each action of an active plugin as the tool `<api>__<name>`,
  through `/api/v1/ai/tools` and through an MCP server at `/mcp` (Streamable HTTP, JSON
  responses, protocol 2025-06-18). No assistant runs inside the kernel: any client that speaks
  the API or MCP can use the tools.
- **Same rights as the person.** A tool runs as an HTTP call of the kernel to itself on the
  loopback interface, with the `Authorization` header of the person and the organization of the
  request. Authentication, the organization rules of MK-017, the plugin guard and the permission
  checks of the plugin apply as for the web UI. The kernel keeps no credentials.
- **Drafts.** A `read` tool runs at once. A `write` or `execute` tool becomes a draft
  (`ai_action_draft`), visible only to the same person in the same organization, that expires
  after 15 minutes. It runs only when that person confirms it (`POST
  /api/v1/ai/drafts/{id}/confirmation`), from the "Pending actions" of the shell or another client;
  a version column keeps two confirmations from both running it. MCP clients receive the draft,
  not a result.
- **Audit log.** An append-only table `audit_event` (who, organization, action, subject, outcome,
  details, when), written in its own transaction and to the `mosaikit.audit` log category. It
  records every proposal, run, confirmation and rejection of a tool, and the changes of
  organizations and memberships. Platform administrators read it at `/api/v1/audit-events`.

### Refined on 2026-10-13 (MK-059)

The audit log became tamper-evident and per organization: each entry carries its position and a
SHA-256 hash over its content and the previous entry's hash, in one chain per organization and one
for the platform; the request role may only insert and read it, under row-level security; an
organization administrator lists, filters and verifies the entries of their organization, and the
oldest entries are removed only past a retention never shorter than `mosaikit.audit.min-retention`.
The consequence below on tamper evidence no longer holds.

## Consequences

- Plugins get assistant support by declaring what they already expose; no code of theirs runs in
  a new way.
- A call through a tool costs one extra local HTTP hop; the kernel must reach its own HTTP port
  (`quarkus.http.host` and `quarkus.http.port`).
- Sign-ins, identity provider events and plugin events are not in the audit log yet, and the log
  is not tamper-evident nor exported (NC-16, NC-17 of the compliance documents).
- Drafts are kept after they are decided, as the evidence of what was confirmed; their clean-up
  comes with the retention rules of NC-17.

## Alternatives considered

- **Running tools inside the kernel through CDI.** Faster, but it would bypass the HTTP security
  of the plugin and need a second permission model.
- **Tokens for assistants.** Out of scope: the person authenticates the MCP client as for the API
  (password or access token of the realm); dedicated scoped tokens can come later.
- **Full JSON Schema.** Validators of the whole specification are large and allow references to
  remote documents; the subset covers typed arguments of REST calls.
