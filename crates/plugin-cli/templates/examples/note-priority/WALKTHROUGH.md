# Walkthrough: an extension of Notes

An extension adds to another plugin without touching it: fields in its items, actions in their detail, and (not in this
example) tabs. It is only a manifest. Make it again with `mosaikit-plugin new {{name}} --example note-priority`.

## 1. What is extended (`[extends]`)

`plugin` is the id of Notes and `min_version` the first version that has the extension points. The extension has an effect only where
that plugin is installed.

## 2. Fields (`[[extension.fields]]`)

`priority` (a choice) and `follow_up` (a date) are added to the resource `notes`. Notes shows them in the form of a
note, `mountCrud` does it by itself. The kernel keeps the values; the tables of Notes do not change. The kinds are those of any field.

## 3. Actions (`[[extension.actions]]`)

A button in the detail of a note. `set` writes values in one click: `$user` is the name of the person, `$today`
the date. An action may call a command of a plugin instead (`command`). Who may use the actions is decided by the permissions of this plugin.

## 4. Translations (`[i18n.<lang>]`)

The texts of an extension are under `extension`, by key: `extension = { fields = { priority = "..." }, actions = { ... } }`.
A text that is missing falls back to English.

## 5. Check and pack

```
mosaikit-plugin validate
mosaikit-plugin pack --no-build      # an extension has nothing to build
```

Install the package where Notes is installed (Plugins, Install from a file). Open a note: the fields and the
buttons are there.

## Things to try

- Add a tab with a page of your own: `[[extension.tabs]]` and a `[ui]` (see the Note review plugin).
- Add a field `owner_team` of kind `text` and an action that sets it.
