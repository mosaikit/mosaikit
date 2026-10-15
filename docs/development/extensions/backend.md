# Java code

[`samples/notes`](https://github.com/mosaikit/mosaikit-ext-samples/tree/main/notes) is a complete example: an entity, a Jakarta
Data repository and a REST resource, with the migration of its schema.

- Build the extension as a Maven module on the parent of extensions. `mosaikit-kernel-api` (sdk/java),
  the Jakarta APIs and the Quarkus extensions the kernel already contains (REST, Hibernate ORM,
  Hibernate Validator, security) have scope `provided`. The JAR contains only the extension's
  classes; other libraries go next to it (see [Libraries of an extension](libraries.md#libraries-of-an-extension)).
  An extension cannot bring new Quarkus extensions.
- Generate the Jakarta Data repositories with the `quarkus-data-processor` annotation processor
  and index the JAR with the Jandex extension, as the sample does.
- Put REST resources under `/api/v1/ext/<api>/`, with the API name declared in `backend.api`. The
  kernel requires authentication for every path there, whatever the resource declares, and
  serves it only while the extension is active.
- Map entities to the extension schema: `@Table(name = "note", schema = "ext_sample_notes")`.

Package it as one zip with only what the kernel needs, with the descriptor `package.xml` that
`@mosaikit/create-extension` writes: `manifest.yaml`, `lib/`, `db/`, `web/`, no sources. To
install it, copy the zip into `extensions/` of an installation as it is and restart it with the
`mosaikit` launcher. The launcher sees the new JAR, rebuilds the
kernel in a few seconds and starts it; the kernel then migrates the extension schema. Updating or
removing the extension works the same way. The status of each extension is at `GET /api/v1/extensions`:
`RESTART_REQUIRED` means that its JAR changed and the kernel was not started through the launcher.

If the kernel cannot be rebuilt or started with a new or updated extension, the launcher restores
the previous build and starts it again; the extension shows `INVALID` with the reason "Rolled back"
until a different version of its JAR is installed. See the output of the launcher for the
cause.

In a container image, add Java extensions by building a derived image, so that the rebuild happens
once, at image build time:

```dockerfile
FROM ghcr.io/mosaikit/mosaikit:0.2.0
COPY --chown=185 my-extension-1.0.0.zip /opt/mosaikit/extensions/
RUN /opt/mosaikit/mosaikit build
```
