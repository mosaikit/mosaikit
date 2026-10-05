# Plugin development

## Quick start

`create-mosaikit-plugin` (MK-023, in `sdk/create-plugin`) writes a working plugin, so that you
start from code that the kernel accepts:

```bash
npx @mosaikit/create-plugin dev.acme.traffic --name "Traffic"            # frontend only
npx @mosaikit/create-plugin dev.acme.traffic --name "Traffic" --backend  # with Java, schema and actions
cd traffic && mvn package                                                 # target/traffic-0.1.0.zip
```

From this repository, `node sdk/create-plugin/dist/bin.js` does the same after `npm run build`.
The generated plugin has an app at `/app/traffic`; with `--backend`, a table under row-level
security, a REST API under `/api/v1/p/traffic`, and two actions for assistants. Copy the zip (or
the directory) into `plugins/` of an installation and start it with the launcher. The rest of this
guide explains what each part does.

## Anatomy

```
my-plugin/
├── manifest.yaml     # the contract (JSON Schema in sdk/java)
├── web/index.js      # ES module exporting the plugin frontend (optional)
├── lib/my-plugin.jar # Java code, built from the sources of the plugin (optional)
└── db/               # Flyway migrations of the plugin schema p_<name> (optional)
```

## Manifest

```yaml
id: dev.example.hello          # reverse-DNS, stable forever
version: 1.0.0                 # semantic version
name: Hello
kind: [app]                    # app, extension, service, theme, locale, auth
platform: ">=0.1 <1"           # kernel versions the plugin runs on
requires:                      # other plugins, with accepted versions
  dev.example.base: "^2"
frontend:
  entry: web/index.js
  isolation: module            # module, or iframe to always run isolated (MK-014)
  points: [hello.panel]        # extension points that other plugins contribute to (MK-020)
  bridge:                      # what the frontend may do when it runs isolated
    publishes: [hello.greeted]
    subscribes: [maps.*]
    services: [api]            # api: its own backend API; data: its collections
data:                          # JSON documents kept by the kernel, without a backend (MK-046)
  collections: [greetings]     # [a-z][a-z0-9-]*, unique in the plugin
backend:
  jar: lib/hello.jar           # Java code, loaded by the launcher at the next start
  api: hello                   # REST resources under /api/v1/p/hello/
actions:                       # tools for assistants and MCP clients (MK-015)
  - name: greet                # [a-z][a-z0-9-]*, unique in the plugin
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
      path: greetings/{name}   # relative to /api/v1/p/hello/; {name} comes from the input
database:
  schema: p_hello              # owned by the plugin; migrations in db/ (default)
contributes:
  rail.app:                    # the app bar of the shell (MK-025)
    - id: hello
      title: Hello
      route: /app/hello        # /app/<name>
      element: example-hello   # custom element rendered for the route
      icon: web/icon.svg       # 24 × 24 SVG or PNG of the plugin; a tile with the initials otherwise
      order: 50                # position in the app bar, smaller first; 100 by default
```

The administrators of each organization decide which apps appear, in which order and for whom
(MK-030); when they turn off all the apps of a plugin, the kernel refuses its API
(`/api/v1/p/<api>/…`) and its documents (`/api/v1/data/<plugin id>/…`) to that organization with
403, so the plugin needs no check of its own.

`launcher.app`, the point of the first versions, is still shown in the app bar during the 0.x
versions, with a warning in the status of the plugin (`warnings` in `GET /api/v1/plugins`): rename
it to `rail.app`.

## Frontend contract

The module's default export implements `MosaikitPlugin` from `@mosaikit/sdk`:

```ts
import { definePlugin } from '@mosaikit/sdk';

export default definePlugin({
  activate(context) {
    customElements.define('example-hello', class extends HTMLElement { /* ... */ });
    context.events.on('maps.selection.changed', (payload) => { /* ... */ });
  },
});
```

Any framework that produces custom elements can be used. Use the shell's CSS custom properties
(`--mk-surface`, `--mk-fg`, `--mk-accent`, …) so that the plugin follows the theme.

### Real time

The shell keeps one WebSocket to the kernel (MK-031). A frontend reacts to the changes of its
collections, made by anyone of the organization, and to the events of its backend:

```js
const items = context.data('items');
const stop = items.onChange(({ id, action }) => refresh()); // created, replaced, deleted
context.live.subscribe('plugin.dev.example.hello.greeted', (data) => show(data));
```

A Java backend publishes with `LiveEvents` of `kernel-api`; the event leaves when the transaction
commits, and reaches the pages subscribed to the topic in the same organization:

```java
@Inject LiveEvents live;
live.publish("plugin.dev.example.hello.greeted", Map.of("id", greeting.id()));
```

