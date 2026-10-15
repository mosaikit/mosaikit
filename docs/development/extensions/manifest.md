# Manifest

```yaml
id: dev.example.hello          # reverse-DNS, stable forever
version: 1.0.0                 # semantic version
name: Hello
kind: [app]                    # app, extension, service, theme, locale, auth
platform: ">=0.1 <1"           # kernel versions the extension runs on
requires:                      # extensions it cannot work without, with accepted versions (MK-132)
  dev.example.base: "^2"
optional:                      # extensions it uses when they are there, never needed (MK-132)
  dev.example.maps: ">=3 <5"
frontend:
  entry: web/index.js
  isolation: module            # module, or iframe to always run isolated (MK-014)
  points: [hello.panel]        # extension points that other extensions contribute to (MK-020),
                               # in versions with a schema (MK-134, see Contracts between extensions)
  bridge:                      # what the frontend may do when it runs isolated
    publishes: [hello.greeted]
    subscribes: [maps.*]
    services: [api]            # api: its own backend API; data: its collections
data:                          # JSON documents kept by the kernel, without a backend (MK-046)
  collections: [greetings]     # [a-z][a-z0-9-]*, unique in the extension
backend:
  jar: lib/hello.jar           # Java code, loaded by the launcher at the next start
  api: hello                   # REST resources under /api/v1/ext/hello/
libraries:                     # written by mvn package from the runtime dependencies (MK-131)
  - jar: 'lib/commons-text-1.15.0.jar'
    coordinates: 'org.apache.commons:commons-text:1.15.0'
    sha256: '58d2da30f058512a1e7f914e39241deca4dff5c27a085b4ed2faa9e7208067f6'
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
