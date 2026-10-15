# Contracts between extensions

An extension that others extend publishes **contracts**: on the server, Java interfaces that other
extensions implement; in the frontend, extension points whose contributions have a typed payload
(MK-134). The contract belongs to the extension that defines it, never to the kernel, and is
versioned: a breaking change publishes a new version next to the old one, and the owner serves both
until it retires the old one. A catalog and its connectors, or a dashboard and its widgets, work this
way.

**On the server.** The owner puts the interfaces in a small API artifact of its own (a Maven module
such as `org.example:catalog-api`, with semantic versions and nothing but the interfaces and their
records), which every extension of the contract depends on. Each interface is one major version of
the contract, marked with `@Contract` and extending `ContractImplementation` of `kernel-api`:

```java
@Contract(extension = "org.example.catalog", name = "connector", version = 1)
public interface Connector extends ContractImplementation {
    List<Item> items(String connection);
}
```

A connector implements it in a CDI bean that names its extension, and the catalog asks the kernel for
the implementations each time it needs them:

```java
@ApplicationScoped
public class FilesConnector implements Connector {
    public String extension() { return "org.example.catalog.connector.files"; }
    public List<Item> items(String connection) { ... }
}

@Inject Contracts contracts;
List<Connector> connectors = contracts.implementations(Connector.class);
```

`implementations` gives the beans of the extensions active in the organization of the request (or
of the job), whose manifest declares that version of the contract, sorted by extension: a connector
installed, removed, or turned off by the organization is found, or no longer found, without a change
to the catalog. Both extensions declare their side in the manifest, naming the API artifact among
their `libraries`:

```yaml
# the catalog
contracts:
  provides:
    - name: connector              # [a-z][a-z0-9-]*
      versions: [1, 2]             # the major versions served; remove one to retire it
      api: org.example:catalog-api # groupId:artifactId of one of the libraries
# a connector
contracts:
  implements:
    - contract: org.example.catalog/connector
      version: 1                   # the version it targets
      api: org.example:catalog-api
```

The marketplace refuses a connector that implements a version the installed catalog does not serve,
with the reason (`… implements org.example.catalog/connector version 3, which org.example.catalog
2.0.0 does not serve (it serves version 1, 2)`). A connector installed without its catalog is
accepted: it is used when the catalog comes.

The API artifact is a library ([Libraries of an extension](libraries.md#libraries-of-an-extension)) with one
difference: the kernel loads it once even when several extensions bring it, and versions with the
same major version are compatible, so it loads the highest one (a catalog with `catalog-api` 1.2.0
and a connector with 1.4.0 run on 1.4.0). Another major version conflicts as a library does. So the
API artifact keeps its major version while the contract adds versions: a breaking change is a new
interface, such as `org.example.catalog.api.v2.Connector` with `version = 2`, next to the old one, in
a minor release of the artifact; the major version of the artifact changes only when an old
interface is retired, and the extensions that bring it are then updated together.

**In the frontend.** An extension point declares, for each major version, the JSON Schema of the
payload of its contributions, with the keywords of the input of [actions](assistants.md#actions-for-assistants);
a point written as a plain name is version 1 without a schema, as before:

```yaml
frontend:
  entry: web/index.js
  points:
    - dashboard.widget             # version 1, untyped
    - name: dashboard.widget
      version: 2
      schema:                      # the attributes of a contribution, without id and i18n
        type: object
        required: [element, size]
        additionalProperties: false
        properties:
          element: {type: string}
          size: {type: string, enum: [small, large]}
          title: {type: string}
```

A contribution names the version it targets after `@`, without it for version 1:

```yaml
contributes:
  dashboard.widget@2:
    - id: weather
      element: weather-card
      size: large
```

A contribution that does not match the schema of its point is refused at installation with the
reason (`the contribution weather of org.example.weather 1.0.0 to dashboard.widget@2 does not match
the schema of org.example.dashboard 2.1.0: weather.size must be one of [small, large]`); so is an
update of the owner whose schema the installed contributions no longer match, unless they are updated
in the same operation. One that reached the installation otherwise, such as a copy into
`extensions/`, is never given to the owner. The owner reads the contributions of each version,
typed, with `typedContributions` of `@mosaikit/sdk`:

```ts
import { typedContributions } from '@mosaikit/sdk';

interface WidgetV2 { readonly element: string; readonly size: 'small' | 'large'; readonly title?: string }
const widgets = typedContributions<WidgetV2>(context, 'dashboard.widget', 2);
```

`context.contributionsTo('dashboard.widget@2')` gives the same contributions untyped; `pointId(name,
version)` writes the identifier of a version.
