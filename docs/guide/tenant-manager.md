# Mosaikit — Guide for the Tenant Manager

The Tenant Manager runs a tenant: its people, groups and permissions, which plugins are on, the shares,
the usage and the settings the platform lets the tenant customize. Everything a person does in the apps is
in [user.md](user.md); the platform side is in [administrator.md](administrator.md).

A Tenant Manager has every permission in every plugin that is on in the tenant.

## Your sidebar

- **Tenant overview**: figures of the tenant (members and guests, active users in the last 30 days, items,
  shares and public links, apps) and a **Usage** panel.
- **Apps**: the apps of the tenant, as for everybody.
- **Tenant management**: **Manage**, **Plugins**, **Shares**, **Usage**, **Log**.
- **Tenant settings** at the bottom.

Pages of Tenant management are reserved: other people who open their address read *Reserved to Tenant
Managers*.

## Manage

Sections: **People**, **Groups**, **Permission profiles**, **Pending**.

### People

The table shows each person with **Role and profile**, groups, **Status** and **Last sign-in**; guests are
marked *guest*.

- **To invite a person of another tenant**: **Invite people**, the main action of People (see below).
- **To create a person** (tenant with local accounts): **New user** → **Username**, **Display name**,
  **Initial password**, **Role** → **Create user**. With an identity provider (OIDC) there is no **New
  user**: people are created by the provider at their first sign-in.
- People change their own name and picture in Account › Profile; you see the change here. Their email is
  yours to change, in the **Profile** tab.
- **To act on several people**: tick them; the bar **Actions on the selection** appears with **Make Tenant
  Manager**, **Make User**, **Change profile**, **Add to a group**, **Suspend**.
- **The page of a person** (click the name) has the tabs:
  - **Profile**: **Role**, **Permission profile**, groups, in the tenant since, last sign-in.
  - **Sign-in**: **Send the password link** (a link that works once, to copy and give to the person; it is
    also emailed if the account has an address), the open **Sessions** with **Close** and **Close every
    session**. For a guest, password and sessions are handled by their home tenant.
  - **Permissions**: what the person may do in each plugin and where it comes from (profile, group,
    personal grant); **Why can't they see an item?** checks an item by its identifier step by step.
  - **Activity**: their latest events, with **See everything in the log**.
- The menu **⋯** of a person: **Send the password link**, **Reset the password**, **Suspend in the tenant**
  / **Reactivate in the tenant**, **Remove from the tenant**.
- **To remove a person**: **Remove from the tenant** asks **Who gets their N items**; their items pass to
  that person with their shares. For a guest the account stays in their home tenant; for a person whose
  home is this tenant the account is disabled.
- A suspended person cannot enter the tenant; their data stay.

### Inviting a person of another tenant

**Manage › People › Invite people** (also in **Pending**): **Invite a person of another tenant**, choose their **Home tenant**, their
**Username** there, **Role**, **Permission profile** → **Send the invitation**. They join as a guest: they keep signing
in from their own tenant and accept from the bell. Pending invitations are listed under **Invitations**,
with **Revoke**.

### Groups

Groups are for sharing with several people at once and for giving permissions to many people.

- **New group** → **Name** → **Create group**.
- The page of a group: **Members** (**Add a member**, remove), **Shared items**, **Plugins** (what the group
  adds to the profile of its members), **Activity**; **Delete the group** revokes the shares with it.
- Groups marked **From the identity provider** come from the provider of the tenant: only the provider
  changes their members, and they cannot be deleted here.

### Permission profiles

A profile is where the permissions of a User in the plugins start; groups and personal grants add to it,
never take away. Every tenant has the profile *Standard*.

- **New profile** → **Name** and **Description** → **Create profile** (it starts with the default permissions of every plugin).
- The menu of a profile: **Edit the permissions**, **Duplicate**, **Use for new invitations** (makes it the
  **Default profile**), **Delete** (its members get the default profile).
- The standard permissions of every plugin are **Use the app**, **Create items**, **Delete items**,
  **Share items**; a plugin may declare more.

### Pending

- **Access requests**: people who asked to see or edit an item. **Approve**, **Refuse**, or **Forward to the
  owner** (the owner decides). The person gets a notification with the answer.
- **Invitations**: sent and not answered yet.

## Plugins

**Tenant management › Plugins** lists the plugins the Administrator made available to the tenant, with their
kind (**App**, **Service**, **Extension**) and version.

- **On** turns a plugin on or off for everybody in the tenant. Apps appear in the sidebar, services work
  behind the scenes, extensions add fields, actions or tabs to another plugin.
- Turning a plugin off turns its extensions off too (a confirmation names them); an extension says **Turn
  on … first** while its plugin is off. While a plugin is off its public links do not work.
- **Access and permissions** opens the matrix of the plugin: what each permission means, a row per
  **Profile** with check boxes, and **Groups and people** (**Add a group or person**) for grants beyond the
  profile. **Save** appears only after a change.
- When the Administrator makes a plugin available or unavailable, you get a notification.

## Shares

**Tenant management › Shares** lists the items shared in the tenant.

