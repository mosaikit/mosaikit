# Non-conformities

The work list of the [compliance matrix](matrix.md): one entry per gap, with the measure it
blocks, how serious it is, what to do and who does it. Close an entry in the merge request that
fixes it (status *Closed*, with the commit), and update the row of the matrix.

**Severity.** *High*: blocks a tender or the QC2 qualification of a service. *Medium*: expected
by the guidelines, can be planned with a date. *Low*: improves the evidence.

**Owner.** *Software*: this repository. *Provider*: whoever runs the service. *Both*: the software
must provide a capability that the provider operates.

## Summary

| ID | Title | Severity | Owner | Status |
|---|---|---|---|---|
| NC-01 | `publiccode.yml` not validated in CI | Low | Software | Open |
| NC-02 | Repository not public, not in the Developers Italia catalogue | Medium | Software | Open |
| NC-03 | Reviews not enforced on merge requests | Medium | Software | Open |
| NC-04 | No threat model | High | Software | Open |
| NC-05 | No ASVS 5.0 L2 verification | High | Software | Open |
| NC-06 | No dynamic testing nor penetration test | High | Both | Open |
| NC-07 | Accessibility not evaluated nor checked in CI | High | Software | Open |
| NC-08 | No accessibility evaluation report | Medium | Software | Open |
| NC-09 | No Bootstrap Italia theme | Medium | Software | Open |
| NC-10 | No SPID and CIE sign-in | High | Software | Open |
| NC-11 | No ModI profiles nor PDND e-services | Medium | Software | Open |
| NC-12 | MFA not required nor available for local accounts | High | Software | Open |
| NC-13 | No lockout of local accounts | High | Software | Open |
| NC-14 | No password policy in the realms | Medium | Software | Open |
| NC-15 | One organization per account | Medium | Software | Closed (MK-017) |
| NC-16 | Audit log incomplete | High | Software | Partial (MK-015) |
| NC-17 | No log integrity, retention nor SIEM export | High | Both | Open |
| NC-18 | Database connection without TLS | Medium | Both | Open |
| NC-19 | No encryption at rest nor keys per organization | High | Both | Open |
| NC-20 | No backup and tested restore for server deployments | High | Both | Open |
| NC-21 | No export of the data of an organization | High | Software | Open |
| NC-22 | Container image and archives not signed | Medium | Software | Partial (ADR-0023) |
| NC-23 | No inventory of the personal data kept | Medium | Software | Open |
| NC-24 | No access, rectification and erasure of an account | High | Software | Open |
| NC-25 | No oversight of AI actions | Medium | Software | Closed (MK-015) |

## Details

### NC-01 `publiccode.yml` not validated in CI

- **Measure:** C-02. **Severity:** Low. **Owner:** Software.
- **Gap:** the file is written by hand and never checked; `releaseDate` and `softwareVersion` can
  drift from the release.
- **Action:** run `publiccode-parser` in the `verify` stage; let `distribution/release/prepare.sh`
  update version and date.

### NC-02 Repository not public, not in the Developers Italia catalogue

- **Measure:** C-03. **Severity:** Medium. **Owner:** Software.
- **Gap:** the GitLab project is private, so the software cannot be reused nor listed.
- **Action:** make the `mosaikit` group and project public after checking the history (Gitleaks
  runs on it), then register the repository on developers.italia.it.

### NC-03 Reviews not enforced on merge requests

- **Measure:** C-11. **Severity:** Medium. **Owner:** Software.
- **Gap:** `CODEOWNERS` names the maintainer, but approvals are not required and the default
  branch accepts direct pushes.
- **Action:** protect `main` (merge requests only, pipeline must succeed, code owner approval);
  with a second maintainer, require one approval that is not the author.

### NC-04 No threat model

- **Measure:** C-12. **Severity:** High. **Owner:** Software.
- **Gap:** the risks of the kernel, of the extension model (code of third parties in the kernel and
  in the browser) and of the identity flows are not analysed in writing.
- **Action:** `docs/compliance/threat-model.md` with STRIDE per component (kernel API, shell,
  extension frontends, extension backends, launcher, Keycloak, database), the trust boundaries and the
  mitigations, linked to requirements and tests. Review it at every new extension point.

### NC-05 No ASVS 5.0 L2 verification

