# Using Mosaikit

Mosaikit is a web application made of *apps* provided by extensions. What you see depends on the
organization you belong to and on the extensions your administrator installed.

## Signing in

1. Open the address of your organization, for example `https://acme.mosaikit.example.org`, or
   the address of the installation.
2. Enter your email address. Mosaikit finds your organization:
   - if it signs in through its own identity provider (Keycloak), you are sent to its sign-in
     page, and come back signed in; the first time, you may be asked to change a temporary
     password;
   - otherwise you enter your Mosaikit password. Tick **Remember me** to stay signed in on that
     browser for 30 days, also after closing it, until you sign out.
3. To sign out, open the menu of your avatar, on the right of the top bar, and choose **Sign out**;
   with an identity provider you are signed out there too. Signing out ends the session on the
   server: a copy of it, kept by anyone, opens nothing any more.

If your organization allows self-registration, choose **Create an account** on the sign-in page:
enter your name, your email address and a password of at least 12 characters. Mosaikit sends you a
mail with a link: open it to confirm your address, then sign in. The link works once, for 24 hours;
**Send the link again** sends a new one.

## Several organizations

If you belong to several organizations, the menu of your avatar shows the organization you are
working in; choose another one there. Organizations that accept only their identity provider are shown but
cannot be chosen after signing in with a password: sign in to them through their identity
provider instead.

## The app bar and the apps

The screen has three parts, as in the collaboration suites people already know:

- the **app bar** on the left, with **Home**, one icon per app you can use and, for platform
  administrators, **Extensions** and **Settings** at the bottom; on a phone it is at the bottom of the
  screen;
- the **top bar**, with the search of apps and pages (type a part of the name, then Enter) and the
  menu of your avatar;
- the **work area**, where the chosen app opens. Its address (for example `/app/notes`) can be
  bookmarked and reloaded. Apps that support it keep what you are looking at in the address, such as
  a folder (`/app/files/folders/42`): copy it to share the view, and the back and forward buttons of
  the browser move between the views. Whoever opens it signs in first, if needed, and then sees the
  same view, with what they are allowed to see.

Home greets you and lists your apps. Apps can talk to each other: an action in one app can update
another one.

Under the apps, Home shows the **widgets** that the installed extensions bring, chosen for your role:
a platform administrator, an organization administrator and a member each see what concerns them.
A widget of an app that your organization turns off disappears at once, without reloading the page.
The sign-in page shows, under the form, the widgets that extensions make public: that is what
visitors without an account see of the installation.

If an app cannot be loaded, the home page says how many extensions failed; tell your administrator,
who sees the reason in the extension list.

Apps that list items share the same page: filters in a column on the left (on a narrow window,
under the **Filters** button, which shows how many are active), the name and count at the top, and,
when you select items, the actions on the selection. You can switch between cards and rows. An
empty panel says why: nothing yet, nothing matching the filters, a failed request, no network or no
access, with what to do. Drag the edge of a list pane, or focus it and use the arrow keys, to make
it wider or narrower: the app remembers the width in this browser.

## Mosaikit as an app

Mosaikit can be installed on a computer or a phone, and then opens in its own window, without the
bar of the browser:

- Chrome and Edge: the install icon at the end of the address bar, or **Install Mosaikit** in the
  menu;
- Safari on iPhone and iPad: **Share**, then **Add to Home Screen**;
- Chrome on Android: **Install app** in the menu.

Without network the app still opens and says that you are offline: what you see may not be up to
date, and the apps need the network to read and save data. This needs the address of the
installation over HTTPS (or `localhost`).

## Teams

A team is a group of people of the organization, with owners and members (MK-032). Whoever creates
a team owns it, and adds or removes people; a **public** team is listed to everyone of the
organization, who can join it, a **private** one only to its people. An owner can also add a
**guest**: a person of another organization with an account on this installation. A guest signs in
with their password, chooses the organization, and sees only the teams where they were added and
what the apps share with them or allow them through their teams. What an app shares with a team is read by its people and by no one
else, not even the administrators. Out of their last team, a guest is no longer in the
organization.

