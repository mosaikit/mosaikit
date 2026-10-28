# Mosaikit — Guide for the people who work in a tenant

This guide is for everybody who signs in to a tenant to work with its apps. What the Tenant Manager and the
Administrator do is in [tenant-manager.md](tenant-manager.md) and [administrator.md](administrator.md).

Labels are those of the English interface; the Italian one has the same places.

## Signing in

1. Open the address of Mosaikit.
2. In **Tenant**, choose your tenant (it is already chosen when there is only one, or when the address
   ends with `#/login/<tenant>`).
3. Then, depending on the tenant:
   - **Username** and **Password**, then **Sign in**. **Remember me on this device** keeps you signed in
     for some days (the Administrator decides how many; the option may be missing).
   - or **Sign in with …** (the identity provider of your organisation): the password is asked there,
     never by Mosaikit. You come back signed in.
4. Too many wrong passwords lock the sign-in of that account for some minutes.

**Guest in other tenants.** You always sign in to your *home* tenant. If you were invited to other
tenants, switch from the name of the tenant at the top left: switching does not ask you to sign in again.

**Forgot the password.** On the sign-in page choose your tenant and click **Forgot your password?**: type
your username or your email address and **Send the link**. If an account with those details exists, a message
goes to its email address with a link to choose a new password; the link works once, for 48 hours, and a
newer request cancels the older links. The page answers the same whatever you type (it never tells whether an
account exists). If the installation cannot send email the page says so: ask the Tenant Manager of your home
tenant for a link instead. People who sign in through an identity provider have no password in Mosaikit:
the page of their tenant points to the provider's own recovery.

**Language and mode** can be chosen already on the sign-in page (top right).

## The shell

| Where | What |
|---|---|
| **Sidebar** (left) | **Home** and the apps you can use. The button at the top of the bar opens or closes it (only icons, or icons and names). |
| **Tenant** (top left) | The tenant you are in; with more than one, a menu to switch (**Home tenant**, **Guest in**). |
| **Search** (top centre) | Pages, apps and the items you can see. Also with `Ctrl K` or `/`. |
| **Language**, **Mode** | The language of the interface; light, dark or automatic mode and **High contrast**. |
| **Help** (?) | **Guided tour of this page**, **Guide of Mosaikit**, **What is new in version …**, **Keyboard shortcuts**. A dot on the button means a tour of this page is waiting for you. |
| **Bell** | Your notifications (see below). |
| **Person menu** (your name) | **Account**, **Notifications**, **Access requests**, **Trash**, **Sign out**. |

The arrangement of these parts depends on the **layout** the Administrator or your Tenant Manager chose
(rail of icons, sidebar, grid of apps, areas or tabs); the parts and the keyboard order are the same. The
first Tab stop of every page is **Skip to the content**. An app with several pages shows them under its
name in the navigation: open the arrow next to it. On a phone the menu button opens a drawer (or a grid of
apps and pages) with all of them.

Some of these may be missing: the Administrator decides what the top bar shows. When **Help** is not in
the bar, its items are in the person menu.

**When the server does not answer** (an update, a restart) the page says *The server is not responding.
Trying again…* and comes back by itself.

## Home

The **Home** shows your space (**Your items**), **Shared by me**, **Shared with me**, **My active public
links** and the apps of the tenant.

- **Shared by me** lists what you shared, with whom and how many public links. **Revoke all** removes every
  share and public link of an item (you keep the item).

## Apps and items

Each app opens in the shell (Notes, Tasks, Contacts, Files, Maps, Static sites… depending on the tenant).
**Static sites** shows its sites as **cards** (default, with a thumbnail) or as a **list** (buttons at the
right of the toolbar). A site is either a **zip archive** or a **web address**: an address is shown inside
Mosaikit in a frame and is never downloaded; a site that forbids being framed (X-Frame-Options or a CSP
`frame-ancestors`) is detected and opens in a new tab. The thumbnail can be uploaded by you; otherwise a site
given by address shows its own picture (`og:image`, else its first image) and a zip site a placeholder.
What you may do in an app depends on your **permission profile**: some people may only read, some may also
create, delete or share. When something is not allowed, the app says so.

Some items have extra fields, buttons or tabs added by an **extension** (for instance *Note review* adds
*Reviewed*, *Mark as reviewed* and a **Review** tab to the notes).

When a quota of the tenant is used up, the apps refuse new items or files and say so; nothing is deleted.

## Sharing an item

Open the item in its app and choose **Share**.

1. **People and groups of the tenant**: search a person or a group, choose the **Level** and **Share**.
   - **View**: sees the content.
   - **Edit**: edits the content.
   - **Manage**: shares, moves, deletes.