- **Measure:** C-13. **Severity:** High. **Owner:** Software.
- **Gap:** the controls of ASVS level 2 are not mapped nor verified.
- **Action:** a checklist `docs/compliance/asvs.md` with one line per control: applies or not,
  where it is implemented, which test proves it. Fill the gaps as non-conformities.

### NC-06 No dynamic testing nor penetration test

- **Measure:** C-14. **Severity:** High. **Owner:** Both.
- **Gap:** no DAST in CI; no penetration test report.
- **Action:** OWASP ZAP baseline scan against the container of the pipeline (job in `security`);
  a penetration test by a third party before the first production release, repeated yearly and
  after major changes. The provider commissions it for the service.

### NC-07 Accessibility not evaluated nor checked in CI

- **Measure:** C-18, C-19. **Severity:** High. **Owner:** Software.
- **Gap:** the shell and the sample extensions were never evaluated against WCAG 2.1 AA / EN 301 549;
  no automated check.
- **Action:** axe-core checks of the shell pages in the frontend tests (Playwright) and in CI;
  manual evaluation with a screen reader and keyboard only; extension guidelines on accessible
  custom elements in `docs/development/extension-development.md`; alternative texts for maps and
  dashboards in the extensions that draw them.

### NC-08 No accessibility evaluation report

- **Measure:** C-20. **Severity:** Medium. **Owner:** Software.
- **Gap:** administrations must publish an accessibility statement (AgID form) and need the
  evaluation of the supplier to write it.
- **Action:** after NC-07, publish the report (model of the AgID guidelines) with each release.

### NC-09 No Bootstrap Italia theme

- **Measure:** C-21. **Severity:** Medium. **Owner:** Software.
- **Gap:** public instances should follow the Designers Italia models; the shell has its own
  tokens only.
- **Action:** a theme extension that maps the design tokens of the shell (`--mk-*`) to Bootstrap
  Italia, and the header and footer models of Designers Italia.

### NC-10 No SPID and CIE sign-in

- **Measure:** C-22. **Severity:** High. **Owner:** Software.
- **Gap:** citizens cannot sign in with SPID or CIE.
- **Action:** identity providers for SPID (OpenID Connect or SAML, with the AgID metadata) and CIE
  (OpenID Connect) in the realm of each organization, configured by the kernel like the realm
  itself (MK-018), and the SPID button in the sign-in page of the shell.

### NC-11 No ModI profiles nor PDND e-services

- **Measure:** C-24. **Severity:** Medium. **Owner:** Software.
- **Gap:** the APIs follow OpenAPI and RFC 9457 but not the security profiles of the
  interoperability guidelines, and cannot be published on the PDND.
- **Action:** ModI profiles (ID_AUTH_CHANNEL_02, INTEGRITY_REST_01) on the public APIs of the
  kernel and of extensions, through the API gateway of the kernel; a guide to publish them as
  e-services.

### NC-12 MFA not required nor available for local accounts

- **Measure:** C-25. **Severity:** High. **Owner:** Software.
- **Gap:** the realm template does not require a second factor; local accounts (the platform
  administrator, organizations without a realm) sign in with a password only.
- **Action:** OTP required action and conditional OTP flow in `realm-template.json`, with a
  setting per organization; TOTP for local accounts, required for `platform-admin`.

### NC-13 No lockout of local accounts

- **Measure:** C-26. **Severity:** High. **Owner:** Software.
- **Gap:** HTTP Basic sign-in of local accounts has no limit of failed attempts.
- **Action:** count failed attempts per account and per address, delay then lock temporarily,
  record the events in the audit log (NC-16).

### NC-14 No password policy in the realms

- **Measure:** C-27. **Severity:** Medium. **Owner:** Software.
- **Gap:** realms created by the kernel use the defaults of Keycloak.
- **Action:** `passwordPolicy` in `realm-template.json` (length 12, not the username, history,
  breached passwords check where available), aligned with the rule of local accounts.

### NC-15 One organization per account

- **Measure:** C-28. **Severity:** Medium. **Owner:** Software.
- **Gap:** a person who works for two organizations needs two accounts.
- **Action:** MK-017 (membership of several organizations, one organization per request).
- **Closed** by MK-017, [ADR-0016](../adr/0016-membership-of-several-organizations.md).

### NC-16 Audit log incomplete

