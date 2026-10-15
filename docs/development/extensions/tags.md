# Tags

People label the resources of any extension with their own words and filter lists by those labels
(MK-097). The kernel keeps the tags next to the entry of a resource in the registry ([Resources,
sharing and permissions](resources-and-sharing.md#resources-sharing-and-permissions)), so every
extension shows the same tags and the same suggestions; an extension keeps none of its own. A resource
is tagged once it is registered, and its tags go with it when it is removed.

**Form.** A tag is stored trimmed, with one space between words, in lowercase: `Spring  Plans` is
kept as `spring plans`. A resource has each tag once and at most 20 tags; a tag has 1 to 48
characters, without commas or control characters.

**Who sees them.** A person sees the tags of a resource only when they have a level on it, and
changes them when they hold a level that edits (or the highest level of a type without one). The
suggestions come only from the resources the person may read, so a tag never reveals a resource.

## In the frontend

`@mosaikit/sdk` calls the REST API of the kernel for the signed-in person:

```ts
import { replaceTags, resourceTags, suggestTags, taggedResources } from '@mosaikit/sdk';

const tags = await resourceTags(context, 'dashboard', dashboard.id);           // ['garden', 'roses']
await replaceTags(context, 'dashboard', dashboard.id, [...tags, typed]);         // kept lowercase, once
const suggestions = await suggestTags(context, typed);                           // most used first
const ids = await taggedResources(context, 'dashboard', ['garden', 'roses']);    // carry any of them
```

| Call | REST API |
|---|---|
| `resourceTags(context, type, id)` | `GET /api/v1/resources/tags/{extension}/{type}/{id}`; 404 without a level |
| `replaceTags(context, type, id, tags)` | `PUT` on the same path with the list; 403 with a level that does not edit |
| `suggestTags(context, prefix, limit)` | `GET /api/v1/resources/tags/suggestions?prefix=&limit=` (up to 50) |
| `taggedResources(context, type, tags)` | `GET /api/v1/resources/tags/{extension}/{type}?tag=a&tag=b` |

`normalizeTag(tag)` shows a tag as the kernel will keep it while the person types.

## On the server

Inject `Tags` (`dev.mosaikit.kernel.api.resource`) and name your extension in the reference, as with
`Resources`. Only a type your manifest declares in `resources` is accepted, and only a registered
resource has tags:

```java
@Inject Tags tags;

ResourceRef ref = new ResourceRef("org.example.ext.dashboards", "dashboard", id);
tags.attach(ref, List.of("Garden"));            // keeps the others: [garden, roses]
tags.replace(ref, List.of("roses", "Trees"));   // [roses, trees]
List<String> held = tags.of(ref);
Set<String> ids = tags.tagged("org.example.ext.dashboards", "dashboard", List.of("garden", "roses"));
```

`of`, `attach`, `replace` and `tagged` serve the extension and do not check sharing: answer a person
only about what `Sharing` lets them read, for example by intersecting `tagged` with
`Sharing.visible`. `suggest(prefix, limit)` draws only from the resources the request may read.
A tag that is not valid, or more than 20 on a resource, is refused with `IllegalArgumentException`
before anything is written; a resource that is not registered with `NoSuchElementException`.
