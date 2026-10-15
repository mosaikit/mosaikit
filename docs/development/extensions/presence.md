# Whether another extension is present

An extension that can use another one asks whether it is there before it offers what needs it, and
reacts when it comes or goes (MK-133). Another extension is **active in an organization** when it is
installed, compatible with the kernel and with what it requires, and the organization did not turn
its apps off. Any extension may ask about any other, whether or not it declares it in `optional`;
of one that is not installed, or not active there, the answer says only that it is absent.

On the server, inject `ExtensionPresence` (`dev.mosaikit.kernel.api.extension`): it answers in the
organization of the request, or of the event a subscriber handles, and gives the version.

```java
@Inject ExtensionPresence presence;

if (presence.isActive("org.example.ext.catalog")) {
    Optional<Version> version = presence.version("org.example.ext.catalog");
    // offer to open the file in the catalog
}
```

To react, subscribe to `extension.activated` and `extension.deactivated` (see
[Events on the server](events.md#events-on-the-server)): the kernel raises them in every organization where
another extension becomes active or stops being active, because it was installed, updated, removed,
no longer able to run, or turned on or off there. An extension installed or removed while the kernel
is stopped is told at the next start.

In the frontend, `context.extensions` answers the same for the organization of the session, without
a request to the server: the shell reads the list once with the session and keeps it current through
the real-time channel, in isolated frontends too.

```ts
const catalog = 'org.example.ext.catalog';
const render = () => {
  button.hidden = !context.extensions.isActive(catalog);
};
render();
const stop = context.extensions.subscribe((change) => {
  if (change.extension === catalog) render(); // change.active, change.version, change.reason
});
```

`context.extensions.version(id)` gives the version, `undefined` when the extension is not active,
and `active()` the whole list. In the tests of a frontend, build a fixed answer with
`new PresenceStore([{ id: 'org.example.ext.catalog', version: '1.2.0' }])` of `@mosaikit/sdk`. A page
opened through a link to a shared resource has no organization of a session: no other extension is
active there.
