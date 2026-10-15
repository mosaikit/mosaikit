# The state of an app in the address

People share what they look at by copying the address of the page. An app keeps its view in the
address, after its route, and the shell gives it back when the address is opened again: in another
browser, after a reload, after sign-in (also through the identity provider of an organization), and
when the person moves with the back and forward buttons (MK-099). Nothing is saved on the server.

The **state** is what follows the route of the app: a sub-path, a query, a fragment, or all three,
such as `/folders/42?sort=name#item-7` after `/app/files`; the empty string is the app as it opens
from the app bar. Any path under the route of an app opens that app, so a folder can have an address
like `/app/files/folders/42` instead of `/app/files?folder=42`.

`context.address` of `@mosaikit/sdk` reads and writes it:

```ts
const address = context.address; // absent where there is no address, such as a shared link
const open = (folder: string) => {
  address?.write(`/folders/${encodeURIComponent(folder)}`); // a new entry of the history
  render(folder);
};
render(folderOf(address?.read() ?? '')); // '' when the app opens from the app bar
const stop = address?.subscribe((state) => render(folderOf(state))); // back, forward, a link
```

- `read()` gives the state of the app of the extension that is shown, or `''` when none is.
- `write(state)` adds an entry to the history of the browser; `write(state, { replace: true })`
  takes the place of the current one, for what the back button should skip, such as the text of a
  search while it is typed. Writing the state already there does nothing. It returns `false`, and
  writes nothing, when no app of the extension is shown.
- `subscribe(listener)` is called with the new state when the person moves with the back or forward
  button, or opens the app again from the app bar (with `''`); not for the states the extension
  writes itself. Call the function it returns in `disconnectedCallback`.

The state must be empty or start with `/`, `?` or `#`, and be written as the browser keeps it, so
that the address gives back exactly the same string: encode each part with `encodeURIComponent`,
and leave out `.` and `..` segments and backslashes. `write` throws a `TypeError` otherwise, and
`isAppState(state)` of `@mosaikit/sdk` says whether a string is a valid state.

An isolated frontend (see [Isolated frontends](frontend.md#isolated-frontends)) uses the same
`context.address`: the frame has no address of its own, so the shell writes the state for it and
sends it the moves; nothing is to be declared in `bridge`.

The address is not a secret and not a permission: whoever opens it signs in and sees only what the
backend of the extension lets them see. Keep in it what identifies the view, not data. In the tests
of a frontend, give the element a fake `AppAddress`: an object with `read`, `write` and `subscribe`.
