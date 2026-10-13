# Release process

Mosaikit follows [Semantic Versioning](https://semver.org/). Every artifact of the repository
(Maven modules, npm workspaces, Helm chart) carries the same version. Between releases the
version ends with `-SNAPSHOT`.

## What a release publishes

A signed tag `vX.Y.Z` (or `vX.Y.Z-rc.N` for a pre-release) starts the release pipeline:

| Job | Publishes to | What |
|---|---|---|
| `release-check` | — | Fails unless every artifact is at `X.Y.Z` and `CHANGELOG.md` has a `## [X.Y.Z]` section |
| `container-image` | GitHub Container Registry | `ghcr.io/mosaikit/mosaikit:vX.Y.Z` built from `distribution/docker/Containerfile` |
| `portable` | GitHub release | `mosaikit-portable-vX.Y.Z-<platform>.zip` / `.tar.gz` for Windows, Linux and macOS, tested on Linux by `portable-test` |
| `publish-maven` | Maven Central | `mosaikit-parent` and `mosaikit-kernel-api`, the API that Java extensions compile against |
| `publish-npm` | npmjs.org | `@mosaikit/sdk` (dist-tag `latest`, or `next` for pre-releases), with provenance |
| `publish-helm` | GitHub Container Registry (OCI) | Chart `oci://ghcr.io/mosaikit/charts/mosaikit`, version `X.Y.Z` |
| `docs` | GitHub release | `mosaikit-docs-X.Y.Z.zip`: guides in Word and PDF, compliance workbook (Excel), release overview (PowerPoint), extended release notes, `SHA256SUMS` |
| `sign` | GitHub release | cosign signature of the container image; `SHA256SUMS` of the portable archives and documents with its Sigstore bundle |
| `release` | Releases page | GitHub release with the `CHANGELOG.md` section, the portable archives, the documents, the SBOM and the signed checksums |

The jobs are in `.github/workflows/ci.yml`. `publish-maven` and `publish-npm` run in the GitHub
environment `release`, which holds the Maven Central token and the GPG key that signs the Maven
artifacts; npm uses trusted publishing (OIDC) and needs no token.

All the verification, quality and security jobs of a normal pipeline run first: a release is
never published from a commit that does not pass them.

## Steps

The scripts run in Bash (Git Bash on Windows).

1. Make sure `main` is green, and that `CHANGELOG.md` and the fragments of `changelog.d/` describe
   the changes.
2. Set the release version: `prepare.sh` moves the fragments of `changelog.d/` into
   `## [Unreleased]` (`node build/changelog.ts assemble`, which deletes them) and dates that
   section:

   ```bash
   distribution/release/prepare.sh 0.2.0
   git diff                                # review
   git commit -s -am "chore(release): 0.2.0"
   ```

3. Tag and push. Tags are signed, so that the release is traceable to its author:

   ```bash
   git tag -s v0.2.0 -m "Mosaikit 0.2.0"
   git push origin main v0.2.0
   ```

4. Move back to a development version:

   ```bash
   distribution/release/prepare.sh 0.3.0-SNAPSHOT
   git commit -s -am "chore: start 0.3.0 development"
   git push origin main
   ```

`distribution/release/check-version.sh <version>` runs the same check as the pipeline, for
example before tagging; it also fails when `changelog.d/` still holds fragments.

### Changelog fragments

Pull requests do not edit `CHANGELOG.md`: each adds a fragment, `changelog.d/<id>.md`, named after
its requirement (`MK-093.md`) or a short slug, that starts with a heading of Keep a Changelog
(`### Added`, `### Changed`, `### Deprecated`, `### Removed`, `### Fixed`, `### Security`) followed
by its entries as list items ([changelog.d/README.md](../../changelog.d/README.md)). Two pull
requests never touch the same lines, so they merge in any order. At release time
`node build/changelog.ts assemble` puts each entry at the top of its subsection of
`## [Unreleased]`, in the order of the file names, and deletes the fragments;
`node build/changelog.ts assemble --dry-run` shows the result without writing it.

## Documentation at every push

The documentation is part of the change ([ADR-0023](../adr/0023-documentation-and-release-documents.md)).
The pipeline fails when it no longer matches the code:

| Check | Job | Fails when |
|---|---|---|
| `DocumentationTest` | `backend` | an endpoint is missing from `api.md`, or documented but gone; a setting is missing from `configuration.md` |
| `docs/test` | `frontend` | a relative link is broken; an ADR is not in the index; the compliance documents name a test, requirement or non-conformity that does not exist |
| `docs/requirements/test` | `frontend` | a requirement breaks the schema, or is done without a test |
| `changelog` | merge requests | the product changes without a fragment in `changelog.d/` or an edit of `CHANGELOG.md` (label `no-changelog` to skip) |
| `build/test/changelog.test.ts` | `frontend` | a fragment of `changelog.d/` does not start with a heading such as `### Added`, or its entries are not list items |
| `docs` | every pipeline | a document cannot be generated |

To build the documents on a workstation (pandoc, xelatex, `pip install openpyxl pyyaml`):

```bash
python3 docs/build/build.py --version 0.2.0-SNAPSHOT --output target/docs   # --no-pdf without LaTeX
```

## Verifying a release

```bash
# The container image, signed by the release workflow of the project
cosign verify ghcr.io/mosaikit/mosaikit:v0.2.0 \
  --certificate-identity-regexp 'https://github.com/mosaikit/mosaikit/.github/workflows/ci.yml@refs/tags/v.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
# The checksums of the archives and documents, then the files themselves
cosign verify-blob SHA256SUMS --bundle SHA256SUMS.sigstore.json \
  --certificate-identity-regexp 'https://github.com/mosaikit/mosaikit/.github/workflows/ci.yml@refs/tags/v.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
sha256sum --check --ignore-missing SHA256SUMS
```

## Consuming the published artifacts

Maven: `io.github.mosaikit:mosaikit-kernel-api` is on Maven Central, so an extension needs no repository
configuration:

```xml
<dependency>
    <groupId>io.github.mosaikit</groupId>
    <artifactId>mosaikit-kernel-api</artifactId>
    <version>0.2.0</version>
    <scope>provided</scope>
</dependency>
```

npm: `@mosaikit/sdk` is on npmjs.org:

```bash
npm install @mosaikit/sdk
```

Helm:

```bash
helm install mosaikit oci://ghcr.io/mosaikit/charts/mosaikit --version 0.2.0
```

No token is needed: the project and its packages are public.