2. **Shared with** lists who has access; change the level or **Revoke**.
3. **Public link (read only)**: a link anybody can open without signing in. Optional **Expiry (days)** and
   **Password (optional)**, then **Create link**. *The link is shown only now*: copy it at once. The list
   **Public links** shows when each one was created, when it expires and its views; **Revoke** closes it.
   If the tenant turned public links off, the dialog says so.
4. **Ownership**: give the item to another person (**Transfer**).

People outside the tenant must first be invited by the Tenant Manager.

The person you share with gets a notification with a link to the item.

## Asking for access to an item

If you open the address of an item you cannot see, the page says **You cannot see this item**.

1. Choose **View** or **Edit** under **Access**, write a **Message (optional)**.
2. **Send the request**.

The owner, or a Tenant Manager, decides; you get a notification with the answer. When it is approved the
same address opens the item.

If you own items, the requests of other people arrive in the bell; person menu › **Access requests** opens
**Requests to see or edit your items**: **Approve** or **Refuse**.

## Notifications

The bell shows a number when something new arrives (invitations, shares, access requests, alerts, messages
of the apps), without reloading the page.

- In the panel: **Accept** / **Decline** an invitation, **Mark all as read**, the gear (preferences) and
  **See all**.
- **See all** opens the **Notifications** page: **All** / **Unread**, **Kind**, **Period**, search; select
  rows to **Mark as read**, **Mark as unread** or **Delete**.

Which notifications also arrive **by email** is chosen in **Account › Notifications**.

## Trash

What you delete goes to the **Trash** (person menu), not away at once.

- It stays there for a number of days (30 unless the Administrator changed it), then it is deleted for good.
- While it is in the trash nobody sees it and its public links do not work.
- **Restore** brings it back with its shares, public links and files.
- **Delete for good** and **Empty the trash** cannot be undone.
- You see what you own or deleted; the Tenant Manager sees the whole trash of the tenant.

Items in the trash still count in the quotas of the tenant until they are deleted for good.

## Account

Person menu › **Account**. Sections:

| Section | What you find |
|---|---|
| **Profile** | Your **Picture** (SVG, PNG or WebP, at most 512 KB: the people of your tenants see it) and your **Display name**, which you change yourself; username and home tenant. The email is changed by the Tenant Manager of your home tenant (an Administrator changes their own from here: **Email › Change email**, with the current password and, if on, a code of the authenticator app). In a tenant that signs in through an identity provider the name comes from the provider. |
| **Sign-in and security** | **Change password** (current, new, repeat; the rule of the tenant is shown under the field). Changing it closes your other sessions. In a tenant that signs in through an identity provider there is no password here: it is managed by the provider. |
| **Notifications** | **What I receive**: for each kind, in the app and by **Email** (**Never**, **At once**, **One summary a day**); your **Email address**. |
| **Appearance and language** | **Mode** (**Light**, **Dark**, **Automatic (like the system)**), **High contrast**, **Language**, **Sidebar** (**Open at start**) and **Apps in the sidebar** (the ones turned off stay in Home and in the search). The theme is chosen by whoever manages the tenant. |
| **My tenants** | Your home tenant and the tenants where you are a guest, with your role; **Open** one. |
| **Usage** | **Your items** and the space you use; **What is left in the tenant** when the tenant has quotas. |
| **Keys** | Your personal keys of the outside services the installed plugins use (each says which plugins use it): they apply only to you, and after saving only the last four characters show. |

Your preferences follow you on every device.

## Search

Press `Ctrl K` or `/` (or click the search box) and type.

- The results are grouped: **All**, **Pages**, **Apps** and one pill per app with the number of results.
- Items are found by their title and by the text of their fields, also by the beginning of a word.
- You only find what you can see: items not shared with you, items in the trash and apps turned off do not
  appear.
- Arrows to move, `Enter` to open, `Esc` to close. With the field empty: **Recent searches**.

## Keyboard shortcuts

Outside the fields where you type (`?` shows the list):

| Keys | Does |
|---|---|
| `Ctrl` `K` or `/` | Search everywhere |
| `?` | Keyboard shortcuts |
| `G` then `H` | Go to the Home |
| `G` then `N` | Go to the notifications |
| `G` then `A` | Go to your account |
| `G` then `T` | Go to the trash |

## Accessibility

- The interface follows WCAG 2.1 AA: it works with the keyboard and with screen readers, and every theme
  is checked for contrast.
- **High contrast** (Account › Appearance and language, or the mode menu in the top bar) darkens texts and
  borders, thickens the focus ring and underlines links, with every theme; the apps follow it too.
- The **Guided tour of this page** (Help) explains the main pages step by step; **Next**, **Back**, **Skip
  the tour**, arrows and `Esc` work.
