# Favorites

People mark resources of any extension as favorite and find them in one list, **Favorites** in the
app bar of the shell (MK-094). A favorite is a resource that your extension registered with the
kernel ([Resources, sharing and permissions](resources-and-sharing.md#resources-sharing-and-permissions)):
the list shows its title and opens its `link`, so register a link that opens the resource in your
app, such as `/app/notes?memo=<id>`, and read the query when the app opens. Keep title and link up
to date with `Resources.register`: the list always shows the current ones.

Offer the mark where the person sees the resource, such as a star next to its title, with the
functions of `@mosaikit/sdk`, which act on a resource of your extension for the signed-in person:

```ts
import { isFavorite, markFavorite, unmarkFavorite } from '@mosaikit/sdk';

const marked = await isFavorite(context, 'memo', memo.id);
star.setAttribute('aria-pressed', String(marked));
star.addEventListener('click', () =>
  marked ? unmarkFavorite(context, 'memo', memo.id) : markFavorite(context, 'memo', memo.id),
);
```

- `markFavorite` marks only a resource the person may open now: one registered, of an extension
  active in the organization, on which they have a level (MK-055); otherwise it fails with 404.
  Marking again changes nothing. A person has at most 500 favorites in an organization.
- `listFavorites(context)` gives the favorites of every extension, the last marked first, each with
  `status` `available` (with `link`) or `extension-absent`.
- A favorite the person may no longer read, because it was deleted or the access was removed,
  leaves the list; it comes back if the access is given again. One whose extension is absent stays,
  with the title it had, as the placeholder of [references](references.md) (MK-135), and opens again
  when the extension comes back. Nothing is deleted because an extension is absent.

The REST API is `GET /api/v1/favorites` and `GET`, `PUT`, `DELETE
/api/v1/favorites/{extension}/{type}/{id}`. A frontend isolated in a frame calls only its own
backend API, so it cannot mark favorites.
