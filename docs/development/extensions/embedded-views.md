# Embedded views

Organizations show the views of their apps in the pages of their own websites, in an iframe
(MK-100). The shell has an embed mode for that: the view alone, without the app bar and the top
bar, at addresses under `/embed/<slug>/`, which only the installation itself and the sites that the
administrators of the organization `<slug>` list may frame (see the
[administration guide](../../guide/administration.md#embedded-views)). An extension needs nothing new
to be embedded: what it already gives to links and to the address of the page is what the embed
mode uses.

| Address | What the shell places | How the extension reads |
|---|---|---|
| `/embed/<slug>/public/<extension>/<type>/<id>` | the element of `shared.view` for the type, as for a [link](resources-and-sharing.md#links) | `request` calls the kernel as the public of the organization: header `X-Mosaikit-Public: <slug>`, no credentials of the browser |
| `/embed/<slug>/shared/<secret>` | the element of `shared.view`, as for a link of that organization | `request` carries the link, as on `/shared/<secret>` |
| `/embed/<slug>/app/<name>/<state>` | the element of the app, as in the console | as in the console; `context.address` reads and writes the state after the route of the app ([address](address.md)) |

A resource shared with the public is read by a request **without an account** that names the
organization in `X-Mosaikit-Public`. The APIs of extensions let such a request in only when the
organization shares a resource of that same extension with the public (and it is not in the trash);
as for a link, it has no organization until `Sharing` (`level`, `allows` or `require`) answered for a
resource that the public reaches, also through a resource above it of a type that inherits (MK-136).
So the route that serves links serves the public too, with nothing to change:

```java
@GET
@Path("{id}")
@PermitAll                                   // a link or the public, which Sharing checks
@Transactional
public DashboardView get(@PathParam("id") UUID id) {
    sharing.require(new ResourceRef(EXTENSION, "dashboard", id.toString()), "view");
    return DashboardView.of(dashboards.findById(id).orElseThrow(NotFoundException::new));
}
```

The level that `Sharing` gives is the level of the public, the lowest of the type unless it declares
otherwise; read only the resource it answered for. A type that is never shared with the public does
not list `public` in its `subjects`, and its resources are never embedded without an account.

In the embed mode:

- Only frontends that the shell loads as modules show a resource of the public or of a link, as on
  `/shared/<secret>`; an isolated frontend shows its apps, not its shared views.
- The view of an app needs the session of a person of the organization. A frame on another site gets
  no session (the cookies are `SameSite=Strict`), so there the shell says to sign in and opens the
  installation in a tab of its own; design the views to embed for the public as `shared.view`
  elements.
- Links that the element follows change the page inside the frame; any address that is not of the
  embed mode is refused in a frame. Open other pages with `target="_blank"`.
- The element fills the frame: the shell adds no title, margin or note around it.
