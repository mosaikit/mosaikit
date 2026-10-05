# Using Mosaikit

Mosaikit is a web application made of *apps* provided by plugins. What you see depends on the
organization you belong to and on the plugins your administrator installed.

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
   with an identity provider you are signed out there too.

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
  administrators, **Plugins** and **Settings** at the bottom; on a phone it is at the bottom of the
  screen;
- the **top bar**, with the search of apps and pages (type a part of the name, then Enter) and the
  menu of your avatar;
- the **work area**, where the chosen app opens. Its address (for example `/app/notes`) can be
  bookmarked and reloaded.

Home greets you and lists your apps. Apps can talk to each other: an action in one app can update
another one.

If an app cannot be loaded, the home page says how many plugins failed; tell your administrator,
who sees the reason in the plugin list.

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
what the apps share with them. What an app shares with a team is read by its people and by no one
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
- the sections that apps add, such as their own preferences.

Your choices are kept with your account: you find them at the next sign-in, on any device.

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
