# Notes (sample Java plugin)

Shows what a plugin with Java code looks like (MK-011):

| Path | Content |
|---|---|
| `manifest.yaml` | Declares the JAR (`backend.jar`) and the database schema `p_sample_notes` |
| `pom.xml`, `src/` | The Java code: entity, Jakarta Data repository, REST resource under `/api/v1/p/sample-notes` |
| `web/` | The Notes app: a Web Component that calls the plugin API with `context.fetch` |
| `db/` | Flyway migrations of the plugin schema, run by the kernel at start |
| `lib/sample-notes.jar` | Built by `./mvnw package`; not versioned |
| `target/sample-notes-<version>.zip` | The package to install, built by `./mvnw package` |

To install it, copy `target/sample-notes-<version>.zip` (also in `target/dist/plugins`) into the
`plugins/` directory of an installation as it is, and start it with the `mosaikit` launcher: the
launcher rebuilds the kernel with the plugin code. After sign-in, **Notes** appears in the menu of
apps.

```bash
curl -u admin:<password> -H 'Content-Type: application/json' \
     -d '{"text":"Hello"}' http://localhost:8080/api/v1/p/sample-notes/notes
curl -u admin:<password> http://localhost:8080/api/v1/p/sample-notes/notes
```