### The app Teams

With the app **Teams** installed, every team has the channel **General** and the channels its
people add: a standard channel is for the whole team, a **private** one for the people its creator
adds, chosen among those of the team. Write a post in a channel, answer it with **Reply**, react
with an emoji. Write `@name@example.org` to mention a colleague, or `@team` for everyone who can
read the channel: they find it in **Activity**, and opening the notification opens the channel.
Posts appear at once for whoever has the channel open. Who leaves a team, or a private channel, no
longer reads its posts.

Each channel has the tabs **Posts** and **Files**. Under **Add a tab**, choose an app that offers a
tab, such as a list or a map, and every member of the channel sees it. When that app is turned off
for the organization, its tab says it is unavailable, and the rest of the channel works on.

### The app Chat

With the app **Chat** installed, start a chat with one or more colleagues of the organization:
write their addresses under **New chat**, and a name for a group if you like. The chat with one
person is always the same one. Enter sends a message, Shift+Enter starts a new line. Below the
messages you see who is typing and who has read your last message. Every message also reaches
the others in **Activity**; turn the kind **message** off in your settings if you prefer. Apps can
post cards in a chat, with buttons that act as you when you choose them.

## Sharing

What you create in an app, such as a document, a dashboard or a memo, is yours: nobody else of the
organization sees it, except its administrators, until you share it (MK-055). Apps that support it
have a **Share** button, which opens the same dialog in every app:

- **Who has access** lists the people, teams and links that have it, each with its level; change a
  level from the list, or **Remove** an access.
- **Share with** gives access to **a person** (by email address), **a team**, **everyone in the
  organization** or, when the app allows it, **everyone, also without an account**, at a level the
  app defines, such as View or Edit. Sharing again with the same person or team changes their level.
- **Link** makes an address that opens the resource for whoever has it, also without an account,
  at a level that never lets them change it, until the day you choose (at most 30 days unless the
  installation sets otherwise). Add a password if you like: they will be asked for it. The address
  is shown only once: copy it and give it to the people you choose. Removing the link makes it stop
  working at once: whoever opens it then reads that the link does not exist.
- The dialog says who can share: who owns the resource, the people with its highest level and the
  administrators of the organization; the others see their level and who to ask.
- **Folders and what they hold.** In apps whose resources sit inside others, such as files in
  folders, an app may let an access to a folder reach everything in it, sub-folders included
  (MK-136). Your level on a file is then the highest of your own and of yours on each folder above
  it: who can open a folder opens, downloads and finds its files, with the links they make too.
  Under **Access from** the dialog lists, for each folder above, who owns it and who it is shared
  with; change those accesses on the folder itself. Whoever has the highest level on a folder shares
  what is inside it. Removing an access to a folder takes effect on everything in it at once.

Whoever opens a link sees the page of the installation with the resource, as the app shows it to
links; an app that cannot show it there asks to sign in.

## Trash

What you delete in an app that uses the trash goes to **Trash**, in the menu of your account, with
what was inside it, such as the files of a folder (MK-095). It stays there for the retention of the
installation, 30 days unless the administrators chose otherwise: the page says when each resource is
deleted for good. Meanwhile nobody opens it, not even through its links or shares.

- **Restore** brings it back where it was, with what went with it, its shares and its links. A file
  that went with its folder comes back with the folder; one whose folder is in the trash comes back
  once the folder is restored.
- **Delete for good** deletes it at once, with what went with it: it cannot be restored any more.

You see what you own. The administrators of the organization also see, with **Show the trash of
the whole organization**, what everyone deleted, and what belongs to the organization, and restore
or delete it the same way.

## Tags

Apps that support it let you label what you create with your own words, such as `garden` or
`spring plans` (MK-097). The tags are the same in every app: while you type one, the app suggests
the tags already used in the organization, the most used first, and a list filtered by one or more
tags shows what carries any of them. Tags are kept in lowercase, each once, at most 20 on a
resource. You see the tags of what you may open, and the suggestions come only from those; to
change the tags of something you need a level that lets you edit it.

