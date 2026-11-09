# Pilots with outside people (phases 8 and 14)

Two pilots decide whether the kit is declared ready (v1.0). A person outside the project follows only the written
documents. The maintainers watch, log every stumble and fix the documents and the tools afterwards.

| Pilot | Who | Brief | Exit criteria |
|---|---|---|---|
| Phase 8 | one developer, clean machine | [developer-brief.md](developer-brief.md) | first plugin running in the development server in under 30 minutes; `validate --strict` passes; the `.mskp` installs on the Docker kit with a trusted key |
| Phase 14 | one development team, clean machine with Docker | [product-brief.md](product-brief.md) | first product running in under one working day; `mosaikit-product test` passes; the Docker release installs on a clean machine and survives an upgrade of the base |

## Rules for the maintainers

1. Give the participants the kit release (`kit-v1.0.0-rc3` or later), the public key (it is in the kit as
   `trusted_key.txt`) and their brief. Nothing else.
2. Questions go to GitHub Issues of `mosaikit/mosaikit` with the label `pilot`. The only help is an answer in the issue.
   Do not share a screen and do not type for them.
3. Every stumble is a row in [question-log.md](question-log.md): time, step, what the person tried, what we answered, the
   fix (document or tool). A question we answer from memory and not from a document is a documentation bug.
4. After each session: fix the documents and the tools, add the troubleshooting entries, rerun the checks, update the status
   of the phase in `docs/plugin-devkit-plan.md`.
5. The kit is declared ready only when the exit criteria are met by the outside person, not by a maintainer.

## What to ask at the end

- How long did each step take (clock times, not guesses)?
- Where did you stop and read something twice?
- What did you expect to find and did not?
- What would you remove?