- Pills **Shared**, **Public and links**, **All items**; filters by owner, app and title.
- Tick items → **Revoke shares and links**: every share and public link goes, the owners keep their items.
- **⋯ › Reassign a person's items**: all the items of one person go to another, with their shares.
- If **Tenant settings › Sharing** hides titles from Tenant Managers, you see only counts and sizes.

## Usage

**Tenant management › Usage**, sections:

| Section | What |
|---|---|
| **Quotas** | Storage, people and items with a bar each, read only (**Managed by the Administrator**): *At the limit: …* says what stops; with a growing usage, when the limit arrives at the pace of the last 30 days. |
| **Trend** | A chart per quota with the line of the limit; **Show as a table**. |
| **Who uses the most** | **By person**, **By group** (a person in two groups counts in both), **By app**. |
| **Activity** | Activity of the last days; storage includes *of which in the trash*. |
| **Alerts** | **When to warn**: **At 80%**, **At 100%**, **Forecast**; **Who gets them**: **The Tenant Managers of the tenant**, plus people and groups you add. |

At the limit nothing is deleted: additions stop (new files, people or items). Items in the trash count until
they are deleted for good. Above 80 % an alert appears at the bottom of the sidebar of everybody in the
tenant. Only the Administrator changes the quotas.

## Log

**Tenant management › Log**: what happened in the tenant — who, what, on what, when, result.

- **Everything** / **Only failures** (refused sign-ins, refused operations), filters **Who**, **What**, **On
  what**, **Period**, search.
- Click an event: a side pane with the details (address, browser…), **Only <person>** and **Only this
  item**.
- **Export the selected** or **Export everything as CSV**; **Older events** loads the next ones.
- The same events appear in the **Activity** tab of a person and of a group.

You only see the events of your tenant.

## Trash of the tenant

Your **Trash** (person menu) shows the whole trash of the tenant, with the column **Owner**: you can restore or
delete for good the items of everybody. **Empty the trash** removes only what you own or deleted.

## Tenant settings

They apply to everybody in the tenant. Each setting shows where its value comes from:

- **Inherited**: the value of the platform. **Customize** to give the tenant its own.
- **Customized**: the tenant's own value. **Restore** goes back to the platform.
- **Platform minimum: N** / **Platform maximum: N**: the tenant may only be stricter.
- A padlock and **Managed by the Administrator**: read only (also when the Administrator does not let
  tenants customize that setting).

**Save** appears only after a change.

| Section | What you decide |
|---|---|
| **Sharing** | Public links on or off, maximum length of links, whether Tenant Managers see the titles of the items. |
| **Passwords and sessions** | Minimum length of the password, attempts before the lock, length of the lock and of the session, «Remember me» — only stricter than the platform. |
| **Keys of outside services** | Keys the tenant pays for, for the services the installed plugins use (each says which plugins use it); a shared key is used by everybody in the tenant, one not shared only by Tenant Managers. Only the last four characters show after saving. A key of a service no plugin uses any more is marked as not used: remove it. |
| **Embedding** | The sites that may show the public pages of the tenant, among the ones the platform allows. |
| **Notifications** | The defaults of the emails of the notifications for the people of the tenant. |
| **Identity and appearance** | **Identity and texts** (name, welcome text, footer, privacy and legal notes, guide, **Landing page**, logos for light and dark backgrounds), **Theme and mode** (the theme of the tenant among the ones offered, **New theme** with the theme editor if allowed, default mode), **Languages and formats** (the languages offered, among the platform's, and the default). |
| **Managed by the platform** | Read only: the sign-in method (local accounts or the identity provider of the tenant), the quotas and the other rules the Administrator decides. |

The name and logo of the tenant show in the top bar of its people and on its sign-in page
(`#/login/<tenant>`).

### Layout and Style

**Layout** and **Style** (in Identity and appearance) follow the same rules as the other settings:
inherited from the platform, or customized by the tenant. You are offered the layouts the Administrator
allows; the choice applies to everybody in the tenant. **Style** sets corners, density, font, tabs, main
buttons and a band image (PNG, darkened as needed so the texts read; one too bright is refused), with a
preview before **Save**. **Restore** goes back to the platform.

### The theme editor

**New theme** (if the platform lets tenants choose their theme): a **Name**, the **Main colour**, the **Top
band** (in the main colour, dark or light) and the **Greys** (neutral, warm, cool). The previews show light
and dark; **Does it read?** lists the contrast checks. **Fix it for me** corrects what does not read; **Save
the theme** stays off until everything reads. A theme made for the tenant can be edited and deleted; when
it is deleted the tenant goes back to the theme of the platform.

## Sign-in of the tenant

The Administrator decides how the people of the tenant sign in: local accounts (username and password kept by
Mosaikit) or the identity provider of the tenant (OIDC), never both. You see it in **Tenant settings ›
Managed by the platform**. With the identity provider:

- people are created at their first sign-in, there is no **New user** nor password link;
- roles come either from Mosaikit (you give them) or from the groups of the provider;
- groups of the provider may appear in **Groups**, marked **From the identity provider**.
