# Compliance matrix

Status as of version 0.1.0-SNAPSHOT. The status values are explained in the
[README](README.md#status-values); every row that is not *Compliant* has a
[non-conformity](non-conformities.md). Evidence paths are relative to the repository root.

## AgID: acquisition and reuse of software

Linee guida AgID su acquisizione e riuso di software per le pubbliche amministrazioni (CAD, art.
68 and 69).

| ID | Measure | Status | Evidence | NC |
|---|---|---|---|---|
| C-01 | Open licence approved by OSI | Compliant | `LICENSE` (MPL-2.0), [ADR-0002](../adr/0002-license-mpl-2.0.md), `REUSE.toml` | |
| C-02 | `publiccode.yml` with the metadata of the catalogue | Partial | `publiccode.yml` | NC-01 |
| C-03 | Public repository, listed in the Developers Italia catalogue | Non-compliant | | NC-02 |
| C-04 | Channel to report vulnerabilities | Compliant | `SECURITY.md` | |
| C-05 | Documentation for users, operators and developers | Compliant | [docs/](../README.md), checked at every push (`DocumentationTest`, `docs/test`) and published with each release in Word, PDF, Excel and PowerPoint ([ADR-0023](../adr/0023-documentation-and-release-documents.md)) | |

## AgID: secure development

Linee guida AgID per lo sviluppo del software sicuro, and OWASP ASVS 5.0 level 2 as reference.

| ID | Measure | Status | Evidence | NC |
|---|---|---|---|---|
| C-06 | Documented secure development life cycle | Compliant | [secure-development.md](secure-development.md), `CONTRIBUTING.md` | |
| C-07 | Static analysis in CI, blocking | Compliant | `.github/workflows/ci.yml` jobs `sast` (Semgrep) and `sonarqube` (quality gate) | |
| C-08 | Secret scanning of the whole history | Compliant | job `secrets` (Gitleaks), `.gitleaksignore` | |
| C-09 | Dependency scanning and SBOM | Compliant | jobs `sbom` (CycloneDX) and `dependency-scan` (Trivy) | |
| C-10 | Dependency updates with a delay against compromised releases | Compliant | `.github/renovate.json` (`minimumReleaseAge`) | |
| C-11 | Code review of every change | Partial | `.github/CODEOWNERS`, pull request template | NC-03 |
| C-12 | Threat model of kernel and plugin model | Non-compliant | | NC-04 |
| C-13 | Verification against ASVS 5.0 level 2 | Non-compliant | | NC-05 |
| C-14 | Dynamic testing and penetration test | Non-compliant | | NC-06 |
| C-15 | Secure HTTP headers (CSP, HSTS, nosniff, frame options, referrer) | Compliant | `src/server/src/main/resources/application.properties`, `SystemResourceTest` (MK-001) | |
| C-16 | Errors without internal details (RFC 9457) | Compliant | MK-010, `dev.mosaikit.kernel.core.error` | |
| C-17 | Passwords stored with a slow hash | Compliant | `PasswordHasher` (PBKDF2-HMAC-SHA256, 600 000 iterations), `PasswordHasherTest` | |

## AgID: accessibility and design

Legge 4/2004, Linee guida AgID sull'accessibilità degli strumenti informatici, EN 301 549
(WCAG 2.1 AA), European Accessibility Act (d.lgs. 82/2022).

| ID | Measure | Status | Evidence | NC |
|---|---|---|---|---|
| C-18 | User interface conforming to WCAG 2.1 AA (design on WCAG 2.2 AA) | Non-compliant | | NC-07 |
| C-19 | Automated accessibility checks in CI | Non-compliant | | NC-07 |
| C-20 | Evaluation report for the accessibility statement of the administration | Non-compliant | | NC-08 |
| C-21 | Designers Italia design system (Bootstrap Italia) for public instances | Non-compliant | | NC-09 |

## Digital identity and interoperability

| ID | Measure | Status | Evidence | NC |
|---|---|---|---|---|
| C-22 | Sign-in of citizens with SPID and CIE | Non-compliant | Keycloak federation per organization (MK-012, MK-018) is the base | NC-10 |
| C-23 | REST API described with OpenAPI 3 | Compliant | `/q/openapi` (MK-001), `SystemResourceTest` | |
| C-24 | ModI security profiles, publication as PDND e-service | Non-compliant | | NC-11 |

## ACN QC2: identity and access

| ID | Measure | Status | Evidence | NC |
|---|---|---|---|---|
| C-25 | Strong authentication (MFA) for administrators and users | Partial | Keycloak supports it; not required by the realm template, not available for local accounts | NC-12 |
| C-26 | Protection against password guessing | Partial | `bruteForceProtected` in `realm-template.json`; no lockout for local accounts | NC-13 |
| C-27 | Password policy | Partial | 12 to 128 characters for local accounts (`RegistrationRequest`); no policy in the realm template | NC-14 |
| C-28 | Least privilege and separation of organizations | Compliant | roles per organization, platform roles only with a password; one realm per organization; plugin APIs refused without an organization (MK-017, `MembershipTest`, `JavaPluginInstallationIT`); row-level security of plugin data (MK-019, [ADR-0018](../adr/0018-row-level-security.md), `RowSecurityTest`) | |

## ACN QC2: logging and audit

| ID | Measure | Status | Evidence | NC |
|---|---|---|---|---|
| C-29 | Audit log of security events and administrative actions | Partial | `audit_event` table, `AuditLog`, `GET /api/v1/audit-events`, [ADR-0017](../adr/0017-ai-tools-drafts-and-audit.md): actions of assistants, organizations and members | NC-16 |
| C-30 | Integrity, retention and export of logs to a SIEM | Non-compliant | | NC-17 |

## ACN QC2: cryptography

| ID | Measure | Status | Evidence | NC |
|---|---|---|---|---|
| C-31 | Encryption in transit | Partial | HSTS in production; TLS ends at the reverse proxy or ingress; the connection to PostgreSQL does not require TLS | NC-18 |
| C-32 | Encryption at rest and key management per organization | Non-compliant | | NC-19 |
| C-33 | Secrets outside the code and private on disk | Compliant | Kubernetes secrets and `.env` (Helm chart, Docker Compose); portable secrets generated at the first start with mode 0600 (`PortableDatabaseTest`) | |

## ACN QC2: continuity

| ID | Measure | Status | Evidence | NC |
|---|---|---|---|---|
| C-34 | Backup and restore, declared RPO and RTO, restore tested | Partial | portable: a copy of `data/` restores on another installation (`PortableDistributionIT`); nothing for server deployments | NC-20 |

## ACN QC2: portability and location of data

| ID | Measure | Status | Evidence | NC |
|---|---|---|---|---|
| C-35 | Export of the data of an organization, to leave the provider | Non-compliant | | NC-21 |
| C-36 | Data in the European Union | Provider | chosen with the infrastructure; the software has no external calls | |

## ACN QC2: supply chain

| ID | Measure | Status | Evidence | NC |
|---|---|---|---|---|
| C-37 | Plugins signed and verified before installation | Compliant | MK-013, [ADR-0014](../adr/0014-signed-plugin-packages.md), `SignedPackagesTest`, `PackageSignaturesTest` | |
| C-37a | Code of unverified publishers isolated from the shell and the credentials | Compliant | MK-014, [ADR-0015](../adr/0015-isolated-plugin-frontends.md), `shell-bridge.test.ts`, `frame.test.ts`, `FrontendPluginViewTest` | |
| C-38 | Signed release artefacts (container image, archives) with provenance | Partial | signed Git tags; `sign` job: cosign keyless signature of the image and of the `SHA256SUMS` of archives and documents ([ADR-0023](../adr/0023-documentation-and-release-documents.md)); not yet verified on a release, SBOM not attested | NC-22 |
| C-39 | Vulnerability management of the components | Compliant | jobs `dependency-scan` and `sbom`, Renovate, `SECURITY.md` | |

## ACN QC2: organisation of the provider

| ID | Measure | Status | Evidence | NC |
|---|---|---|---|---|
| C-40 | ISO/IEC 27001 with ISO/IEC 27017 and 27018 | Provider | | |
| C-41 | Incident management and notification to the CSIRT Italia | Provider | the software needs the audit log of C-29 to support it | |
| C-42 | Qualified infrastructure of the same level (QC2) | Provider | | |

## GDPR

Regolamento (UE) 2016/679 and d.lgs. 196/2003 as amended. The records of processing and the
DPIA are duties of the controller; the software must make them possible.

| ID | Measure | Status | Evidence | NC |
|---|---|---|---|---|
| C-43 | Data protection by design: inventory of the personal data kept | Non-compliant | | NC-23 |
| C-44 | Rights of the data subject: access, rectification, erasure of an account | Non-compliant | | NC-24 |

## Artificial intelligence

Regulation (EU) 2024/1689 (AI Act), for the assistant of MK-015.

| ID | Measure | Status | Evidence | NC |
|---|---|---|---|---|
| C-45 | Human oversight: actions of an assistant confirmed by a person and audited | Compliant | MK-015, MK-024, [ADR-0017](../adr/0017-ai-tools-drafts-and-audit.md), [ADR-0022](../adr/0022-assistant-on-plugin-tools.md), `AiToolsTest`, `AssistantTest`, `JavaPluginInstallationIT` | |
