# Extension development

## Quick start

Java 25, Maven and Node.js 24; nothing else to install. `create-mosaikit-extension` (MK-023) writes
a working extension, already wired to the parent POM of extensions and to the test bench:

```bash
npx @mosaikit/create-extension dev.acme.traffic --name "Traffic"            # frontend only
npx @mosaikit/create-extension dev.acme.traffic --name "Traffic" --backend  # with Java, schema and actions
cd traffic
npm install
npm run dev      # Mosaikit with the extension, until Ctrl+C: open the address it prints and sign in
mvn verify       # the package target/traffic-0.1.0.zip, and the tests of tests/ on the bench
```

`npm run dev` starts a real Mosaikit with the extension, an organization and two people on your
machine, downloading the installation once; a changed frontend shows at once in the open page.
The generated extension has an app at `/app/traffic`; with `--backend`, a table under row-level
security, a REST API under `/api/v1/ext/traffic`, and two actions for assistants. From this
repository, `node sdk/create-extension/dist/bin.js` does the same after `npm run build`.

To install the extension elsewhere, copy `target/traffic-0.1.0.zip` into `extensions/` of an
installation, or upload it from the Extensions page; sign it first for an installation that accepts
only trusted publishers ([Signing a package](#signing-a-package)). The samples in
[mosaikit/mosaikit-samples](https://github.com/mosaikit/mosaikit-samples) are complete extensions built the same way.
The rest of this guide explains what each part does.

## Build an extension

The POM of an extension names the parent of extensions, `io.github.mosaikit:mosaikit-extension-parent`
(MK-051), which holds the build: versions of Quarkus and of the extension API, compilation, the Jandex
index, the JAR in `lib/` and the package.

```xml
<parent>
    <groupId>io.github.mosaikit</groupId>
    <artifactId>mosaikit-extension-parent</artifactId>
    <version>0.1.0-SNAPSHOT</version>
    <relativePath/>
</parent>
<groupId>dev.acme</groupId>
<artifactId>traffic</artifactId>
<version>0.1.0</version>
<!-- <packaging>pom</packaging> for an extension without Java code -->
```

`mvn package` writes `target/<artifactId>-<version>.zip`; the property `extension.package.name`
changes its name, which is also the name of the JAR (`backend.jar` in the manifest). With a
`package.json`, `mvn package` also runs `npm install` and `npm run build`, and `mvn verify` the
tests of the extension (`npm test`); `-Dskip.npm` and `-DskipTests` skip them.

## Try and test an extension

`@mosaikit/testing` ([ADR-0035](../adr/0035-plugins-outside-the-kernel-repository.md), MK-050) is
a test bench: a real installation with your extension, on an embedded PostgreSQL, with an
organization and two people who confirmed their address. Nothing to install but Java 25 and
Node.js 24; the installation is downloaded once into `~/.cache/mosaikit`. The generated extension
uses it already:

```bash
npm install
npm run dev     # Mosaikit with the extension, until Ctrl+C; prints the address and the people
npm test        # the Playwright tests of tests/, on a bench started for them
```

With `npm run dev` the extension directory is linked into the installation and watched: a changed
frontend shows at once in the open page; Java code and migrations are read at the next start.
`npm test` starts a bench in `tests/global-setup.ts` (`Bench.start`) and the tests use the helpers
of `@mosaikit/testing/playwright`: `signIn`, `openApp`, `api`, `member`, `restart`. A run with one
test takes about 20 seconds for a frontend-only extension and 35 seconds with Java code, which the
launcher builds into the kernel at the first start. `MOSAIKIT_BENCH_DEBUG=1` prints how long each
phase of the start takes.

On Windows an antivirus scans each new file when a program first opens it: the bench links the
libraries of the kernel instead of copying them, but the first start after a new installation is
slower. A [Dev Drive](https://learn.microsoft.com/windows/dev-drive/) for the sources and the
caches avoids most of it.

Until the first release the bench tests on the snapshot of `main`, published at every push in the
pre-release [`snapshot`](https://github.com/mosaikit/mosaikit/releases/tag/snapshot): the version
of `@mosaikit/testing` chooses the installation. `MOSAIKIT_INSTALLATION` chooses another one, such
as `target/dist/mosaikit` of a build of the kernel.

## Anatomy

```
my-extension/
├── manifest.yaml     # the contract (JSON Schema in sdk/java)
├── web/index.js      # ES module exporting the extension frontend (optional)
├── lib/my-extension.jar # Java code, built from the sources of the extension (optional)
└── db/               # Flyway migrations of the extension schema p_<name> (optional)
```

## Manifest

```yaml
id: dev.example.hello          # reverse-DNS, stable forever
version: 1.0.0                 # semantic version
name: Hello
kind: [app]                    # app, extension, service, theme, locale, auth
platform: ">=0.1 <1"           # kernel versions the extension runs on
requires:                      # other extensions, with accepted versions
  dev.example.base: "^2"
frontend:
  entry: web/index.js
  isolation: module            # module, or iframe to always run isolated (MK-014)
  points: [hello.panel]        # extension points that other extensions contribute to (MK-020)
  bridge:                      # what the frontend may do when it runs isolated
    publishes: [hello.greeted]
    subscribes: [maps.*]
    services: [api]            # api: its own backend API; data: its collections
data:                          # JSON documents kept by the kernel, without a backend (MK-046)
  collections: [greetings]     # [a-z][a-z0-9-]*, unique in the extension
backend:
  jar: lib/hello.jar           # Java code, loaded by the launcher at the next start
  api: hello                   # REST resources under /api/v1/ext/hello/
actions:                       # tools for assistants and MCP clients (MK-015)
  - name: greet                # [a-z][a-z0-9-]*, unique in the extension
    title: Greet someone
    description: Says hello to a person by name.
    risk: write                # read runs at once; write and execute need a confirmation
    input:                     # JSON Schema subset: type, properties, required,
      type: object             # additionalProperties, items, enum, lengths, bounds
      properties:
        name: {type: string, maxLength: 80}
      required: [name]
    call:
      method: POST             # read actions must use GET
      path: greetings/{name}   # relative to /api/v1/ext/hello/; {name} comes from the input
database:
  schema: ext_hello              # owned by the extension; migrations in db/ (default)
contributes:
  rail.app:                    # the app bar of the shell (MK-025)
    - id: hello
      title: Hello
      route: /app/hello        # /app/<name>
      element: example-hello   # custom element rendered for the route
      icon: web/icon.svg       # 24 × 24 SVG or PNG of the extension; a tile with the initials otherwise
      order: 50                # position in the app bar, smaller first; 100 by default
      i18n:                    # the texts in other languages (MK-053); title is the default
        it: { title: Ciao }
```

Every text attribute of a contribution (`title`, `description`, …) can be given in other languages
in its `i18n` block, by language tag (`it`, `zh`, `pt-BR`). The shell shows the text in the language
of the person, or in its main language (`it` for `it-CH`), otherwise the attribute itself, and
changes it when the person changes language. Extensions that read the contributions of others use
`textAttribute(contribution, 'title', locale)` from `@mosaikit/sdk`.

The administrators of each organization decide which apps appear, in which order and for whom
(MK-030); when they turn off all the apps of an extension, the kernel refuses its API
(`/api/v1/ext/<api>/…`) and its documents (`/api/v1/data/<extension id>/…`) to that organization with
403, so the extension needs no check of its own.

Every app has a permission, `use-<app id>` (`dev.example.hello:use-hello` for the app above), which
the kernel declares for the extension next to those of its manifest (MK-056): the administrators
see it in their profiles, teams and exceptions, titled "Use <title of the app>". It matters only
when the organization restricts the app to the people who hold its permission, and for guests,
who see an app only when it is granted to them; otherwise members and administrators see it. The extension does not declare it; if its manifest declares a permission with the
same name, that one counts, with its title. The app permission does not guard the API of the
extension: check the permissions of the manifest there.

A contribution to `rail.app`, `launcher.app` or `settings.section` can name a permission in
`permission` (a name of the manifest, or `<extension>:<permission>`): the shell hides it from people
who do not hold it, reading `GET /api/v1/shell/permissions`. Hiding is for the interface only: the
backend still checks.

`launcher.app`, the point of the first versions, is still shown in the app bar during the 0.x
versions, with a warning in the status of the extension (`warnings` in `GET /api/v1/extensions`): rename
it to `rail.app`.

## Frontend contract

The module's default export implements `MosaikitExtension` from `@mosaikit/sdk`:

```ts
import { defineExtension } from '@mosaikit/sdk';

export default defineExtension({
  activate(context) {
    customElements.define('example-hello', class extends HTMLElement { /* ... */ });
    context.events.on('maps.selection.changed', (payload) => { /* ... */ });
  },
});
```

Any framework that produces custom elements can be used. Use the shell's CSS custom properties
(`--mk-surface`, `--mk-fg`, `--mk-accent`, …) so that the extension follows the theme.

### Real time

The shell keeps one WebSocket to the kernel (MK-031). A frontend reacts to the changes of its
collections, made by anyone of the organization, and to the events of its backend:

```js
const items = context.data('items');
const stop = items.onChange(({ id, action }) => refresh()); // created, replaced, deleted
context.live.subscribe('extension.dev.example.hello.greeted', (data) => show(data));
```

A Java backend publishes with `LiveEvents` of `kernel-api`; the event leaves when the transaction
commits, and reaches the pages subscribed to the topic in the same organization:

```java
@Inject LiveEvents live;
live.publish("extension.dev.example.hello.greeted", Map.of("id", greeting.id()));
```

Topics are `documents.<extension id>.<collection>`, `extension.<extension id>.<name>` and `notifications`;
the kernel refuses the others, and those of extensions that the organization turned off. Send what
changed, not the data: pages read it again with the rights of each person.

### Notifications

An extension notifies people of the organization in their activity feed (MK-038): a frontend with
`context.notify`, by email address, a Java backend with `Notifications` of `kernel-api`, by account
identifier.

```js
await context.notify({
  to: ['anna.bianchi@example.org'],
  kind: 'mention',            // people can turn each kind off
  title: 'Mario mentioned you',
  body: 'In the notes of the meeting',
  link: '/app/notes',         // a path of the shell
});
```

The people who are not in the organization, or who turned the kind off, receive nothing. The feed
is pushed on the real-time channel, so the pages show it at once.

### Settings, language and theme

An extension adds a section to the personal settings with the point `settings.section`; `roles`, when
given, shows it only to people with one of them:

```yaml
contributes:
  settings.section:
    - id: export
      title: Export
      element: example-export-settings   # custom element rendered in the section
      roles: [organization-admin]        # optional
```

`context.locale` is the language the person chose (`en`, `it`); read it when rendering. The shell
publishes `shell.locale.changed` (`{ locale }`) and `shell.theme.changed` (`{ theme, appearance }`)
on the event bus, and mounts the current app again when the language changes.

### Theme extensions

An extension of kind `theme` brings the colors of a brand and, for a product built on Mosaikit, the
name and logo of the product. It is active as soon as it is installed, people choose it in their
settings, and an installation can make it its default (`mosaikit.ui.theme=<extension id>`):

```yaml
id: dev.example.brand
version: 1.0.0
name: Our brand
kind: [theme]
platform: '>=0.1 <1'
theme:
  title: Our brand
  font: "'Inter', system-ui, sans-serif"   # optional
  radius: 8                                # optional, 0 to 24 pixels
  light:                                   # any of: brand, background, surface, foreground,
    brand: '#8a1538'                       # muted, line, danger, success, warning, focus
  dark:
    brand: '#e2738f'
  product: Our product                     # optional, up to 60 characters
  logo:                                    # optional, SVG or PNG files of the extension
    light: web/logo.svg                    # for light backgrounds
    dark: web/logo-dark.svg                # optional, for dark backgrounds
```

Every color, font or radius it leaves out comes from the default theme. The product name and the
logo (MK-052) apply only when the theme is the one of the installation: the shell then shows them
in its bar and on the sign-in page, and uses them as the title and the icon of the page, also for
people who choose another theme in their settings. The bar of the shell has the brand color, so it
shows the logo for dark backgrounds; without one, the logo for light backgrounds. Draw the logo
square: it is shown at 22 to 28 pixels. Choose colors with enough
contrast (WCAG 2.1 AA: 4.5:1 for text): the high contrast appearance stays available to everyone.
[`sample-theme`](https://github.com/mosaikit/mosaikit-samples/tree/main/theme) is a complete example.

### Components and themes

The shell defines the Fluent UI web components for the page
([ADR-0032](../adr/0032-fluent-ui-and-themes.md)): an extension that runs as a module can use
`<fluent-button>`, `<fluent-dialog>`, `<fluent-tablist>` and the others without bundling them, and
they follow the theme of the installation. Style everything else with the tokens:

| Token | Use |
|---|---|
| `--mk-bg`, `--mk-surface` | background of the page, of cards and panels |
| `--mk-fg`, `--mk-muted` | text, secondary text |
| `--mk-line` | borders |
| `--mk-accent`, `--mk-accent-fg`, `--mk-accent-soft` | primary actions, text on them, selection |
| `--mk-danger`, `--mk-success`, `--mk-warning` | states |
| `--mk-focus` | the ring of the keyboard focus |
| `--mk-radius`, `--mk-font`, `--mk-font-mono` | shapes and fonts |

The tokens change with the theme (`mosaikit.ui.theme`: `mosaikit`, or `pa` in the style of
Bootstrap Italia) and with the light or dark preference of the system; never hard-code colors.

### Frontends written with a framework

A frontend may use React, Vue or any framework ([ADR-0020](../adr/0020-frontends-in-any-framework.md)):
bundle it with the framework into one ES module (Vite library mode, `formats: ['es']`) and declare
that module as `frontend.entry`, as [`sample-react`](https://github.com/mosaikit/mosaikit-samples/tree/main/react) and
[`sample-vue`](https://github.com/mosaikit/mosaikit-samples/tree/main/vue) do. Render inside the shadow root of your custom element,
unmount in `disconnectedCallback`, style with the `--mk-*` tokens and talk to other extensions only
through `context.events` and extension points.

### Isolated frontends

A frontend runs isolated in a sandboxed iframe (MK-014,
[ADR-0015](../adr/0015-isolated-plugin-frontends.md)) when its manifest says
`isolation: iframe`, or when its publisher is not verified (an unsigned package, a key the
installation does not trust, an extension directory) and the installation isolates such extensions
(`mosaikit.extensions.unverified-frontends=iframe`, the default). The same module works in both
modes, as long as it uses only its `context`:

| In the context | Isolated |
|---|---|
| `events.publish(topic)` | only topics of `bridge.publishes` reach the shell |
| `events.on(pattern)` | only patterns covered by `bridge.subscribes` receive events |
| `fetch(path, init)` | only the backend API of the extension (`/api/v1/ext/<api>/…`, or a path relative to it), text bodies, with `bridge.services: [api]` |
| `data(collection)` | only the collections of the extension, with `bridge.services: [data]` |
| `user`, `extension`, `contributions`, `locale` | as usual |

In the iframe the extension has no access to the page of the shell, to its storage or to the
credentials of the person, and it can load code and data only from the kernel. Declare the bridge
even if you plan to run as a module: installations that isolate unverified extensions use it.

## Java code

[`samples/notes`](https://github.com/mosaikit/mosaikit-samples/tree/main/notes) is a complete example: an entity, a Jakarta
Data repository and a REST resource, with the migration of its schema.

- Build the extension as a Maven module whose dependencies all have scope `provided`: `mosaikit-kernel-api` (sdk/java),
  the Jakarta APIs and the Quarkus extensions the kernel already contains (REST, Hibernate ORM,
  Hibernate Validator, security). The JAR contains only the extension's classes. An extension cannot
  bring new Quarkus extensions.
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

## Signing a package

Installations can refuse packages that are not signed by a publisher they trust (MK-013,
[ADR-0014](../adr/0014-signed-plugin-packages.md)). Sign every package you publish with the tool in
the JAR of the Java extension API:

```bash
API=mosaikit-kernel-api-0.1.0.jar
TOOL=dev.mosaikit.kernel.api.signature.PackageSigningTool
java -cp $API $TOOL keygen ~/keys acme            # once: acme.pub.pem and acme.key.pem (secret)
java -cp $API $TOOL sign ~/keys/acme target/my-extension-1.0.0.zip
java -cp $API $TOOL verify ~/keys target/my-extension-1.0.0.zip
```

Give `acme.pub.pem` to the administrators: they copy it into `config/trusted-keys` of their
installation. Signing again replaces the signature; changing any file afterwards makes the package
refused. A registry can store the signed zip as an OCI artifact as it is:

```bash
oras push registry.example.org/extensions/my-extension:1.0.0 \
  my-extension-1.0.0.zip:application/vnd.mosaikit.extension.v1+zip
oras pull registry.example.org/extensions/my-extension:1.0.0 -o extensions/
```

## Extensions without a backend

Most apps keep simple records of an organization. Such an extension needs no Java code and no schema
([ADR-0031](../adr/0031-frontend-plugins-on-the-data-api.md)): it declares collections in
`data.collections`, and the kernel keeps their JSON documents for each organization, under
row-level security, at `/api/v1/data/<extension id>/<collection>`. The frontend uses them through its
context:

```js
const items = context.data('items');
const created = await items.create({ title: 'Paint the fence', done: false });
await items.update(created.id, { ...created.data, done: true }, created.version); // 409 if changed since
const all = await items.list({ limit: 50 });                                     // newest first
await items.remove(created.id);
```

A document is a JSON object of at most 256 KiB, and a collection holds at most 10,000 of them.
Errors are `DataError`s with the HTTP status and the detail of the kernel. Such an extension is active
as soon as it is installed: the marketplace answers `restartRequired: false` and the shell shows
the app without a reload. [`sample-todo`](https://github.com/mosaikit/mosaikit-samples/tree/main/todo) is a complete example, and
`create-mosaikit-extension` without `--backend` writes one. When an app needs queries beyond listing
and paging, give it a backend and a schema.

### Sharing with a team

A collection opened with a `team` holds the documents shared with that team (MK-032): only its
people read and write them, and the row-level security of the kernel enforces it whatever the
query. Without it, a collection holds the documents of the whole organization, which the guests of
the organization do not see.

```js
const teams = await (await context.fetch('/api/v1/teams')).json(); // theirs, and the public ones
const notes = context.data('notes', { team: teams[0].id });
await notes.create({ text: 'Agenda of Monday' });
notes.onChange(() => refresh()); // only the changes of that team
```

A Java backend reads the teams of the person and their people through `Teams` of `kernel-api`
(`dev.mosaikit.kernel.api.teams`). Guests of an organization cannot call the APIs of backends.

## Data of organizations

Every request of a person to an extension API acts on one organization of the signed-in person (MK-017,
[ADR-0016](../adr/0016-membership-of-several-organizations.md)). Store the organization with
every row and filter on it, so that data of other organizations are never visible:

```java
@Path("/api/v1/ext/notes/notes")
public class NoteResource {
    @Inject CurrentOrganization organization;   // dev.mosaikit.kernel.api.context

    @GET
    public List<NoteView> list() {
        return notes.findByOrganization(organization.require()).stream().map(NoteView::of).toList();
    }
}
```

`require()` answers `403` when a request has no organization; the kernel already refuses such
requests of people to extension APIs. Calls of services are the exception (below).

### Calls of services

A platform administrator can give the API of an extension to a service identity (MK-124), for
callers that are not people, such as a gateway or a map server. Such a call reaches the extension
with no person and, unless the service names an organization it was allowed with
`X-Mosaikit-Organization`, no organization: `CurrentOrganization.id()` is empty and row-level
security shows no row of any organization. Recognize it with the security identity of Quarkus:

```java
@Inject SecurityIdentity identity;   // io.quarkus.security.identity

boolean service = identity.hasRole("service");          // a service identity, not a person
String caller = identity.getPrincipal().getName();      // "service:<name>" for a service
```

Endpoints meant for services check the role, for example with `@RolesAllowed("service")`; endpoints
for people keep their own roles (`organization-user`, ...), which a service never has. A service
identity has no permissions of an organization (MK-056) and no account.

Then let the database enforce it (MK-019, [ADR-0018](../adr/0018-row-level-security.md)): give
each table of organization data a row-level security policy on `mk_kernel.current_organization()`,
which the kernel sets for every request. Queries that forget the filter still see only the rows
of the organization, and rows of another organization cannot be written:

```sql
create table note (
    id              uuid primary key,
    organization_id uuid not null default mk_kernel.current_organization(),
    text            varchar(500) not null
);
alter table note enable row level security;
create policy note_organization on note
    using (organization_id = mk_kernel.current_organization())
    with check (organization_id = mk_kernel.current_organization());
```

Do not reference the tables of the kernel nor of other extensions: extend the data of another
extension with a table of your own keyed by its identifiers, and read it through the views that
extension publishes as its data contract.

## Extending another extension

An extension extends another one on three levels ([ADR-0019](../adr/0019-plugins-extending-plugins.md)),
as [`sample-estimates`](https://github.com/mosaikit/mosaikit-samples/tree/main/estimates) extends
[`sample-activities`](https://github.com/mosaikit/mosaikit-samples/tree/main/activities):

1. **Require it**, so that the kernel migrates it first and refuses yours without it:
   `requires: { dev.mosaikit.sample.activities: '^0.1' }`.
2. **Data**: keep your field in a table of your schema keyed by its identifiers, without a foreign
   key, and read its data only through the views it publishes (`ext_sample_activities.activity_v1`),
   mapped as read-only entities. Publish your own views `with (security_invoker = true)`, so that
   row-level security applies to whoever reads them.
3. **Interface**: contribute a custom element to one of the points its frontend declares:

   ```yaml
   contributes:
     activities.detail:
       - id: estimate
         element: mk-activity-estimate   # receives the activity in its activity-id attribute
   ```

   The owner of a point reads the contributions with `context.contributionsTo('activities.detail')`
   and creates the elements. The contributions of an extension turned off for the organization are
   missing, so the owner shows them as unavailable instead of breaking.

   The app Teams declares `channel.tab`, the tabs of its channels (MK-035): contribute
   `{ id, title, element }`, and the element gets the properties `team` and `channel`, the
   identifiers of the team and of the channel, to read and write the documents of that team:

   ```yaml
   contributes:
     channel.tab:
       - id: todo
         title: To do
         element: mk-sample-todo
   ```
4. **Behaviour**: publish and subscribe to events on the bus (`estimates.changed`,
   `activities.completed`).

## Actions for assistants

An action is a call to the backend API of the extension that an assistant may make on behalf of the
signed-in person (ADR-0017). The kernel checks the arguments against `input`, puts the arguments
named in `path` there, and sends the others as the query (`GET`, `DELETE`) or the JSON body. The
call carries the credentials of the person and the organization of the request, so the usual
`@RolesAllowed` checks and `CurrentOrganization` apply: an action never needs code of its own.
Choose the risk honestly: `read` for calls without effects, `write` for changes of data, `execute`
for processes, messages or anything that leaves the installation. Describe the action for a person
who has to confirm it, not for the assistant only.

## Resources, sharing and permissions

> **Registry, permissions and sharing implemented.** The kernel provides the `Resources` bean
> (MK-054), the `Permissions` bean (MK-056) and the `Sharing` bean (MK-055): Java extensions
> register their resources, check permissions and share resources today, and the REST API of the
> sharing dialog is under `/api/v1/sharing`; the dialog itself and its `@mosaikit/sdk` counterpart
> come next. See
> [ADR-0037](../adr/0037-resources-and-one-sharing-model.md) and
> [ADR-0038](../adr/0038-permissions-from-manifests-and-profiles.md). The counterpart in
> `@mosaikit/sdk` (permissions to hide what is not available, the sharing dialog) comes with the
> next versions; the shell already reads the permissions of the person from
> `GET /api/v1/shell/permissions` and hides the contributions that name one the person lacks
> (`permission`, see the app bar above).

Permissions say **what** a person may do in an extension; sharing says **on which resources**. The
extension declares both in its manifest, and the kernel keeps who has what:

```yaml
permissions:                   # off until administrators grant them (MK-056)
  - name: create-dashboard     # [a-z][a-z0-9-]*, unique in the extension
    title: Create dashboards   # shown in the profile editor of the organization
    description: Create new dashboards of the organization.
    i18n: { it: { title: Creare cruscotti } }   # title and description only
resources:                     # types of the resources the extension registers (MK-054)
  - type: dashboard            # [a-z][a-z0-9-]*, unique in the extension
    title: Dashboard
    i18n: { it: { title: Cruscotto } }
    levels:                    # from the lowest to the highest; each includes those before it
      - { name: view, title: View, i18n: { it: { title: Vedere } } }
      - { name: use, title: Use }
      - { name: edit, title: Edit, edits: true }       # levels that edit come last
      - { name: manage, title: Manage, edits: true }
    subjects: [person, group, organization, link]   # person, group, organization when left out
    linkLevel: use             # the most a link gives (lowest when left out), never one that edits
```

The rules the kernel applies:

- **Deny by default.** A member has a permission only through their profile, a group of theirs or a
  personal exception, and a level on a resource only as its owner or through a grant to them, to a
  group of theirs, to the organization, to a link they opened or to the public.
- **Administrators of the organization hold everything in it**: every permission of every
  extension, implicitly, and every level on every resource of the organization, so they read and
  edit everything. **Platform administrators hold none** in an organization for being platform
  administrators. **Guests hold no permission** unless a group of theirs or a personal exception
  grants it explicitly.
- **Grants only add.** Profiles, groups and exceptions add permissions, grants add levels; nothing
  takes away what another grants. Granting again to the same subject **replaces** its level, also
  lowering it, and the change is audited.
- **No inheritance from the parent, for now.** A grant on a parent resource (a folder, a project)
  does not pass to its children; this is a decision to revisit when the kernel has folders.
- **Owner.** A resource registered in a request with a signed-in person is owned by that person; one
  registered without a person (a job, an import, a migration of existing data) is owned by the
  **organization**, has no owner in `Resource`, and its administrators manage it.
- **Who shares**: the owner, the people with the highest level of the type and the administrators of
  the organization, never above their own level.
- **Links and the public get little.** They are opt-in in `subjects`. The public always gets the
  lowest level of the type; a link gets at most `linkLevel`, which a type may raise to its "use"
  level but never to a level with `edits: true`. A link always has an expiry, within a longest
  validity set by the installation.
- **New permissions arrive switched off.** A permission that an update of the extension adds is in
  no profile until an administrator puts it there.
- **Removing what has grants is refused.** An update of the extension that removes a resource type,
  or a level of one, on which grants exist is refused, with the list of those grants: revoke them
  first (a migration declared by the extension may come later). `ExtensionManifest.sharingRemovedBy`
  tells what an update removes.
- **The kernel is the authority**: it keeps profiles and grants, offers the same sharing dialog for
  every type, and writes every grant, change of level, revocation and use of a link in the audit log
  (MK-059).
- **The extension enforces the answers in its backend**, at every request: the interface only hides
  what is not available.

Outside its extension a permission is named by its qualified identifier `<extension>:<permission>`,
such as `dev.example.dashboards:create-dashboard` (`PermissionId`): in the profiles of the
organization, in the answers of the API of the kernel and in the audit log. Inside the extension, in
the manifest and in the calls of `Permissions`, the name alone is used.

All Java extensions run in the same process, so the kernel cannot tell which one calls: **every call
names the calling extension**, in `ResourceRef` or as the `extension` argument, as
`Notifications.send` does. The kernel checks that it is an installed extension and that its manifest
declares the type or the permission, and refuses anything else.

In the Java backend, register each resource when it is created, and check both the permission and
the level before acting:

```java
@Path("/api/v1/ext/dashboards/dashboards")
public class DashboardResource {
    private static final String EXTENSION = "dev.example.dashboards";

    @Inject Resources resources;       // dev.mosaikit.kernel.api.resource
    @Inject Sharing sharing;           // dev.mosaikit.kernel.api.sharing
    @Inject Permissions permissions;   // dev.mosaikit.kernel.api.permission

    @POST
    @Transactional
    public DashboardView create(NewDashboard body) {
        permissions.require(EXTENSION, "create-dashboard");               // 403 without it
        Dashboard dashboard = dashboards.insert(body);
        resources.register(                                               // owner: the person of the request
                new ResourceRef(EXTENSION, "dashboard", dashboard.id().toString()),
                Resources.Details.of(dashboard.title(), "/app/dashboards/" + dashboard.id()));
        return DashboardView.of(dashboard);
    }

    @PUT
    @Path("{id}")
    @Transactional
    public DashboardView update(@PathParam("id") UUID id, DashboardChange body) {
        ResourceRef ref = new ResourceRef(EXTENSION, "dashboard", id.toString());
        sharing.require(ref, "edit");      // 403 with a lower level, 404 with none
        Dashboard dashboard = dashboards.update(id, body);
        resources.update(ref, Resources.Details.of(dashboard.title(), "/app/dashboards/" + id));
        return DashboardView.of(dashboard);
    }

    @GET
    public List<DashboardView> list() {
        Set<String> visible = sharing.visible(EXTENSION, "dashboard", "view");
        return dashboards.findByIds(visible).stream().map(DashboardView::of).toList();
    }

    @POST
    @Path("{id}/share")
    @Transactional
    public void share(@PathParam("id") UUID id, UUID team) {
        sharing.grant(new ResourceRef(EXTENSION, "dashboard", id.toString()), Subject.group(team), "view");
    }
}
```

`sharing.visible` returns a set of identifiers, which suits collections of hundreds of resources.
For larger ones call the SQL function of the kernel in the query of the list page, so that the
database filters and pages the rows and the identifiers never travel:

```sql
-- mk_kernel.allows(extension text, type text, id text, level text) returns boolean
select d.* from ext_dashboards.dashboard d
where mk_kernel.allows('dev.example.dashboards', 'dashboard', d.id::text, 'view')
order by d.title
limit 50 offset 0;
```

It answers for the request, as `sharing.allows(ref, level)` does: `true` when the resource is
registered in the organization of the request and the person is its owner, an administrator of the
organization, or reached by a grant at that level or above (to them, to a team of theirs, to the
organization unless they are a guest, or to the public, which counts as the lowest level). An
undeclared level, a type of no active extension or a resource that is not registered give `false`.
Links are not considered: a request opened with a link has no organization, and the Java API answers
for it.

`require` throws `AccessDeniedException` (`dev.mosaikit.kernel.api.permission`), which the kernel
answers with 403, or with 404 when the person may not see the resource at all, so that its existence
is not revealed. `grant`, `createLink` and `revoke` act as the person of the request: the owner, the
administrators of the organization and the people with the highest level of the type share, never
above their own level. Remove the entry with `resources.remove(ref)` when the resource is deleted:
its grants go with it. The registration joins the transaction of the request, so a rollback undoes
both.

What the permissions do today (MK-056):

- `has`, `granted` and `require` act on the person and the organization of the request. They
  refuse, with `IllegalArgumentException`, an `extension` that is not active; a permission that its
  manifest does not declare is never granted, not even to an administrator.
- A member holds the permissions of their profile (the one assigned to them, or the default profile
  of members), of their teams and of their personal exceptions; the administrators of the
  organization hold every declared permission; guests only those of their teams and exceptions; a
  request without an organization or without a person holds none.
- When all the apps of the extension are off for the organization (MK-030), nobody holds its
  permissions.
- `AccessDeniedException` from `require` reaches the kernel, which answers 403 with a problem
  detail: let it propagate from the resource method.
- A permission that an update adds is in no profile. When an update removes a permission, its
  grants are removed at the next start, so that bringing it back later arrives switched off too.
- Profiles and grants live in the kernel tables `mk_kernel.permission_profile`,
  `mk_kernel.member_profile` and `mk_kernel.permission_grant`, under row-level security; the
  administrators of the organization manage them through
  `/api/v1/organizations/{slug}/permissions` (see the [administration guide](../guide/administration.md)).
- Guests are refused the backends of extensions (`/api/v1/ext/…`) as before (MK-032): a permission
  granted to a guest matters for the frontend and for the documents of the extension.

What sharing does today (MK-055):

- Levels are ordered as the manifest lists them; `grant`, `createLink` and `allows` refuse, with
  `IllegalArgumentException`, a level the type does not declare, a kind of subject the type does not
  accept (`subjects`), a level above what the kind may get (the lowest for the public, `linkLevel`
  for links), a person or a team of another organization, and a link without an expiry or expiring
  after the longest validity of the installation (`mosaikit.sharing.link-max-validity`, 30 days by
  default). A resource that is not registered in the organization throws `NoSuchElementException`.
- The people who share are the owner, the administrators of the organization and the people who
  hold the highest level through a grant to them, a team of theirs or the organization; a level
  given by a link or the public never lets anyone share. The others get `AccessDeniedException`.
- Granting again to the same subject replaces its level, also lowering it; `revoke` of a grant that
  is gone does nothing. The grants of a resource go with it, with the person or the team they name.
- `createLink` returns the address `/shared/<secret>`; the kernel keeps only the SHA-256 of the
  secret, so the address is given once. A link is opened without an account with
  `POST /api/v1/sharing/links/open` (`{ "token", "password" }`), which answers the resource, its
  link and the level, 404 once the link expired or was revoked, and 403 when its password is
  missing or wrong. A request that carries the secret in the header `X-Mosaikit-Link` (and the
  password in `X-Mosaikit-Link-Password`) gets the level of the link from `level`, `allows`,
  `require` and `visible`. Every use of a link, refused or not, is in the audit log
  (`sharing.link.used`). The APIs of extension backends (`/api/v1/ext/*`) still require an account:
  serving a resource to a link without an account comes with the sharing dialog.
- Grants live in the kernel table `mk_kernel.resource_grant`, under row-level security: another
  organization never sees them.

What the registry does today (MK-054):

- `register` refuses, with `IllegalArgumentException`, a reference whose extension is not active or
  does not declare the type in `resources`, a title or a link that is not valid, and a parent that is
  not a registered resource of the organization or that is contained in the resource itself.
  Registering again changes title, link and parent and keeps the owner, so existing resources can
  be registered by a migration of the extension, owned by the organization.
- `update` throws `NoSuchElementException` for a resource that is not registered in the
  organization; `remove` of a resource that is not registered does nothing. Removing a parent leaves
  its children without a parent.
- Entries live in the kernel table `mk_kernel.resource`, under row-level security like the tables of
  extensions: a request sees and writes only the entries of its organization, and another
  organization never sees them, not even by reference.
- When an extension is no longer in the installation, the kernel removes its entries, in every
  organization, at the next start.

The apps per role of an organization (MK-030) **moved onto this model**: an app restricted by the
organization shows to the people who hold its permission `use-<app>` (see the app bar above). The
sharing of the rows of a data collection with a team (MK-032) becomes a grant to a group next.

## Rules

- Import only `kernel-api`, the Jakarta APIs and the extensions provided by the kernel (Java) and
  `@mosaikit/sdk` (frontend), plus the SPI modules of the extensions you declare in `requires`. Never
  import the kernel itself (`mosaikit-kernel`).
- Talk to other extensions through the event bus and declared services, never by importing them.
- Keep one database schema per extension, forward-only migrations, no foreign keys to other schemas.
