# Security policy

## Supported versions

Mosaikit is in early development. Until 1.0, only the latest release receives security fixes.

## Reporting a vulnerability

Do not open a public issue. Send a private report to the maintainer at the address listed in
`publiccode.yml` (`maintenance.contacts`), or use the confidential issue option of the project
tracker. Include:

- affected version and component (kernel, shell, SDK, extension);
- description and impact;
- steps or a proof of concept to reproduce.

You will receive an acknowledgement within 5 working days. We coordinate disclosure with the
reporter and publish an advisory together with the fix.

## Supply chain

Releases ship with a CycloneDX SBOM and are signed. Dependencies are scanned in CI and
updated through Renovate.
