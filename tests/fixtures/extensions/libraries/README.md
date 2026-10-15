# Libraries (sample Java extension)

Shows a Java extension that brings its own libraries (MK-131):

| Path | Content |
|---|---|
| `pom.xml` | Depends on Apache Commons Text, which the kernel does not provide, and on Jackson, which it does: `mvn package` copies Commons Text and its dependency Commons Lang into `lib/` and leaves Jackson out |
| `manifest.yaml` | The `libraries` block is written by the build, with the Maven coordinates and the SHA-256 digest of each JAR |
| `src/` | A REST resource under `/api/v1/ext/fixture-libraries` that calls both libraries |
