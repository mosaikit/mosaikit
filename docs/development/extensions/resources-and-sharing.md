# Resources, sharing and permissions

> **Registry, permissions and sharing implemented.** The kernel provides the `Resources` bean
> (MK-054), the `Permissions` bean (MK-056) and the `Sharing` bean (MK-055): Java extensions
> register their resources, check permissions and share resources, the shell offers the sharing
> dialog for every resource type and opens links without an account, and the REST API of sharing
> is under `/api/v1/sharing`. See
> [ADR-0037](../../adr/0037-resources-and-one-sharing-model.md) and
> [ADR-0038](../../adr/0038-permissions-from-manifests-and-profiles.md). The counterpart in
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
  - type: file
    title: File
    levels: [{ name: view, title: View }, { name: edit, title: Edit, edits: true }]
    inherits: parent           # a level on the parent reaches the file (MK-136); left out: it does not
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
- **Inheritance from the parent, when the type declares it** (MK-136). A type with
  `inherits: parent` gets the levels of the resource registered as its `parent`
  (`Resources.Details`): the level of a person on a resource is the highest of their own and of
  their level on each resource above it, as long as each resource on the way has a type that
  inherits too (a folder of folders declares it on the folder type as well). A level held above
  counts as the highest level of this type **of the same name** that it includes, so `manage` on a
  folder is `manage` on a file with the same levels; name the levels of the types of a tree alike.
  The owner of a folder holds its highest level on everything inside, and so does a link to a
  folder (at most its `linkLevel`). Every answer of the kernel uses it: `Sharing`, `mk_kernel.allows`,
  the sharing dialog, the file service and the signed links that a person makes. For a type without
  `inherits`, a grant on a parent does not pass to its children.
- **Owner.** A resource registered in a request with a signed-in person is owned by that person; one
  registered without a person (a job, an import, a migration of existing data) is owned by the
  **organization**, has no owner in `Resource`, and its administrators manage it.
- **Who shares**: the owner, the people with the highest level of the type (also through a resource
  above, for a type that inherits) and the administrators of the organization, never above their own
  level.
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
organization unless they are a guest, or to the public, which counts as the lowest level), also on a
resource above it for a type that inherits: the function follows the parents in the database, so a
list of files in folders is still filtered and paged by one query. An undeclared level, a type of no
active extension or a resource that is not registered give `false`. Links are not considered: for a
request opened with a link, ask the Java API (see "Links" below).

For a tree of resources (MK-136), the extension registers each resource with its `parent` and
declares `inherits: parent` on the types inside: it then asks `Sharing` and `mk_kernel.allows` as for
any type and gets the inherited levels, with no code of its own to walk the folders. To show where
an access comes from, `sharing.inheritedGrants(ref)` lists the grants of the resources above that
reach a resource, from its parent upwards; each `Grant.resource()` names the resource above that
carries it, at a level of its type.

`require` throws `AccessDeniedException` (`dev.mosaikit.kernel.api.permission`), which the kernel
answers with 403, or with 404 when the person may not see the resource at all, so that its existence
is not revealed. `grant`, `createLink` and `revoke` act as the person of the request: the owner, the
administrators of the organization and the people with the highest level of the type share, never
above their own level. Remove the entry with `resources.remove(ref)` when the resource is deleted:
its grants go with it. The registration joins the transaction of the request, so a rollback undoes
both.

## Who holds a permission

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
organization](without-backend.md#people-and-teams-of-the-organization)) and follow the changes with the events of
permissions instead of polling (see [Events on the server](events.md#events-on-the-server)).

Services outside the kernel read the same through the published view
`mk_published.permission_holder` ([published views](../published-views.md)).

## The sharing dialog

The kernel offers one sharing dialog for every resource type of every extension (MK-055): who has
access, with the names of people and teams; sharing with a person (by email address), a team, the
whole organization or the public, at the levels the manifest declares for the type; links with an
expiry and an optional password, whose address is shown once; revocation; and who may share. For a
type that inherits it also lists, under the name of each resource above, the accesses that come from
there (MK-136), which are changed on that resource. An
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

## Links

A link opens one resource, at most at the `linkLevel` of its type, until it expires or is revoked,
also for people without an account; a link to a folder also opens what the folder holds, for the
types that inherit (MK-136). Its address is `/shared/<secret>` of the installation: the shell
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
only once `Sharing` (`level`, `allows` or `require`) answered for that very resource, or for one
inside it of a type that inherits (MK-136; `visible` too, for such a type). A route serves
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

The same element and the same routes show a resource that the organization shares with the public,
without an account, in the views that its websites embed (MK-100): see
[Embedded views](embedded-views.md).

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
  `/api/v1/organizations/{slug}/permissions` (see the [administration guide](../../guide/administration.md)).
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
