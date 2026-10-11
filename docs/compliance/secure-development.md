# Secure development life cycle

How security is built into the development of Mosaikit, following the Linee guida AgID per lo
sviluppo del software sicuro. Gaps are listed in [non-conformities](non-conformities.md).

## Requirements

- Every feature starts as a requirement (`docs/requirements/MK-*.yaml`) with acceptance
  criteria; security requirements are requirements like the others (MK-001 headers, MK-007 plugin
  assets, MK-010 errors, MK-012 federated identity, MK-013 signed packages, MK-014 isolation of
  untrusted frontends).
- Decisions with security consequences are recorded as ADRs, with their consequences.
- The threat model of each component is to be written (NC-04).

## Design rules

- The kernel carries every measure that must hold for all plugins (authentication, authorization
  of plugin APIs, headers, errors, signatures), so that a plugin cannot lower the level.
- Plugins talk through the event bus and declared services, each with its own database schema.
- Nothing is trusted from a plugin package without its signature being checked (ADR-0014).
- Personal data are the minimum needed; secrets are never stored in the code nor in the images.

## Implementation

- Coding conventions and the quality gate are in `CONTRIBUTING.md`; formatting (Spotless,
  Prettier), all compiler warnings enabled (`-Xlint:all`), ESLint strict type-checked rules, ArchUnit rules on the
  dependencies of the kernel and of the SDK.
- Input is validated at the boundary (Bean Validation on requests, JSON Schema on manifests);
  paths from packages and URLs are normalised and confined (`StaticFiles`, `PluginPackages`).
- Passwords: PBKDF2-HMAC-SHA256 with 600 000 iterations; tokens: OpenID Connect with PKCE, issuer
  and audience checked per organization.

## Verification

Every merge request and every push to `main` runs:

| Check | Tool | Blocking |
|---|---|---|
| Tests, with coverage thresholds for TypeScript (Vitest) and for new code (SonarQube) | JUnit, Vitest, JaCoCo, V8 | yes |
| Static analysis | SonarQube Cloud quality gate, Semgrep (`p/java`, `p/typescript`, `p/owasp-top-ten`) | yes |
| Secrets in the whole history | Gitleaks | yes |
| Vulnerable dependencies | Trivy on the sources and on the SBOM | yes |
| Software bill of materials | CycloneDX | produced |

Accepted findings are recorded with their reason next to the code (`nosemgrep`, `@SuppressWarnings`,
`.gitleaksignore`, `sonar.issue.ignore` in the root `pom.xml`), so that a reviewer can check them.
Dynamic testing and penetration tests are to be added (NC-06).

## Release and maintenance

- Releases come from signed tags (`docs/development/release.md`); the pipeline of the tag builds,
  tests and publishes everything; the SBOM goes with the release.
- Dependencies are updated by Renovate, which waits seven days after a release before proposing
  it, to avoid compromised versions.
- Vulnerabilities are reported privately (`SECURITY.md`) and fixed in the latest release.