## Favorites

Mark what you return to as favorite, in the app where you see it, often with a star (MK-094):
**Favorites**, in the app bar, lists your favorites of every app, the last marked first. Choose one
to open it in its app; **Remove** takes it out of the list. What you can no longer open, because it
was deleted, moved to the trash or its access was taken away, leaves the list by itself. When the app of a favorite is
turned off in the organization, the favorite stays, marked as not available, and opens again when
the app comes back.

## Activity

**Activity**, at the top of the app bar, collects what the apps tell you: a mention, a task, a
reminder. The number on its icon is what you have not read yet; it changes at once when something
arrives. Choose a notification to open what it is about; **Mark all as read** clears the list. In
**Settings**, under **Notifications**, untick the kinds you do not want to receive.

## Your settings

Open the menu of your avatar and choose **Settings**:

- **Appearance**: as the device (light or dark), light, dark or high contrast;
- **Theme**: the default of the installation, or another theme it offers (for example the one for
  public administrations);
- **Language**: English or Italian. The shell, and the apps that follow the language, change at
  once;
- **Organization**, if you belong to several: the apps reload for the one you choose;
- **Apps in the app bar**: untick the apps you do not use; the apps your organization pinned stay;
- **Sessions**: where you are signed in, with the browser and system, the address, when you signed
  in and when the session was last used; **This browser** marks the one you are using. **End
  session** signs that browser out at once, and it is no longer remembered; on this browser the
  button is **Sign out**. End any session you do not recognize, then change your password;
- **Access keys**: keys for your scripts and other programs, which cannot use the session of the
  browser (see below);
- the sections that apps add, such as their own preferences.

Your choices are kept with your account: you find them at the next sign-in, on any device.

A session of the shell ends after 8 hours without activity, and after 24 hours in any case;
**Remember me** then signs you in again on that browser. An administrator can end your sessions by
suspending your account or removing you from an organization.

### Access keys

A script, a command-line tool or an MCP client calls the platform with a personal access key
instead of your password. In **Settings**, under **Access keys**, give the key a name you will
recognize (for example "Nightly export"), choose the organization it acts on and when it expires
(at most 365 days, unless your administrator chose otherwise), and tick **Allow changes (write)**
only if the program must change data: without it, the key only reads. Choose **Create key**: the key
is shown once, with a **Copy** button. Copy it and keep it like a password; choose **Done** and it
is never shown again, not even to you.

The program sends the key in the `Authorization` header:

```bash
curl -H "Authorization: Bearer mk_..." https://mosaikit.example.org/api/v1/accounts/me
```

A key acts as you, in its organization, with the rights you have there at the time of each call,
never more. It cannot sign in to the shell, nor create other keys. The list shows each key with its
first characters, when it was created and last used, and when it expires; **Revoke** stops it at
once, while your sessions go on. If you are suspended or leave the organization of a key, the key
stops working and stays revoked. The audit log records the first use of a key in each hour and
every call it refuses. A key used by an MCP client needs **Allow changes (write)**: MCP calls are
all sent as changes, even those that only read.

## The assistant

When the installation has an assistant, the home page shows it: ask in your language, for example
"which activities are still open?" or "close road A1 for works". It uses the apps with your
permissions in the current organization. It can read at once, but every change it proposes waits
under **Pending actions** until you confirm it. The kernel does not keep the conversation.

## Actions proposed by assistants

An assistant or an MCP client connected with your account can read data through the apps, but it
cannot change anything by itself. When it proposes a change, the home page shows it under
**Pending actions**, with its arguments: **Confirm** runs it, **Reject** discards it. A proposal
expires after 15 minutes. Only you see your proposals, and only in the organization where they
were made. Every proposal and decision is recorded in the audit log.

## Your data

Each app keeps its data in the organization you work for. Data of other organizations are never
visible.
