# Evidence

How to collect, for a tender, an audit or a qualification request, the evidence that the
[compliance matrix](matrix.md) refers to. Most of it is produced by every pipeline; keep the
artefacts of the pipeline of the release tag.

## From the pipeline of a release

| Evidence | Job | Where |
|---|---|---|
| Unit and integration tests, per requirement (`@Tag("MK-…")`) | `backend`, `frontend` | job artefacts: JUnit reports (`**/target/surefire-reports`, `**/target/failsafe-reports`); the *Tests* tab of the pipeline |
| Test coverage of Java and TypeScript | `backend`, `frontend`, `sonarqube` | `src/server/target/jacoco-report/`, `coverage/lcov.info`; SonarQube Cloud, project `mosaikit_mosaikit` |
| Static analysis and quality gate | `sonarqube`, `sast` | SonarQube Cloud (A ratings, quality gate); Semgrep log of `sast` |
| Secret scanning of the whole history | `secrets` | log of `secrets`; accepted findings in `.gitleaksignore` with their reason |
| Software bill of materials | `sbom` | artefact `target/sbom.json` (CycloneDX) |
| Vulnerabilities of the components | `dependency-scan` | log of `dependency-scan` (Trivy on the sources and on the SBOM) |
| Portable distribution tested on its archive | `portable-test` | log and JUnit report of `PortableDistributionIT` |
| Release notes | `release-check`, `release` | `release-notes.md`, the GitHub release |

Download them from the pipeline page (*Download artifacts*) or with the API:
`GET /projects/:id/jobs/:job_id/artifacts`. Job artefacts expire after one week; the pipeline of a
tag should be kept (*Keep* on the job page) or its artefacts attached to the release.

## From the repository

| Evidence | Where |
|---|---|
| Requirements and their acceptance criteria | `docs/requirements/MK-*.md` |
| Traceability requirement → test | tests tagged with the requirement identifier: `grep -r '@Tag("MK-' --include=*.java`, `describe('MK-…` in TypeScript |
| Architecture decisions | `docs/adr/` |
| Licence and copyright of every file | `LICENSE`, `LICENSES/`, `REUSE.toml` (`reuse lint`) |
| Catalogue metadata | `publiccode.yml` |
| Vulnerability disclosure | `SECURITY.md` |
| Secure development process | [secure-development.md](secure-development.md) |
| Operating documentation | [docs/guide/](../guide/README.md) |

## Checklist for a tender

1. Take the matrix at the tag of the offered release, and the non-conformities still open with
   their plan: they are the honest answer to the requirements that are not met yet.
2. Attach, from the pipeline of that tag: SonarQube report, SBOM, Trivy report, test reports.
3. For accessibility, attach the evaluation report (see NC-08).
4. For a SaaS offer at QC2, the provider adds its ISO/IEC 27001, 27017 and 27018 certificates,
   the qualification of the infrastructure and its incident management procedure.
5. Check every quoted rule against the text in force (ACN regulation and its annex for the level,
   AgID guidelines).