- **Measure:** C-29. **Severity:** High. **Owner:** Software.
- **Done** with MK-015 ([ADR-0017](../adr/0017-ai-tools-drafts-and-audit.md)): the append-only
  `audit_event` table, the `AuditLog` service, the `mosaikit.audit` log category and the read API
  `GET /api/v1/audit-events`; actions of assistants, creation and identity settings of
  organizations and changes of members are recorded.
- **Gap:** sign-ins and failed attempts, changes of extensions and events of extensions are not recorded;
  events have no request identifier.
- **Action:** record authentication successes and failures (identity augmentor and failure
  handler), extension installation outcomes at start, an `AuditLog` API in the SDK for extensions, and a
  request identifier.

### NC-17 No log integrity, retention nor SIEM export

- **Measure:** C-30. **Severity:** High. **Owner:** Both.
- **Gap:** after NC-16, the records must be tamper-evident, kept for the required time and sent
  to the SIEM of the provider.
- **Action:** hash chain of the audit records, retention setting, export as syslog or
  OpenTelemetry logs; the provider operates the SIEM.

### NC-18 Database connection without TLS

- **Measure:** C-31. **Severity:** Medium. **Owner:** Both.
- **Gap:** the JDBC connection does not require TLS; the documentation does not say how to enable
  it.
- **Action:** document `sslmode=verify-full` in the JDBC URL and the certificate settings in the
  Helm chart; enable TLS between the containers of Docker Compose.

### NC-19 No encryption at rest nor keys per organization

- **Measure:** C-32. **Severity:** High. **Owner:** Both.
- **Gap:** data at rest rely on the storage of the infrastructure; there is no key per
  organization.
- **Action:** encrypted volumes and backups from the provider; a key service (OpenBao or the KMS
  of the infrastructure) with one key per organization for the fields and files that need it.

### NC-20 No backup and tested restore for server deployments

- **Measure:** C-34. **Severity:** High. **Owner:** Both.
- **Gap:** only the portable distribution has a proven backup (a copy of `data/`).
- **Action:** a documented backup of PostgreSQL (logical and point in time) and of the extensions
  directory; a scheduled restore test in staging with a report; RPO and RTO declared by the
  provider.

### NC-21 No export of the data of an organization

- **Measure:** C-35. **Severity:** High. **Owner:** Software.
- **Gap:** an administration cannot take its data to another provider.
- **Action:** an export of an organization (kernel data plus an `export()` contract that each
  extension implements) in an open format, and the matching import.

### NC-22 Container image and archives not signed

- **Measure:** C-38. **Severity:** Medium. **Owner:** Software.
- **Gap:** `SECURITY.md` says that releases are signed: the Git tags are, the container image and
  the portable archives only have SHA-256 files.
- **Action:** sign the image and the archives with cosign (keyless with the OIDC identity of the
  pipeline) and attach the SBOM as an attestation.
- **Done** in the pipeline ([ADR-0023](../adr/0023-documentation-and-release-documents.md)): the
  `sign` job signs the image and the `SHA256SUMS` of archives and documents. **Left:** verify it on
  the first release, and attach the SBOM as an attestation (`cosign attest`).

### NC-23 No inventory of the personal data kept

- **Measure:** C-43. **Severity:** Medium. **Owner:** Software.
- **Gap:** the controller cannot fill the records of processing without a list of the personal
  data that the kernel keeps, where and for how long.
- **Action:** `docs/compliance/personal-data.md` for the kernel (accounts: email, display name,
  password hash, roles, organization) and a section of the same kind in each extension; retention
  settings.

### NC-24 No access, rectification and erasure of an account

- **Measure:** C-44. **Severity:** High. **Owner:** Software.
- **Gap:** a person cannot see, correct or delete the data of their account, and an administrator
  cannot do it for them.
- **Action:** API and UI for the account (show, change display name and email, delete) and for the
  administrator, with the deletion propagated to extensions through an event.

### NC-25 No oversight of AI actions

- **Measure:** C-45. **Severity:** Medium. **Owner:** Software.
- **Gap:** the assistant and the MCP server are not implemented yet.
- **Action:** MK-015: typed actions with a risk level, drafts confirmed by the person for write
  and execute actions, audited.
- **Closed** by MK-015, [ADR-0017](../adr/0017-ai-tools-drafts-and-audit.md).
