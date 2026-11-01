# Extensions and layouts

Three kinds of plugin that add to the platform without being an app: **extension** (adds to another plugin),
**layout** (arranges the shell) and **language** (a language of the interface). Architecture §8.9 and §14.1.

```
mosaikit-plugin new acme-priority --variant extension        # or: --example note-priority
mosaikit-plugin new acme-layout   --variant layout
mosaikit-plugin new lang-fr       --variant language --lang fr
```

## Extensions

An extension (`kind = "extension"`) adds fields, actions and tabs to the **items of a resource of another plugin**:

```toml
kind = "extension"

[extends]
plugin = "com.mosaikit.notes"
min_version = "0.4.0"        # the first version with the extension points; default 0.0.0

[[extension.fields]]         # fields on the items
resource = "notes"
key = "priority"
label = "Priority"
kind = "choice"
options = ["low", "normal", "high"]
option_labels = { low = "Low", normal = "Normal", high = "High" }
# also: multiline, hidden

[[extension.actions]]        # buttons in the detail of an item
resource = "notes"
key = "mark_reviewed"
label = "Mark as reviewed"
set = { reviewed = true, reviewed_by = "$user" }    # or: command = "<command of its logic>"

[[extension.tabs]]           # a tab in the detail (needs [ui])
resource = "notes"
key = "review"
label = "Review"             # at most 40 characters
icon = "clipboard-check"     # optional
page = "tab.html"            # an .html file of its UI; default the entry
```

Rules:

- `[extends]` is required, and `[extension]` is only for this kind. The extended plugin cannot be the extension itself.
- Field keys are unique in the extension and cannot be `resource_id`, `tenant_id`, `id`, `owner`, `my_level`.
- An action has **either** `set` **or** `command`. `set` writes the given values: `$user` is the name of the person,
  `$today` the date; each key must be a field of this extension for that resource, and the value must fit the kind
  (a bool for `bool`, a number for `number`, a string for the rest). A `command` is the name of a command of the
  extension's own logic (letters, digits, `_`, `.`, `-`); command actions are experimental.
- A command action receives `{ resource, resource_id, item, values }` (the item as the person sees it) and answers
  `{ "set": { … } }`; every value is checked against the declared fields.
- A tab needs `[ui]`.
- The extension and its base must both be **on** in the tenant, and the person needs `use` on the extension; if the
  base is off, the error is `base_off`.

**The contract is narrow.** An extension never reads the tables of the plugin it extends. The kernel keeps its values,
one set per item and extension, removed with the item and the extension, and checks them with the **permissions of
the item**: who sees the item sees the values, who can edit it changes them and runs the actions. The UI of the extended
plugin reads them with `msk.extensions('notes')`; `mountCrud` shows the fields as columns and in the detail (not
`hidden` ones) and the actions as buttons, with no code from you.

**A tab** is a page of the extension shown in the detail of an item, in a frame of its own **without
`allow-same-origin`**: its origin is opaque, so neither plugin reaches into the other's page, storage or cookies, and the
page cannot use `localStorage`. In that page `msk.tab` says where it is and `msk.tabClient()` reads the item
(`item()`), reads and changes the values (`values()`, `set()`, `action(key)`) and keeps the height
(`autoResize()`); the kernel checks the person's level on every call. After a change the base plugin gets
`ext.changed`. An extension with a UI is not an app: it is not in the sidebar.

Translations: `[i18n.<lang>] extension = { fields = {…}, actions = {…}, tabs = {…} }`. The official sample is
`com.mosaikit.note-review` (two fields, an action and a tab).

## Layouts

A layout (`kind = "layout"`) decides **where the slots of the shell sit**: it never changes what they do and runs no
code. It has no resources, `[ui]`, KPIs or `[search]`. Files:

```
plugin.toml
layout/layout.toml      the arrangement
layout/layout.css       optional style, checked at install and scoped to the layout (at most 64 KiB)
layout/images/*.png     optional images (PNG, WebP or safe SVG; at most 8, each at most 512 KB)
```

`layout.toml` (unknown keys refused):

```toml
pattern = "tabs"            # rail | sidebar | drawer | launcher | areas | tabs   (required)
band_image = "band.png"     # optional: a PNG of images/ under the band

[band]
brand = true                # logo and name in the band (default true)
breadcrumb = false          # default false
search = "center"           # center | wide
tenant = "band"             # band | nav: where the tenant switcher sits

[nav]
card = false                # the navigation as a floating card

[phone]
nav = "drawer"              # drawer | launcher: the navigation on a screen of 900 px or less

[style]                     # default style; the platform's or a tenant's wins
tabs = "underline"
```

Style variables and values: `radius` (`square`, `medium`, `round`), `density` (`compact`, `comfortable`), `font`
(`system`, `humanist`, `serif`), `tabs` (`underline`, `pill`, `boxed`), `buttons` (`filled`, `outline`, `soft`). An unknown
variable or value is refused.

**CSS check.** Only allow-listed properties; `display`, `visibility`, `position`, `content`, `z-index`, `@import`,
`@font-face`, escapes and `<` are refused; `url()` only to the images of the package. Rules are scoped under
`.mskl-<id>` (dots become dashes), so a layout styles the classes of the slots (`msk-band`, `msk-nav`, `msk-nav-item`,
`msk-tab-item`, `msk-launcher-tile`, `msk-main`…) and nothing else. Landmarks, the «Skip to the content» link and the
keyboard order stay the shell's.

**Band image.** PNG, at most 512 KB; the kernel lays the band colour over it as a scrim until the text has 4.5:1
contrast, and refuses an image too bright even at the strongest scrim (`band_image_contrast`).

The Administrator chooses which layouts tenants may use; a tenant picks one (there is no personal choice). A layout that
is turned off or removed falls back to the built-in `teams`. Official layouts: `layout-workspace`, `layout-suite`,
`layout-project`, `layout-tabs` in `mosaikit-plugins`.

## Languages

A language plugin (`kind = "language"`) adds a language of the interface, texts only:

```toml
kind = "language"
[language]
code = "fr"                 # two or three lower case letters; not en or it (built into the host)
name = "Français"           # at most 60 characters
```

```
lang/host.json                      the texts of the shell: English phrase -> translation, same {placeholders}
lang/plugins/<plugin id>.toml       the texts of another plugin's manifest, in the shape of its [i18n.<code>]
```

Limits: `host.json` at most 1 MiB and 6000 texts of at most 1000 characters; at most 100 plugin files of 200 KiB. The
texts inside the UI of a plugin (its iframe) stay that plugin's business; a plugin that has its own `[i18n.<code>]`
keeps it. A language plugin is exempt from the i18n coverage check of `validate --strict`.
