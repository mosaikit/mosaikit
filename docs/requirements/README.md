# Requirements

One YAML file per requirement, named after its id. The format is defined by
[`requirement.schema.json`](requirement.schema.json) and checked by the frontend test suite,
which also verifies traceability:

- every `MK-xxx` tag used in a test refers to an existing requirement;
- every requirement with status `done` is verified by at least one test.

| Field | Meaning |
|---|---|
| `id` | `MK-` followed by three digits, never reused |
| `title` | What the platform does, in one line |
| `area` | kernel, extensions, shell, sdk, security, distribution, marketplace, ai |
| `priority` | P1 (needed for the prototype), P2, P3 |
| `status` | planned, in-progress, done |
| `description` | Why it is needed and what it covers |
| `acceptance` | Verifiable criteria ("done when …") |
| `depends` | Other requirement ids |
