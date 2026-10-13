# Requirements

One Markdown file per requirement, named after its id (`MK-012.md`): a YAML front matter with the
fields that tools read, and the description in the body. The same format serves Mosaikit and the
products built on it, so that one plan can phase the requirements of all of them.

```markdown
---
id: MK-012
title: Federated identity with one Keycloak realm per organization
area: security
priority: P1
status: done
depends: [MK-002, MK-003]
acceptance:
  - Each organization maps to a realm; the realm is chosen from the sub-domain or the email domain.
  - Local sign-in keeps working when Keycloak is unreachable.
---

Organizations sign in with their own identity providers through Keycloak, while local accounts
remain available.
```

The front matter follows [`requirement.schema.json`](requirement.schema.json);
[`requirements.json`](requirements.json) gives the prefix of the ids of this repository, its areas
and the products whose requirements it may depend on. The documentation test suite checks every
file, and the traceability:

- every `MK-xxx` tag used in a test refers to an existing requirement;
- every requirement with status `done` is verified by at least one test (tagged with its id:
  `@Tag("MK-012")` in Java, `MK-012` in the title of an end-to-end `describe`), here or in the
  repository named by `verified-in`.

| Field | Meaning |
|---|---|
| `id` | the prefix and three or more digits, never reused |
| `title` | what the product does, in one line |
| `area` | one of the areas of `requirements.json` |
| `priority` | P1, P2, P3 |
| `status` | `proposed` (written, not planned), `planned` (in a milestone), `in-progress`, `done` (acceptance verified by tests), `dropped`, `moved` (carried on by `moved-to`) |
| `moved-to` | the requirement that carries this one on, also of another product |
| `depends` | requirements that must be done first |
| `ui` | screens of the mockup it realizes, as `<mockup>:<screen>` |
| `decisions` | ADRs that shape it |
| `estimate` | days of work, `[least, most]` |
| `legacy` | its identifier in a tracker it comes from |
| `verified-in` | the repository whose tests verify it, when not this one |
| `acceptance` | verifiable criteria: done when tests show each of them; not needed when dropped or moved |

The body says why the requirement exists and what it covers; longer analysis, open questions and a
dated history go under their own headings (`## Analysis`, `## History`).
