<!-- SPDX-FileCopyrightText: 2026 Massimo Antonini -->
<!-- SPDX-License-Identifier: MPL-2.0 -->

# Requests for access

A person who opens a resource they may not open, from a link a colleague sent or a bookmark, should
not hit a wall. An extension whose resources are registered and shared with the sharing model
([Resources, sharing and permissions](resources-and-sharing.md#resources-sharing-and-permissions))
offers **Request access** on the page that refused them (MK-058): the person writes a message, the
people who may share the resource are notified and decide on the page **Requests for access** of the
shell, and an approved request grants the level with the sharing model. The extension writes no
code for the request, the notifications or the decision.

## Offering the request from a refused page

Show the refused page with `<mk-empty-state kind="denied">` of the UI kit
([Page patterns](page-patterns.md#empty-and-error-states)) and name the resource the person asked
for, as `<extension>/<type>/<id>`:

```html
<mk-empty-state kind="denied" resource="org.example.dashboards/dashboard/42"></mk-empty-state>
```

The panel then offers **Request access** (`action-label` gives it in another language). Choosing it
dispatches `mk-request-access` with `{ resource }`, bubbling and composed, and the shell opens the
request. An app with a page of its own publishes the topic instead:

```ts
import { requestAccess } from '@mosaikit/sdk';

requestAccess(context, 'dashboard', '42'); // the lowest level of the type
requestAccess(context, 'dashboard', '42', 'edit'); // or a level of the type
```

`requestAccess` publishes `shell.request-access` with `{ extension, type, id, level? }`. A frontend
isolated in an iframe ([Isolated frontends](frontend.md#isolated-frontends)) declares the topic in
its bridge, `frontend.bridge.publishes: [shell.request-access]`; in the frame the runtime passes the
`mk-request-access` of the panel to the shell as that topic.

## What the request reveals

Nothing more than the refused page. Show on that page only what you would show anyway: the kernel
answers the request the same whether the resource exists or not, whoever owns it, and neither the
dialog nor the answer names its title or its owner. When the API of your extension answers 404 for a
resource the person cannot read, keep doing so; offering the request does not tell them it exists.

## Who decides, and what an approval does

- **Notified**: the owner of the resource; for a resource of the organization, or whose owner left,
  the administrators of the organization who may share it. The notification comes from the kernel
  (source `kernel`, kind `access-request`), and people turn it off in their settings like the others.
- **Deciding**: whoever may share the resource ([Who shares](resources-and-sharing.md)) sees the
  request on **Requests for access** and approves it, with the level asked or another level of the
  type, or declines it with an optional reason.
- **An approval** grants the requester a level with `Sharing.grant` as the person who decided: the
  grant is a grant like the others, in the sharing dialog, raised as `sharing.granted` and audited.
  For a type that inherits (MK-136) an approval on a folder reaches what is inside it. A requester
  who already holds the level keeps the one they have.
- **The requester** is notified either way (kind `access-request-outcome`): an approval opens the
  resource with its `link` of the registry; a rejection does not name the resource, only their
  message and the reason.
- Every request, approval, rejection and withdrawal is in the audit log (`access.requested`,
  `access.request.approved`, `access.request.rejected`, `access.request.withdrawn`).

The REST API is in [the REST API of the kernel](../api.md) (`/api/v1/access-requests`).
