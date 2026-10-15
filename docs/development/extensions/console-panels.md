<!-- SPDX-FileCopyrightText: 2026 Massimo Antonini -->
<!-- SPDX-License-Identifier: MPL-2.0 -->

# Panels of the console

The console of the platform administrators shows the state of the installation (MK-072,
[ADR-0039](../../adr/0039-console-layout.md)). An extension adds a panel to it with the point
`console.panel` of the shell: a custom element that the console mounts in a panel with a title,
next to its own panels, for the platform administrators only.

```yaml
contributes:
  console.panel:
    - id: last-backups
      title: Last backups                 # required, at most 80 characters
      description: The backups of the week # optional, at most 200 characters, below the title
      element: backups-console-panel      # required: the custom element of the panel
      order: 20                           # optional, 0 to 1000, smaller first; 100 by default
      permission: view-backups            # optional: shown only to people who hold it
      i18n:
        it: { title: Ultimi backup }
```

`console.panel` is a typed point of the kernel (as `home.widget` is), version 1 ([Contracts between
extensions](contracts.md#contracts-between-extensions)): its schema allows exactly the attributes
above (`i18n` aside), so a contribution with another attribute, or without `element` or `title`, is
refused at installation with the reason (`the contribution last-backups of org.example.backups 1.0.0
to console.panel does not match the schema of the kernel: …`), and one that reached the installation
otherwise never reaches the shell.

The frontend of the extension defines the element when it is activated, as for its apps; the console
creates it with `document.createElement` and adds it to the panel, so the element reads what it
shows through the context of the extension (`context.fetch` to its own API). It runs in the page of
the shell: panels need an extension whose frontend is a module, not an isolated one. Use the page
patterns of the UI kit ([Page patterns](page-patterns.md)) and the `--mk-*` tokens, so that the panel
looks like the rest of the console; keep it short, and link to the app of the extension for the
details.
