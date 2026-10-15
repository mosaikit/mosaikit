# Frontend contract

The module's default export implements `MosaikitExtension` from `@mosaikit/sdk`:

```ts
import { defineExtension } from '@mosaikit/sdk';

export default defineExtension({
  activate(context) {
    customElements.define('example-hello', class extends HTMLElement { /* ... */ });
    context.events.on('maps.selection.changed', (payload) => { /* ... */ });
  },
});
```

Any framework that produces custom elements can be used. Use the shell's CSS custom properties
(`--mk-surface`, `--mk-fg`, `--mk-accent`, …) so that the extension follows the theme.

## Real time

The shell keeps one WebSocket to the kernel (MK-031). A frontend reacts to the changes of its
collections, made by anyone of the organization, and to the events of its backend:

```js
const items = context.data('items');
const stop = items.onChange(({ id, action }) => refresh()); // created, replaced, deleted
context.live.subscribe('extension.dev.example.hello.greeted', (data) => show(data));
```

A Java backend publishes with `LiveEvents` of `kernel-api`; the event leaves when the transaction
commits, and reaches the pages subscribed to the topic in the same organization:

```java
@Inject LiveEvents live;
live.publish("extension.dev.example.hello.greeted", Map.of("id", greeting.id()));
```

Topics are `documents.<extension id>.<collection>`, `extension.<extension id>.<name>`, `notifications`
and `extensions`, the extensions that become active or inactive in the organization, which
`context.extensions` already follows (see
[Whether another extension is present](presence.md#whether-another-extension-is-present)); the kernel refuses
the others, and those of extensions that the organization turned off. Send what
changed, not the data: pages read it again with the rights of each person.

## Notifications

An extension notifies people of the organization in their activity feed (MK-038): a frontend with
`context.notify`, by email address, a Java backend with `Notifications` of `kernel-api`, by account
identifier.

```js
await context.notify({
  to: ['anna.bianchi@example.org'],
  kind: 'mention',            // people can turn each kind off
  title: 'Mario mentioned you',
  body: 'In the notes of the meeting',
  link: '/app/notes',         // a path of the shell
});
```

The people who are not in the organization, or who turned the kind off, receive nothing. The feed
is pushed on the real-time channel, so the pages show it at once.

## Settings, language and theme

An extension adds a section to the personal settings with the point `settings.section`; `roles`, when
given, shows it only to people with one of them:

```yaml
contributes:
  settings.section:
    - id: export
      title: Export
      element: example-export-settings   # custom element rendered in the section
      roles: [organization-admin]        # optional
```

`context.locale` is the language the person chose (`en`, `it`); read it when rendering. The shell
publishes `shell.locale.changed` (`{ locale }`) and `shell.theme.changed` (`{ theme, appearance }`)
on the event bus, and mounts the current app again when the language changes.

## Theme extensions

An extension of kind `theme` brings the colors of a brand and, for a product built on Mosaikit, the
name and logo of the product. It is active as soon as it is installed, people choose it in their
settings, and an installation can make it its default (`mosaikit.ui.theme=<extension id>`):

```yaml
id: dev.example.brand
version: 1.0.0
name: Our brand
kind: [theme]
platform: '>=0.1 <1'
theme:
  title: Our brand
  font: "'Inter', system-ui, sans-serif"   # optional
  radius: 8                                # optional, 0 to 24 pixels
  light:                                   # any of: brand, background, surface, foreground,
    brand: '#8a1538'                       # muted, line, danger, success, warning, focus
  dark:
    brand: '#e2738f'
  product: Our product                     # optional, up to 60 characters
  logo:                                    # optional, SVG or PNG files of the extension
    light: web/logo.svg                    # for light backgrounds
    dark: web/logo-dark.svg                # optional, for dark backgrounds
```

Every color, font or radius it leaves out comes from the default theme. The product name and the
logo (MK-052) apply only when the theme is the one of the installation: the shell then shows them
in its bar and on the sign-in page, and uses them as the title and the icon of the page, also for
people who choose another theme in their settings. The bar of the shell has the brand color, so it
shows the logo for dark backgrounds; without one, the logo for light backgrounds. Draw the logo
square: it is shown at 22 to 28 pixels. Choose colors with enough
contrast (WCAG 2.1 AA: 4.5:1 for text): the high contrast appearance stays available to everyone.
[`sample-theme`](https://github.com/mosaikit/mosaikit-ext-samples/tree/main/theme) is a complete example.

## Components and themes

The shell defines the Fluent UI web components for the page
([ADR-0032](../../adr/0032-fluent-ui-and-themes.md)): an extension that runs as a module can use
`<fluent-button>`, `<fluent-dialog>`, `<fluent-tablist>` and the others without bundling them, and
they follow the theme of the installation. Style everything else with the tokens:

| Token | Use |
|---|---|
| `--mk-bg`, `--mk-surface` | background of the page, of cards and panels |
| `--mk-fg`, `--mk-muted` | text, secondary text |
| `--mk-line` | borders |
| `--mk-accent`, `--mk-accent-fg`, `--mk-accent-soft` | primary actions, text on them, selection |
| `--mk-danger`, `--mk-success`, `--mk-warning` | states |
| `--mk-focus` | the ring of the keyboard focus |
| `--mk-radius`, `--mk-font`, `--mk-font-mono` | shapes and fonts |

The tokens change with the theme (`mosaikit.ui.theme`: `mosaikit`, or `pa` in the style of
Bootstrap Italia) and with the light or dark preference of the system; never hard-code colors.

## Frontends written with a framework

A frontend may use React, Vue or any framework ([ADR-0020](../../adr/0020-frontends-in-any-framework.md)):
bundle it with the framework into one ES module (Vite library mode, `formats: ['es']`) and declare
that module as `frontend.entry`, as [`sample-react`](https://github.com/mosaikit/mosaikit-ext-samples/tree/main/react) and
[`sample-vue`](https://github.com/mosaikit/mosaikit-ext-samples/tree/main/vue) do. Render inside the shadow root of your custom element,
unmount in `disconnectedCallback`, style with the `--mk-*` tokens and talk to other extensions only
through `context.events` and extension points.

## Isolated frontends

A frontend runs isolated in a sandboxed iframe (MK-014,
[ADR-0015](../../adr/0015-isolated-plugin-frontends.md)) when its manifest says
`isolation: iframe`, or when its publisher is not verified (an unsigned package, a key the
installation does not trust, an extension directory) and the installation isolates such extensions
(`mosaikit.extensions.unverified-frontends=iframe`, the default). The same module works in both
modes, as long as it uses only its `context`:

| In the context | Isolated |
|---|---|
| `events.publish(topic)` | only topics of `bridge.publishes` reach the shell |
| `events.on(pattern)` | only patterns covered by `bridge.subscribes` receive events |
| `fetch(path, init)` | only the backend API of the extension (`/api/v1/ext/<api>/…`, or a path relative to it), text bodies, with `bridge.services: [api]` |
| `data(collection)` | only the collections of the extension, with `bridge.services: [data]` |
| `address` | as usual, written by the shell ([The state of an app in the address](address.md)) |
| `user`, `extension`, `contributions`, `locale` | as usual |

In the iframe the extension has no access to the page of the shell, to its storage or to the
credentials of the person, and it can load code and data only from the kernel. Declare the bridge
even if you plan to run as a module: installations that isolate unverified extensions use it.
