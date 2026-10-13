# Notes (sample Java extension)

Shows what an extension with Java code looks like (MK-011):

| Path | Content |
|---|---|
| `manifest.yaml` | Declares the JAR (`backend.jar`), the database schema `ext_fixture_notes`, the permission `export-notes` (MK-056) and the resource type `memo` with its sharing levels (MK-055) |
| `pom.xml`, `src/` | The Java code: entities, Jakarta Data repositories, REST resources under `/api/v1/ext/fixture-notes`, whose `notes/export` needs the permission `export-notes`; `memos` registers each memo with the kernel and checks `Sharing.require` at every request, also for a link (`GET memos/{id}` is `@PermitAll`) |
| `web/` | The Notes app: a Web Component that calls the extension API with `context.fetch`, opens the sharing dialog of the shell for a memo (`shell.share`), and the element `mk-fixture-memo` that shows a memo opened with a link (`shared.view`) |
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
