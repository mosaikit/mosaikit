# References to resources of other extensions

A resource of one extension may refer to a resource of another, such as a dashboard widget that
shows a map (MK-135). The referring extension keeps, in its own data, the reference by which the
other extension registered the resource ([Resources, sharing and
permissions](resources-and-sharing.md#resources-sharing-and-permissions)): its extension, type and id. The kernel resolves it,
for the signed-in person, to the resource or to why it is not available:

| Status | Meaning |
|---|---|
| `available` | the person may read it: `title` and `link` come with it |
| `extension-absent` | its extension is not installed, cannot run, or is turned off in the organization |
| `deleted` | its extension no longer registers it |
| `forbidden` | it exists, but the person has no level on it; nothing more is told |

To administrators, `extension-absent` comes with `missing`: the extension, its name when it is
installed, and what brings it back, `install`, `restart`, `repair` (installed but not able to run)
or `turn-on` (its apps are off in the organization).

**Keep the reference as it is** while it is not available: never delete it nor change it because
the other extension is absent, since an administrator may turn it on again tomorrow. The kernel does
the same: turning an extension off changes neither the references nor the resources, and the
reference resolves again as soon as the extension comes back. Show a placeholder in its place, and
keep the rest of the resource working.

In the frontend, `watchReferences` of `@mosaikit/sdk` resolves references and resolves them again
each time the extension of one of them comes or goes (MK-133), so an open page shows the resource
again without a reload; `<mk-reference-placeholder>` shows an absence the same way in every
extension, in English or Italian, with what is missing (`label`, in your words) and, to
administrators, which extension to install or turn on. The shell defines the element for frontends
loaded as modules; one isolated in a frame calls `defineReferencePlaceholder()` first.

```ts
import { watchReferences, type ReferencePlaceholderElement } from '@mosaikit/sdk';

const map = { extension: 'org.example.ext.maps', type: 'map', id: widget.mapId };
const placeholder = document.createElement('mk-reference-placeholder') as ReferencePlaceholderElement;
placeholder.setAttribute('label', 'Map of the widget');
placeholder.setAttribute('locale', context.locale);
const stop = watchReferences(context, [map], ([resolved]) => {
  placeholder.reference = resolved; // shows nothing while the map is available
  showMap(resolved?.status === 'available' ? resolved : undefined);
});
```

`resolveReferences(context, refs)` resolves once, up to 100 references in the order given
(`POST /api/v1/resources/references/resolve`), and `referencePlaceholderText` gives the texts of the
placeholder for a component of your own. On the server, inject `ResourceReferences`
(`dev.mosaikit.kernel.api.resource`), naming your extension:

```java
@Inject ResourceReferences references;

ResolvedReference map = references.resolve("org.example.ext.dashboards", widget.map());
if (map.isAvailable()) {
    // map.resource().title(), map.resource().link()
} else {
    // map.availability(): EXTENSION_ABSENT, DELETED or FORBIDDEN; keep widget.map() as it is
}
```

Uninstalling an extension, unlike turning it off, removes its entries from the registry at the next
start, with their grants (MK-054); the references of the other extensions stay, and resolve again
once the extension, installed again, registers its resources again.
