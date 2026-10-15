# Extensions without a backend

Most apps keep simple records of an organization. Such an extension needs no Java code and no schema
([ADR-0031](../../adr/0031-frontend-plugins-on-the-data-api.md)): it declares collections in
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

## Sharing with a team

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

## Guests

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

## People and teams of the organization

`Teams` answers what the person of the request sees. An extension that names people and teams
outside the kernel, such as in the rules of a map server, needs them for the whole organization,
also in a subscriber of events where there is no person: it reads them through `People`
(`dev.mosaikit.kernel.api.teams`), read-only, without a database login of its own (the published
views of [MK-123](../published-views.md) are for services outside the kernel).

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
