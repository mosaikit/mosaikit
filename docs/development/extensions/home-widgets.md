# Widgets of the home page

The home page of the shell is a launcher of the apps with widgets that extensions contribute (MK-101,
[ADR-0039](../../adr/0039-console-layout.md)): each role finds what needs its attention, and visitors
without an account find the public face of the installation. The frame is the kernel's; the content
is yours.

Contribute a widget to `home.widget`, an extension point that the kernel owns and types as any
[typed point](contracts.md#contracts-between-extensions) of an extension:

```yaml
frontend:
  entry: web/index.js
contributes:
  home.widget:
    - id: due-today
      title: Due today                # required, at most 80 characters
      element: example-due-today      # required: a custom element your frontend defines
      roles: [organization-user]      # optional: who sees it; everybody signed in when absent
      public: false                   # optional: true shows it to visitors without an account too
      size: small                     # optional: small (one column, the default) or wide (two)
      order: 10                       # optional: smaller first, 100 by default
      permission: see-due             # optional: hidden from people without it (MK-056)
      i18n:
        it: { title: In scadenza oggi }
```

`roles` names some of `platform-admin`, `organization-admin`, `organization-user` and
`organization-guest`; a person sees the widget when they hold one of them. An organization
administrator usually holds `organization-user` too, so a widget for members shows to them as well.
The kernel gives each person only the widgets of their roles, so a widget for platform
administrators never reaches the browser of a member.

The marketplace refuses a widget that does not match the point, with the reason (`the contribution
due-today of org.example.tasks 1.0.0 to home.widget does not match the schema of the kernel:
due-today.roles[0] must be one of [platform-admin, organization-admin, organization-user,
organization-guest]`); one that reached the installation otherwise, such as a copy into
`extensions/`, is never shown. Other attributes are refused: the point admits only those above.

The shell creates the element in a card with the title, once per page, and keeps it while the person
stays on the home page. Read what it shows with the context of your frontend, as in an app. When
your extension stops being active in the organization (turned off, removed, updated to an
incompatible version) its widgets disappear at once, without a reload
([Whether another extension is present](presence.md#whether-another-extension-is-present)).
A frontend [isolated in an iframe](frontend.md#isolated-frontends) has no widgets on the home page.

## Widgets for visitors

A widget with `public: true` also shows under the sign-in page, to visitors without an account. The
shell then loads your frontend before anyone signs in, with a context whose `user` has no name and no
role, and loads it again after the sign-in with the context of the person: define your elements once
and keep the latest context.

```js
let context;
export default {
  activate(current) {
    context = current; // the context of the visitor first, then of the person
    if (!customElements.get('example-news')) {
      customElements.define('example-news', ExampleNews);
    }
  },
};
```

A visitor has no session: the API of your extension (`/api/v1/ext/...`) and its documents answer 401.
A public widget shows what needs no account, such as a text, a link to the sign-in or content of the
web that the [external origins](browser-services.md#external-services-from-the-browser) allow. The
kernel lists the public widgets with `GET /api/v1/shell/home/public`.
