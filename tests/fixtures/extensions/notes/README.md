# Notes (sample Java extension)

Shows what an extension with Java code looks like (MK-011):

| Path | Content |
|---|---|
| `manifest.yaml` | Declares the JAR (`backend.jar`) and the database schema `ext_fixture_notes` |
| `pom.xml`, `src/` | The Java code: entity, Jakarta Data repository, REST resource under `/api/v1/ext/fixture-notes` |
| `web/` | The Notes app: a Web Component that calls the extension API with `context.fetch` |
| `db/` | Flyway migrations of the extension schema, run by the kernel at start |
| `lib/fixture-notes.jar` | Built by `./mvnw package`; not versioned |
| `target/fixture-notes-<version>.zip` | The package to install, built by `./mvnw package` |

To install it, copy `target/fixture-notes-<version>.zip` (also in `target/dist/extensions`) into the
`extensions/` directory of an installation as it is, and start it with the `mosaikit` launcher: the
launcher rebuilds the kernel with the extension code. After sign-in, **Notes** appears in the menu of
apps.

```bash
curl -u admin:<password> -H 'Content-Type: application/json' \
     -d '{"text":"Hello"}' http://localhost:8080/api/v1/ext/fixture-notes/notes
curl -u admin:<password> http://localhost:8080/api/v1/ext/fixture-notes/notes
```