Topics are `documents.<plugin id>.<collection>`, `plugin.<plugin id>.<name>` and `notifications`;
the kernel refuses the others, and those of plugins that the organization turned off. Send what
changed, not the data: pages read it again with the rights of each person.

### Notifications

A plugin notifies people of the organization in their activity feed (MK-038): a frontend with
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

A plugin adds a section to the personal settings with the point `settings.section`; `roles`, when
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

### Theme plugins

A plugin of kind `theme` brings the colors of a brand, and nothing else; it is active as soon as it
is installed, people choose it in their settings, and an installation can make it its default
(`mosaikit.ui.theme=<plugin id>`):

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
```

Every color, font or radius it leaves out comes from the default theme. Choose colors with enough
contrast (WCAG 2.1 AA: 4.5:1 for text): the high contrast appearance stays available to everyone.
[`sample-theme`](../../plugins/sample-theme) is a complete example.

### Components and themes

The shell defines the Fluent UI web components for the page
([ADR-0032](../adr/0032-fluent-ui-and-themes.md)): a plugin that runs as a module can use
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
that module as `frontend.entry`, as [`sample-react`](../../plugins/sample-react) and
[`sample-vue`](../../plugins/sample-vue) do. Render inside the shadow root of your custom element,
unmount in `disconnectedCallback`, style with the `--mk-*` tokens and talk to other plugins only
through `context.events` and extension points.

### Isolated frontends

A frontend runs isolated in a sandboxed iframe (MK-014,
[ADR-0015](../adr/0015-isolated-plugin-frontends.md)) when its manifest says
`isolation: iframe`, or when its publisher is not verified (an unsigned package, a key the
installation does not trust, a plugin directory) and the installation isolates such plugins
(`mosaikit.plugins.unverified-frontends=iframe`, the default). The same module works in both
modes, as long as it uses only its `context`:

| In the context | Isolated |
|---|---|
| `events.publish(topic)` | only topics of `bridge.publishes` reach the shell |
| `events.on(pattern)` | only patterns covered by `bridge.subscribes` receive events |
| `fetch(path, init)` | only the backend API of the plugin (`/api/v1/p/<api>/…`, or a path relative to it), text bodies, with `bridge.services: [api]` |
| `data(collection)` | only the collections of the plugin, with `bridge.services: [data]` |
| `user`, `plugin`, `contributions`, `locale` | as usual |

In the iframe the plugin has no access to the page of the shell, to its storage or to the
credentials of the person, and it can load code and data only from the kernel. Declare the bridge
even if you plan to run as a module: installations that isolate unverified plugins use it.

## Java code

[`plugins/sample-notes`](../../plugins/sample-notes) is a complete example: an entity, a Jakarta
Data repository and a REST resource, with the migration of its schema.

- Build the plugin as a Maven module whose dependencies all have scope `provided`: `mosaikit-kernel-api` (sdk/java),
  the Jakarta APIs and the Quarkus extensions the kernel already contains (REST, Hibernate ORM,
  Hibernate Validator, security). The JAR contains only the plugin's classes. A plugin cannot
  bring new Quarkus extensions.
- Generate the Jakarta Data repositories with the `quarkus-data-processor` annotation processor
  and index the JAR with the Jandex plugin, as the sample does.
- Put REST resources under `/api/v1/p/<api>/`, with the API name declared in `backend.api`. The
  kernel requires authentication for every path there, whatever the resource declares, and
  serves it only while the plugin is active.
- Map entities to the plugin schema: `@Table(name = "note", schema = "p_sample_notes")`.

Package it as one zip with only what the kernel needs, as the samples do with the shared
descriptor `plugins/plugin-package.xml`: `manifest.yaml`, `lib/`, `db/`, `web/`, no sources. To
install it, copy the zip into `plugins/` of an installation as it is and restart it with the
`mosaikit` launcher. The launcher sees the new JAR, rebuilds the
kernel in a few seconds and starts it; the kernel then migrates the plugin schema. Updating or
removing the plugin works the same way. The status of each plugin is at `GET /api/v1/plugins`:
`RESTART_REQUIRED` means that its JAR changed and the kernel was not started through the launcher.

If the kernel cannot be rebuilt or started with a new or updated plugin, the launcher restores
the previous build and starts it again; the plugin shows `INVALID` with the reason "Rolled back"
until a different version of its JAR is installed. See the output of the launcher for the
cause.

In a container image, add Java plugins by building a derived image, so that the rebuild happens
once, at image build time:

```dockerfile
FROM ghcr.io/mosaikit/mosaikit:0.2.0
COPY --chown=185 my-plugin-1.0.0.zip /opt/mosaikit/plugins/
RUN /opt/mosaikit/mosaikit build
```

## Signing a package

Installations can refuse packages that are not signed by a publisher they trust (MK-013,
[ADR-0014](../adr/0014-signed-plugin-packages.md)). Sign every package you publish with the tool in
the JAR of the Java plugin API:

```bash
API=mosaikit-kernel-api-0.1.0.jar
TOOL=dev.mosaikit.kernel.api.signature.PackageSigningTool
java -cp $API $TOOL keygen ~/keys acme            # once: acme.pub.pem and acme.key.pem (secret)
java -cp $API $TOOL sign ~/keys/acme target/my-plugin-1.0.0.zip
java -cp $API $TOOL verify ~/keys target/my-plugin-1.0.0.zip
```

Give `acme.pub.pem` to the administrators: they copy it into `config/trusted-keys` of their
installation. Signing again replaces the signature; changing any file afterwards makes the package
refused. A registry can store the signed zip as an OCI artifact as it is:

```bash
oras push registry.example.org/plugins/my-plugin:1.0.0 \
  my-plugin-1.0.0.zip:application/vnd.mosaikit.plugin.v1+zip
