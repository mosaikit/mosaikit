<!--
SPDX-FileCopyrightText: 2026 Massimo Antonini
SPDX-License-Identifier: MPL-2.0
-->
# Teams

The app Teams (MK-034): the teams of the person, their channels, and the posts of each channel
with threads, mentions and reactions. A plugin without a backend
([ADR-0033](../../docs/adr/0033-lean-collaboration.md)):

- the teams and their people are those of the kernel (`/api/v1/teams`, MK-032);
- the channels and the posts of the General and standard channels are documents of the data API
  shared with the team (`context.data('posts', { team })`): only its people read them;
- a private channel is a group of the team (`POST /api/v1/teams` with `parent`), and its posts are
  shared with that group only, so that whoever leaves the channel no longer reads them;
- posts, replies and reactions of the others appear at once through the real-time channel;
- `@name@example.org` and `@team` notify the people who can read the channel in their activity
  feed, with a link that opens the channel.

Every channel has the tabs **Posts** and **Files**, and the tabs its people add from what other
plugins contribute to the point `channel.tab` (MK-035), such as the sample To do. A tab whose
plugin is not installed or is turned off for the organization is shown as unavailable, and can be
removed.

Nothing to build: installed from the Plugins page, it is active at once. Its end-to-end tests are
`e2e/tests/21-channels.e2e.ts`.
