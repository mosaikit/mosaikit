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
[mosaikit/mosaikit-ext-samples](https://github.com/mosaikit/mosaikit-ext-samples) are complete extensions built the same way.
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
of `@mosaikit/testing/playwright`: `signIn`, `openApp`, `api`, `member`, `restart`. The bench
generates a random master key at each start, so an extension that reads credentials (`Secrets`) can
store them first in its tests, through the API of the credentials of the organization or of the
installation. A run with one test takes about 20 seconds for a frontend-only extension and 35
seconds with Java code, which the launcher builds into the kernel at the first start. `MOSAIKIT_BENCH_DEBUG=1` prints how long each
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
[`sample-theme`](https://github.com/mosaikit/mosaikit-ext-samples/tree/main/theme) is a complete example.

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
that module as `frontend.entry`, as [`sample-react`](https://github.com/mosaikit/mosaikit-ext-samples/tree/main/react) and
[`sample-vue`](https://github.com/mosaikit/mosaikit-ext-samples/tree/main/vue) do. Render inside the shadow root of your custom element,
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

[`samples/notes`](https://github.com/mosaikit/mosaikit-ext-samples/tree/main/notes) is a complete example: an entity, a Jakarta
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

### Transactions and the beans of the kernel

The beans of `kernel-api` (`Secrets`, `Resources`, `Sharing`, `Permissions`, `PermissionHolders`,
`FileStorage`, `Quotas`, `AuditLog`, `PlatformEvents`) join the transaction of the caller: what they
write commits or rolls back with the work of the extension.

**Documented exceptions leave your transaction usable.** An exception that a method of the API
declares in its `@throws`, such as `SecretsUnavailableException`, `NoSuchElementException`,
`IllegalArgumentException`, `AccessDeniedException` or `QuotaExceededException`, is thrown before
the bean writes anything in your transaction, and does not mark it for rollback. Catch it and go on
in the same transaction:

```java
@Transactional
public Report create(ReportRequest request) {
    String summary;
    try (SecretValue key = secrets.require("org.example.reports", "model-provider")) {
        summary = client.summarize(request.text(), key.reveal());
    } catch (SecretsUnavailableException | NoSuchElementException e) {
        summary = null; // no credential here: save the report without a summary
    }
    return reports.insert(new Report(request.title(), summary)); // commits
}
```

Any other failure of a bean, such as an error of the database, still marks the transaction for
rollback: let it go, and the kernel answers the request with an error.

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
the app without a reload. [`sample-todo`](https://github.com/mosaikit/mosaikit-ext-samples/tree/main/todo) is a complete example, and
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

A document shared with a team is a resource of the one sharing model (MK-055, ADR-0037), with no
code of the extension: the kernel registers it as a resource of type `data-document` of the
extension, owned by the organization, with the title of its `title`, `name` or `text` field, and
gives the team the level `edit` (the type has `view` and `edit`, and is shared with people, teams
and the organization, never with links or the public). The sharing dialog opens it like any other
resource (`context.events.publish('shell.share', { extension, type: 'data-document', id })`), to give
other people or teams access, for reading only or for changing it, or to take the team away. Unlike
the types of extensions, `data-document` is **private to its subjects**: the administrators of the
organization hold no level on it for being administrators, so a document of a team is read only by
the members of the team and by whoever it is shared with, as MK-032 decided. The name
`data-document` belongs to the kernel in an extension with collections.

A Java backend reads the teams of the person and their people through `Teams` of `kernel-api`
(`dev.mosaikit.kernel.api.teams`).

### Guests

A guest of the organization (MK-032) reaches the API of a backend only once the organization gave
them something of that extension: a permission of it through a team of theirs or a personal
exception (MK-056), or a resource of it that they own or that is shared with them or with a team of
theirs (MK-055). Otherwise the kernel answers 403 before the extension runs. Once let in, a guest
gets exactly what the checks of the extension give them, with the same rules as members:
`Permissions` answers with the permissions of their teams and exceptions (never a profile), and
`Sharing` with the grants to them and to their teams (never those to the organization). So every
route that a guest may reach must check a permission or a level: a route that lists the rows of the
organization without asking `Sharing` would show them to the guest. Keep the routes for the people
of the organization to their roles, which guests do not have:

```java
@GET
@Path("report")
@RolesAllowed({"organization-user", "organization-admin"})   // never a guest
public Report report() { ... }
```

In SQL, `mk_kernel.current_guest()` tells whether the request is of a guest, for a row-level security
policy that keeps the rows of the organization from guests, as the kernel does for its documents.

### People and teams of the organization

`Teams` answers what the person of the request sees. An extension that names people and teams
outside the kernel, such as in the rules of a map server, needs them for the whole organization,
also in a subscriber of events where there is no person: it reads them through `People`
(`dev.mosaikit.kernel.api.teams`), read-only, without a database login of its own (the published
views of [MK-123](published-views.md) are for services outside the kernel).

```java
@Inject People people;   // dev.mosaikit.kernel.api.teams

Optional<People.Person> ada = people.findByUsername("ada@example.org"); // username, standing, active
for (People.OrganizationTeam team : people.teams()) {                   // teams and groups, never chats
    List<String> users = people.members(team.id()).stream().map(Teams.Member::email).toList();
    rules.put(team.id().toString(), users);
}
List<People.OrganizationTeam> hers = people.teamsOf(ada.orElseThrow().account());
```

- **One organization.** Every method acts on the organization of the request, or of the event being
  handled. A person who is neither a member nor a guest of it is not found; a team of another
  organization, or a chat, has no people. `Person.username()` is the e-mail address the person signs
  in with, in lower case (`email()` returns the same); `standing()` is `administrator`, `member` or
  `guest`; `active()` is `false` while the account is suspended.
- **Teams, not chats.** `teams()` lists the teams and the groups of teams (`parent()` is the team of
  a group), private ones too: an extension that shows them to a person uses `Teams.visible()`.
- **Guests read their teams only.** When the person of the request is a guest of the organization,
  `People` answers with the teams and groups where they are, the people of those teams and the guest
  themselves. A request opened through a shared link gets nobody.

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
security shows no row of any organization. Recognize it with the security identity of Quarkus and
`ServiceCaller` (`dev.mosaikit.kernel.api.context`):

```java
@Inject SecurityIdentity identity;   // io.quarkus.security.identity

boolean service = ServiceCaller.isService(identity.getRoles());                       // not a person
Optional<String> name = ServiceCaller.name(identity.getPrincipal().getName());   // its name
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

## Files

Keep files (images, documents, rasters, exports) through the file service of the kernel (MK-041,
[ADR-0029](../adr/0029-files-on-s3-and-connectors.md)), never in your own tables nor on the disk of
the server. The kernel writes them to the store of the installation, a directory or an
S3-compatible bucket whose credentials only it holds, under `<organization>/<extension>/<id>`, and
keeps their name, type, size, SHA-256 and owner. It applies the rights of the person: a file is of
the whole organization or of one of its teams (MK-032), a person reads a file of a team only when
they are in it, a guest only the files of their teams, and a file the person may not read is not
found, even with its identifier. Storing and deleting are in the audit log.

A file attached to a registered resource (`attachedTo`, MK-054) follows the sharing of that resource
instead (MK-055): a person reads it, finds it in lists and links to it when they hold any level on the
resource, and attaches, replaces or deletes files of it with a level that `edits`; the person who
stored a file keeps it. The owner of the resource and the administrators of the organization hold
every level (not on the kernel's types private to their subjects, ADR-0037). So declare a level that
edits on a type whose files others should change. Code that runs without a person keeps the rules of
the organization and its teams; a signed link carries its own grant.

From Java, inject `FileStorage` (`dev.mosaikit.kernel.api.files`) and name your extension in every
call, as with `Resources`; content is streamed both ways:

```java
@Inject FileStorage files;

StoredFile photo = files.store(EXTENSION,
        FileStorage.NewFile.of("plans/garden.png", "image/png")
                .forTeam(team)                                   // optional: one team of the person
                .attachedTo(new ResourceRef(EXTENSION, "album", "summer")),  // optional (MK-054)
        upload);                                                 // an InputStream, read to its end

try (FileContent content = files.read(EXTENSION, photo.id())) {
    content.stream().transferTo(output);
}
List<StoredFile> mine = files.list(EXTENSION, null, 0, 100);    // or of one team
files.delete(EXTENSION, photo.id());                            // owner, team owner, administrators;
                                                                 // of a resource: a level that edits
```

The calls join the transaction of the caller: a file whose transaction rolls back leaves the store
too. A transaction that can no longer commit, because an earlier step marked it for rollback or it
timed out, stores nothing: `store` throws `IllegalStateException` before reading the content, and
`delete` leaves the file, as the rollback will. `NoSuchElementException` means not found or not readable, `IllegalArgumentException` a name,
type or size the kernel refuses (at most `mosaikit.files.max-size`), `SecurityException` a delete
the person may not make.

From a frontend, use the REST API with the session of the page
([API](api.md)): `POST /api/v1/files/<extension>?name=<name>` with the content as the body and its
type in `Content-Type` (`&team=<id>` for a team), `GET /api/v1/files/<extension>` to list,
`GET /api/v1/files/<extension>/<id>` for the metadata and `.../<id>/content` for the content, which
answers `Range`, `If-None-Match` and `If-Modified-Since` (the `ETag` is the checksum), so that an
image or a tile is fetched in parts and revalidated cheaply:

```js
const response = await fetch(`/api/v1/files/${EXTENSION}?name=${encodeURIComponent(file.name)}`, {
  method: 'POST',
  headers: { 'Content-Type': file.type || 'application/octet-stream' },
  body: file,
});
const stored = await response.json(); // { id, name, contentType, size, checksum, ... }
```

### Signed links to files

A viewer, an external tool, an embedded page or a link in a notification downloads files without the
session of the person through a signed, expiring link (MK-093). Ask for a link to a file the person
reads, or to every file whose name starts with a prefix, such as `tiles/`, of the organization or of
one team of the person; whoever holds it downloads those files, with ranges and cache validators,
until it expires, at most `mosaikit.files.link-max-validity` (7 days unless set) after it is made.
An expired or altered link answers 404, as a file that does not exist. Making a link is audited.

```java
SignedLink report = files.link(EXTENSION, photo.id(), Duration.ofHours(2)); // null: the longest
notify(person, report.path());                  // relative to the root of the kernel

SignedLink tiles = files.linkToPrefix(EXTENSION, "tiles/", team, Duration.ofDays(1)); // team or null
String tile = tiles.file("tiles/3/4/2.png");    // base + encoded name + "?" + query
```

From a frontend, `POST /api/v1/files/<extension>/links` with `{"file": "<id>"}`, or
`{"prefix": "tiles/", "team": "<id>"}`, and an optional `expires`, answers `url` (absolute), `base`
and `query`; a file under a prefix is at `` `${base}${name}?${query}` ``, so a tile template is
`` `${base}tiles/{z}/{x}/{y}.png?${query}` ``. The newest file of a name answers. A link stays valid
until it expires even when the person leaves the team: give the shortest validity that serves.

A link made by a person carries their account and their rights (MK-055): a file attached to a
resource is served only while they hold a level on that resource, so a link to `tiles/` never hands
out the files of an album they cannot read, and revoking their share stops their links to its files;
once they leave the organization their links answer 404. Files without a resource, such as tiles, are
served as the scope of the link says. A link made by code that runs without a person has no creator
and covers its whole scope.

## Extending another extension

An extension extends another one on three levels ([ADR-0019](../adr/0019-plugins-extending-plugins.md)),
as [`sample-estimates`](https://github.com/mosaikit/mosaikit-ext-samples/tree/main/estimates) extends
[`sample-activities`](https://github.com/mosaikit/mosaikit-ext-samples/tree/main/activities):

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

## Composing products and common extensions

A product built on Mosaikit is its branding (a [theme extension](#theme-extensions)), a set of common
extensions and its own extensions; its distribution lists the extensions it installs
([ADR-0041](../adr/0041-common-extensions-composed-by-products.md)). The common extensions, such as
a file catalog, dashboards and processes, are in
[mosaikit/mosaikit-ext](https://github.com/mosaikit/mosaikit-ext), under the MPL-2.0 licence like
Mosaikit, with requirements of their own (`EXT-nnn`, in its `docs/requirements`). The sample
extensions of this guide are in
[mosaikit/mosaikit-ext-samples](https://github.com/mosaikit/mosaikit-ext-samples).

- **Names.** The folder, the Maven artifact and the npm package of an extension are
  `ext-<extension>[-<sub-extension>]...`, such as `ext-catalog` and its connector
  `ext-catalog-connection-postgres`. The manifest id is the reverse-DNS name of the owner followed
  by the same segments: `io.github.mosaikit.ext.catalog.connection.postgres` in mosaikit-ext,
  `org.example.ext.permits` for an extension of a product whose domain is `example.org`.
- **Independence.** An extension works without the others it can use: it hides or explains what
  needs a missing extension, and takes it up again when that extension comes back. Declare a
  required dependency in `requires` only when the extension cannot work at all without the other.

> **Coming with the phase "Composition".** Libraries brought by Java extensions (MK-131), optional
> dependencies and installation that respects dependents (MK-132), knowing whether another
> extension is active (MK-133), versioned contracts between extensions on the server and in the
> frontend (MK-134), and references between resources of different extensions that survive the
> absence of one of them (MK-135). Until then a Java extension brings no libraries, and extensions
> talk through extension points and events as described above.

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
> register their resources, check permissions and share resources, the shell offers the sharing
> dialog for every resource type and opens links without an account, and the REST API of sharing
> is under `/api/v1/sharing`. See
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
  edit everything. The only exception are types of the kernel private to their subjects, such as
  the documents of a team (`data-document`); the types of extensions cannot opt out yet (a later
  change of `kernel-api` may let them). **Platform administrators hold none** in an organization for being platform
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
Links are not considered: for a request opened with a link, ask the Java API (see "Links" below).

`require` throws `AccessDeniedException` (`dev.mosaikit.kernel.api.permission`), which the kernel
answers with 403, or with 404 when the person may not see the resource at all, so that its existence
is not revealed. `grant`, `createLink` and `revoke` act as the person of the request: the owner, the
administrators of the organization and the people with the highest level of the type share, never
above their own level. Remove the entry with `resources.remove(ref)` when the resource is deleted:
its grants go with it. The registration joins the transaction of the request, so a rollback undoes
both.

### Who holds a permission

`Permissions` answers for the person of the request. An extension that translates its permissions
into the rules of another server, such as the roles of a map server, needs everyone who holds one:
it asks `PermissionHolders` (`dev.mosaikit.kernel.api.permission`), naming itself as with
`Permissions`.

```java
@Inject PermissionHolders holders;   // dev.mosaikit.kernel.api.permission

PermissionHolders.Holders editors = holders.of(EXTENSION, "edit-layer");
editors.people();   // the accounts that hold it now: administrators, profile, teams, exceptions
editors.teams();    // the teams and groups granted it; their people are also in people()
editors.holds(account);
```

The rules are those of `Permissions`: the administrators of the organization hold every permission,
a guest holds only what their teams and exceptions grant, and a permission the extension does not
declare, or of an extension whose apps are all off for the organization, is held by nobody. It acts
on the organization of the request, or of the event a subscriber handles; a guest of the organization
reads only the holders among the people of their teams, and a request opened through a link gets
nobody. Name the people with `People` (see [People and teams of the
organization](#people-and-teams-of-the-organization)) and follow the changes with the events of
permissions instead of polling (see [Events on the server](#events-on-the-server)).

Services outside the kernel read the same through the published view
`mk_published.permission_holder` ([published views](published-views.md)).

### The sharing dialog

The kernel offers one sharing dialog for every resource type of every extension (MK-055): who has
access, with the names of people and teams; sharing with a person (by email address), a team, the
whole organization or the public, at the levels the manifest declares for the type; links with an
expiry and an optional password, whose address is shown once; revocation; and who may share. An
extension opens it for one of its resources by publishing `shell.share` on the event bus of its
context; it has no sharing code of its own:

```js
shareButton.addEventListener('click', () => {
  context.events.publish('shell.share', { extension: context.extension.id, type: 'dashboard', id });
});
```

`@mosaikit/sdk` has the same as `openSharing(context, 'dashboard', id)`, and
`sharingLevel(context, 'dashboard', id)` for the level described below.
A frontend isolated in an iframe (MK-014) declares the topic in its bridge,
`frontend.bridge.publishes: [shell.share]`. The dialog shows each level by its `title`, in the
language of the person when `i18n` gives one.

To know the level of the person, for example to hide an Edit button, a frontend asks the kernel
what the dialog shows: `GET /api/v1/sharing/resources/<extension>/<type>/<id>` answers `level` (the
highest level of the person), `canShare`, the levels and the subjects of the type, and `404` when the
person has no level. The Java answer of `sharing.level(ref)` is the same; the backend still checks
with `require` at every request.

### Links

A link opens one resource, at most at the `linkLevel` of its type, until it expires or is revoked,
also for people without an account. Its address is `/shared/<secret>` of the installation: the shell
opens it with `POST /api/v1/sharing/links/open`, asks for the password when the link has one, and
then places the element that the extension contributes to `shared.view` for the type:

```yaml
contributes:
  shared.view:
    - id: dashboard
      type: dashboard            # the resource type it shows; every type of the extension when left out
      element: acme-shared-dashboard
```

The shell loads the frontend module of the extension when it did not (a person without an account
gets a context with an empty `user`, no notifications and no real time), creates the element and
gives it three properties before placing it: `resource` (`{ extension, type, id }`), `level` (the
level of the link) and `request`, a function like `context.fetch` that calls the kernel with the
link (`X-Mosaikit-Link`, and `X-Mosaikit-Link-Password` when it has one) and without the credentials
of the browser. Only frontends that the shell loads as modules show a link: for an isolated one the
page says to sign in.

The element reads the resource from the backend of the extension with `request`. The APIs of
extensions refuse requests without an account, except one that carries a link that works and opens
a resource of that same extension. Such a request has **no organization** at first, so the
row-level security shows it no row of the extension; it acts on the organization of the resource
only once `Sharing` (`level`, `allows` or `require`) answered for that very resource. A route serves
links when it is annotated `@PermitAll` and calls `require` first; every other route, and every
route annotated `@Authenticated`, stays closed to them:

```java
@GET
@Path("{id}")
@PermitAll                                   // also for a link, which Sharing checks
@Transactional
public DashboardView get(@PathParam("id") UUID id) {
    sharing.require(new ResourceRef(EXTENSION, "dashboard", id.toString()), "view");
    return DashboardView.of(dashboards.findById(id).orElseThrow(NotFoundException::new));
}
```

After `require`, read only that resource: the request now sees the rows of its organization. When
the organization turned the apps of the extension off (MK-030), its links open nothing. The fixture
`tests/fixtures/extensions/notes` shows the whole of it with its memos.

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
- A permission granted to a guest also opens the backend of the extension to them (`/api/v1/ext/…`,
  see "Guests" above), where the extension checks what they reach.

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
  `require` and `visible`. Every refused use of a link is in the audit log
  (`sharing.link.used`), and the first use that works in each hour for each link, not every
  request. A request without an account reaches the API of an extension only with a
  link that works and opens a resource of that extension, and acts on the organization of the
  resource only once `Sharing` answered for that very resource (see "Links" above).
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
organization shows to the people who hold its permission `use-<app>` (see the app bar above). So did
the documents of a data collection shared with a team (MK-032): each is a resource of type
`data-document` that the kernel registers and shares with the team (see "Sharing with a team").

## Quotas

Declare in `measures` of the manifest what the extension consumes for each organization, such as
calls to a paid service or the credits of a model (MK-076). A **counter** counts what is used in a
calendar month (UTC) and starts from zero every month; a **gauge** is what the organization keeps
now. In the kernel a measure is `<extension>/<id>`, such as `dev.example.hello/greetings`. Platform
administrators set its limit for an organization (or a default for every organization, with
`mosaikit.quotas.limits."dev.example.hello/greetings"`), and the administrators of the organization
see what it used, by month and person, on their Quotas page. Without a limit everything fits, so an
extension counts its consumption whether or not there is one.

Inject the `Quotas` bean (`dev.mosaikit.kernel.api.quota`) and name the extension in every call, as
with `Resources`:

```java
@Inject Quotas quotas;

public Map render(Request request) {
    long tiles = request.tiles();
    // Counted for the person of the request; refused, counting nothing, when it does not fit.
    quotas.consume("dev.example.maps", "renders", tiles);
    return renderer.render(request);
}
```

- `check(extension, measure, amount)` only reads: whether the amount fits, the `limit`, what is
  `used` and what `remaining()`. Use it to refuse early or to show what is left; `storage` is
  accepted too, to know whether data of a given size would fit.
- `consume(extension, measure, amount)` counts an amount of a counter for the person of the request,
  or for none in a job.
- `set(extension, measure, amount)` sets what the organization keeps now of a gauge.
- `reportSpace(resource, bytes)` sets the space that the extension keeps for one of its registered
  resources (MK-054) outside the files of the kernel: tables, tiles, indexes. It counts to the
  **storage** of the organization with its files, and to the owner of the resource, and goes when the
  resource is removed from the registry. Files stored through the file service of the kernel are
  counted already: do not report them.

`consume`, `set` and `reportSpace` check and count in one step, under a lock of the quota until the
transaction ends: two requests at the same time cannot both pass a limit that only one fits. More
than allowed throws `QuotaExceededException` and changes nothing; let it go out of the REST resource
and the kernel answers `403 Quota exceeded`, a problem detail whose `detail` and member `quota`
(`measure`, `unit`, `period`, `limit`, `used`, `requested`) name the limit. Less space, or a gauge
that goes down, always passes. A measure that the manifest does not declare, or an extension that is
not active, is refused with `IllegalArgumentException`.

## Audit log

Record the sensitive actions of the extension, such as an export, a deletion, a change of settings
or a refused attempt, in the audit log of the organization (MK-059), instead of keeping a log of your
own. Inject `AuditLog` (`dev.mosaikit.kernel.api.audit`) and name the extension in every call, as
with `Notifications.send`:

```java
@Path("/api/v1/ext/dashboards/dashboards")
public class DashboardExport {
    private static final String EXTENSION = "dev.example.dashboards";

    @Inject AuditLog audit;             // dev.mosaikit.kernel.api.audit
    @Inject Sharing sharing;           // dev.mosaikit.kernel.api.sharing
    @Inject DashboardExporter exporter;

    @GET
    @Path("{id}/export")
    public Response export(@PathParam("id") UUID id, @QueryParam("format") String format) {
        sharing.require(new ResourceRef(EXTENSION, "dashboard", id.toString()), "view");
        audit.record(EXTENSION, new AuditLog.Entry(
                "dashboard.exported", "dashboard/" + id, AuditLog.Outcome.SUCCEEDED, Map.of("format", format)));
        return Response.ok(exporter.export(id, format)).build();
    }
}
```

- The kernel adds who (the person of the request, `system` without one), the organization of the
  request, the time and the channel `EXTENSION`; the extension gives the action, its object and
  optional details. A request without an organization is refused with `NoOrganizationException`.
- The action is a stable name, lowercase letters, digits, `.` and `-` (`dashboard.exported`), recorded
  as `<extension>:<action>` (`dev.example.dashboards:dashboard.exported`, at most 100 characters), so
  that the administrators find the entries of the extension with the filter
  `action=dev.example.dashboards:`. The object is at most 255 characters; the details are written as
  JSON, at most 8192 characters. Never put secrets in them, nor personal data the administrators of
  the organization may not read.
- An extension that is not active is refused with `IllegalArgumentException`, like an invalid entry.
- The entry is written in its own transaction: it stays when the transaction of the request rolls
  back, so record a failed or refused attempt with `Outcome.FAILED` or `Outcome.DENIED`. It is chained
  to the entries before it, never changed nor deleted, except by the retention the administrators set
  (see [administration](../guide/administration.md#audit-log)).

## Events on the server

The Java code of an extension can start work when something happens in the platform, without polling
and without a page open (MK-085): prepare what it keeps for an organization when it is created, release
it when the organization turns the extension off, index a file when it is stored. Unlike the real-time
channel to the pages (`LiveEvents`), delivery is durable: an event waits in the database until the
subscriber took it, through failures and restarts.

Subscribe with an `@ApplicationScoped` bean that implements `PlatformEventSubscriber`
(`dev.mosaikit.kernel.api.events`); the kernel finds it at start:

```java
@ApplicationScoped
public class PrepareOrganization implements PlatformEventSubscriber {
    private static final String EXTENSION = "dev.example.notes";

    @Inject Resources resources;          // dev.mosaikit.kernel.api.resource
    @Inject FileStorage files;            // dev.mosaikit.kernel.api.files

    @Override public String extension() { return EXTENSION; }

    @Override public Set<String> types() {
        return Set.of(PlatformEvents.ORGANIZATION_CREATED, PlatformEvents.FILE_STORED);
    }

    @Override public void handle(PlatformEvent event) {
        switch (event.type()) {
            // Registering by a fixed identifier is idempotent: a second delivery changes nothing.
            case PlatformEvents.ORGANIZATION_CREATED -> resources.register(
                    new ResourceRef(EXTENSION, "folder", "inbox"), Resources.Details.of("Inbox", "/app/notes/inbox"));
            case PlatformEvents.FILE_STORED -> {
                if ((EXTENSION + "/folder/inbox").equals(event.text("resource"))) {
                    index(UUID.fromString(event.text("file")));
                }
            }
            default -> { }
        }
    }
}
```

The kernel raises these events (constants of `PlatformEvents`), with their payload:

| Type | When | Payload |
|---|---|---|
| `organization.created` | an organization was created | `slug`, `name` |
| `organization.deleted` | an organization was deleted; reserved: the kernel does not delete organizations yet | `slug` |
| `extension.enabled` | an organization turned an extension on: one of its apps, after all were off (MK-030) | `extension` |
| `extension.disabled` | an organization turned an extension off: all its apps | `extension` |
| `file.stored`, `file.deleted` | a file of any extension was stored or deleted (MK-041) | `extension`, `file`, `name`, `contentType`, `size`, and `team` and `resource` (`<extension>/<type>/<id>`) when it has them |
| `resource.registered`, `resource.removed` | a resource of any extension was registered or removed (MK-054) | `extension`, `type`, `id`; `title` and `owner` when registered |
| `sharing.granted` | a resource of any extension was shared with a subject, or a link to it made (MK-055) | `extension`, `type`, `id` of the resource, `grant`, `subject` (`person`, `group`, `organization`, `public`, `link`), `subjectId` (the account or the team) for a person or a group, `level` |
| `sharing.changed` | the level of a grant changed: the resource was shared again with the same subject | as `sharing.granted`, and `previousLevel` |
| `sharing.revoked` | a grant or a link was revoked; a link that expires raises nothing | as `sharing.granted` |
| `team.member.added` | a person was added to a team or to a group of a team, also its first owner when it was created (MK-032); never for a chat | `team`, `account`, `role` (`owner`, `member`, `guest`), `parent` for a group |
| `team.member.changed` | the role of a person in a team or group changed | as `team.member.added`, and `previousRole` |
| `team.member.removed` | a person left a team or group or was removed, also when the team was deleted | as `team.member.added`, with the role they had |
| `permissions.profile.changed` | a permission profile was created, changed or deleted, or stopped being the default of its role (MK-056) | `profile`, `change` (`created`, `changed`, `deleted`), `defaultForRole` (empty for none), `added` and `removed`, the qualified permissions it gained and lost |
| `permissions.profile.assigned` | a profile was assigned to a member, or taken back for the default of their role | `account`, `profile` (empty for the default) |
| `permissions.team.changed` | a permission was granted to a team or revoked | `team`, `permission` (`<extension>:<permission>`), `granted` (boolean) |
| `permissions.exception.changed` | a personal exception was granted or revoked | `account`, `permission`, `granted` (boolean) |

The events of sharing, teams and permissions let an extension that translates grants, teams and
permissions into the rules of another server, such as a map server, follow every change without
polling: on an event, recompute what changed, such as the people of a team with `People` (see
[People and teams of the organization](#people-and-teams-of-the-organization)) or who holds a
permission with `PermissionHolders` (see [Who holds a permission](#who-holds-a-permission)). They
say what changed, not who holds what now. Some changes reach people without an event of their own: a link that expires, a person added to or
removed from the organization, a change of their roles in it, and the apps of an extension turned
off or on (which raise `extension.disabled` and `extension.enabled`); deleting a team raises
`team.member.removed` for its people, and its grants go with it.

An extension raises its own events with `PlatformEvents`, naming itself as with
`Notifications.send`; the type becomes `<extension>:<name>`, such as `dev.example.notes:note.created`,
which other extensions subscribe to:

```java
@Inject PlatformEvents events;

events.raise(EXTENSION, "note.created", Map.of("note", note.id().toString(), "folder", folder));
```

- **Written with the change.** An event is written in the transaction of the change that raises it,
  in the organization of the request, and delivered only if that transaction commits. The payload is
  JSON, at most 8192 characters: say what happened, such as identifiers, and let the subscriber read
  the rest. Never put secrets in it. The name is lowercase letters, digits, `.` and `-`; an extension
  that is not active, or a name or payload not valid, is refused with `IllegalArgumentException`.
- **In the organization where it happened.** The handler runs in a transaction of its own, in the
  organization of the event and without a person (MK-126): `CurrentOrganization` is that
  organization, row-level security shows its data only, and the beans of the kernel act in it. What
  the handler stores or registers belongs to the organization, not to a person, and the audit log
  records the extension as actor with the channel `JOB`. An organization that turned the extension
  off sends it no event, except `extension.disabled` and `extension.enabled` about the extension
  itself, so that it releases and prepares what it keeps.
- **At least once.** When `handle` throws, its transaction rolls back and the kernel gives the event
  again later, waiting twice as long each time (`mosaikit.events.retry-delay`), up to
  `mosaikit.events.max-attempts`; then it gives up and records `events.delivery.failed` in the audit log
  of the organization. An event raised while the kernel is stopped, or while the subscriber fails, is
  delivered when it is back; `PlatformEvent.attempt()` says which attempt this is.
- **Make handlers idempotent.** An event may arrive twice: the kernel stopped after the handler
  committed and before it marked the event delivered, or a handler took longer than five minutes and
  another kernel took the event again. Register and store by fixed identifiers, check whether the work
  is already done, or keep the handled `PlatformEvent.id()` in a table of the extension in the same
  transaction as the work. Events come roughly in the order they were raised, not strictly when some
  were retried: do not rely on their order.
- **From installation on.** A subscriber receives the events raised after it was installed, not the
  earlier ones. Keep `name()` (`default` unless the extension has several subscribers) stable across
  versions: the kernel keeps what it delivered to each subscriber by that name.
- Each kernel looks for events every `mosaikit.events.poll-interval` (two seconds by default): a
  handler runs a few seconds after the change, not during the request.

## External services from the browser

The content security policy of the shell lets the browser contact the installation only. A
frontend that reads an external service directly, such as tiles of a map server or the data of an
open API that allows cross-origin calls, works only for the origins that the platform administrators
list in **External origins** (MK-128): they are added to `connect-src` and `img-src`, never to
scripts, styles or frames, and the service must answer the CORS request of the browser. Name in the
documentation of the extension the origins it contacts; anything else goes through the backend of
the extension.

## Credentials of external services

An extension that calls an external service, such as a model provider, a mail server or a
database, does not keep its key in a document, a setting or the code: the administrators of the
organization store it in **Credentials**, encrypted by the kernel (MK-062, see
[administration](../guide/administration.md#credentials-of-extensions)), and the backend reads it
by name with the `Secrets` bean of `kernel-api`, on the server, at the moment of the call:

```java
@Inject
Secrets secrets;

String summarize(String text) {
    try (SecretValue key = secrets.require("org.example.reports", "model-provider")) {
        return client.post(text, "Bearer " + key.reveal());
    }
}
```

- The extension names itself in every call, as with `Notifications.send`; the kernel refuses a name
  that is not an active extension with `IllegalArgumentException`.
- It reads the credentials of the organization of the request only. A credential that the
  administrators meant for one extension is read by that extension only; one meant for none, by
  every extension of the organization. `find` answers empty, and `require` throws
  `NoSuchElementException` naming the credential, when there is none it may read.
- `SecretValue` never shows the value in `toString`. Take it with `chars()`, `bytes()` or, for APIs
  that take only strings, `reveal()`, where the call needs it, and close it when done. Never return
  it to the browser, write it into a document or put it in a log or an error message.
- `SecretsUnavailableException` (answered with 503) means that the installation has no master key,
  or that the credential does not decrypt with its keys. Catching it leaves the transaction of the
  request usable (see [Transactions](#transactions-and-the-beans-of-the-kernel)): an extension can go
  on without the credential, such as on an installation without a master key.
- Every read is in the audit log of the organization (`secrets.read`, channel `EXTENSION`), with the
  name of the credential and the extension, never the value.
- Tell the administrators in the documentation of the extension which names it reads, and of which
  kind.

### Credentials of the installation

Some credentials belong to no organization: the account of a server shared by the whole
installation, a mail relay, a licence key. Platform administrators keep them in **Installation
credentials** (MK-127). `resolve` reads the most specific credential with a name: the one of the
organization of the request when the extension may read it, otherwise the one of the installation;
outside any organization, such as in a scheduled job or a request without one, the one of the
installation only. `find` and `require` keep to the organization, as before.

```java
Optional<SecretValue> relay = secrets.resolve("org.example.reports", "mail-relay");
```

The same rules apply: a credential of the installation meant for one extension is read by that
extension only, values stay on the server, and every read is audited, a credential of the
installation in the audit log of the platform (`secrets.read`, with `scope` `installation` and the
organization of the request, if any). An organization that stores a credential with the same name
replaces the one of the installation for itself: document which names may be set at either level.

## Rules

- Import only `kernel-api`, the Jakarta APIs and the extensions provided by the kernel (Java) and
  `@mosaikit/sdk` (frontend), plus the SPI modules of the extensions you declare in `requires`. Never
  import the kernel itself (`mosaikit-kernel`).
- Talk to other extensions through the event bus and declared services, never by importing them.
- Keep one database schema per extension, forward-only migrations, no foreign keys to other schemas.