oras pull registry.example.org/plugins/my-plugin:1.0.0 -o plugins/
```

## Plugins without a backend

Most apps keep simple records of an organization. Such a plugin needs no Java code and no schema
([ADR-0031](../adr/0031-frontend-plugins-on-the-data-api.md)): it declares collections in
`data.collections`, and the kernel keeps their JSON documents for each organization, under
row-level security, at `/api/v1/data/<plugin id>/<collection>`. The frontend uses them through its
context:

```js
const items = context.data('items');
const created = await items.create({ title: 'Paint the fence', done: false });
await items.update(created.id, { ...created.data, done: true }, created.version); // 409 if changed since
const all = await items.list({ limit: 50 });                                     // newest first
await items.remove(created.id);
```

A document is a JSON object of at most 256 KiB, and a collection holds at most 10,000 of them.
Errors are `DataError`s with the HTTP status and the detail of the kernel. Such a plugin is active
as soon as it is installed: the marketplace answers `restartRequired: false` and the shell shows
the app without a reload. [`sample-todo`](../../plugins/sample-todo) is a complete example, and
`create-mosaikit-plugin` without `--backend` writes one. When an app needs queries beyond listing
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

Every request to a plugin API acts on one organization of the signed-in person (MK-017,
[ADR-0016](../adr/0016-membership-of-several-organizations.md)). Store the organization with
every row and filter on it, so that data of other organizations are never visible:

```java
@Path("/api/v1/p/notes/notes")
public class NoteResource {
    @Inject CurrentOrganization organization;   // dev.mosaikit.kernel.api.context

    @GET
    public List<NoteView> list() {
        return notes.findByOrganization(organization.require()).stream().map(NoteView::of).toList();
    }
}
```

`require()` answers `403` when a request has no organization; the kernel already refuses such
requests to plugin APIs.

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

Do not reference the tables of the kernel nor of other plugins: extend the data of another
plugin with a table of your own keyed by its identifiers, and read it through the views that
plugin publishes as its data contract.

## Extending another plugin

A plugin extends another one on three levels ([ADR-0019](../adr/0019-plugins-extending-plugins.md)),
as [`sample-estimates`](../../plugins/sample-estimates) extends
[`sample-activities`](../../plugins/sample-activities):

1. **Require it**, so that the kernel migrates it first and refuses yours without it:
   `requires: { dev.mosaikit.sample.activities: '^0.1' }`.
2. **Data**: keep your field in a table of your schema keyed by its identifiers, without a foreign
   key, and read its data only through the views it publishes (`p_sample_activities.activity_v1`),
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
   and creates the elements. The contributions of a plugin turned off for the organization are
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

An action is a call to the backend API of the plugin that an assistant may make on behalf of the
signed-in person (ADR-0017). The kernel checks the arguments against `input`, puts the arguments
named in `path` there, and sends the others as the query (`GET`, `DELETE`) or the JSON body. The
call carries the credentials of the person and the organization of the request, so the usual
`@RolesAllowed` checks and `CurrentOrganization` apply: an action never needs code of its own.
Choose the risk honestly: `read` for calls without effects, `write` for changes of data, `execute`
for processes, messages or anything that leaves the installation. Describe the action for a person
who has to confirm it, not for the assistant only.

## Rules

- Import only `kernel-api`, the Jakarta APIs and the extensions provided by the kernel (Java) and
  `@mosaikit/sdk` (frontend), plus the SPI modules of the plugins you declare in `requires`. Never
  import the kernel itself (`mosaikit-kernel`).
- Talk to other plugins through the event bus and declared services, never by importing them.
- Keep one database schema per plugin, forward-only migrations, no foreign keys to other schemas.
