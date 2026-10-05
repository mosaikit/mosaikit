# 0033. Collaboration on the real-time channel and the data API, without brokers or backends

- Status: accepted
- Date: 2026-10-02
- Deciders: Massimo Antonini
- Refines [ADR-0027](0027-teams-channels-and-chat.md), [ADR-0028](0028-real-time-activity-and-notifications.md)
  and [ADR-0024](0024-hosting-on-github.md) (repositories)

## Context and problem statement

Phase F2 brings chats, teams with channels, activity and presence (ADR-0027, ADR-0028). Done as
planned, it needs a broker for the events, Java backends with their schemas for `app-chat` and
`app-teams`, and two more repositories, each with its own build and tests. One person works on
Mosaikit, and the way of working is lean (ADR-0031).

## Decision

- **One channel, on PostgreSQL.** The WebSocket of the shell (`/api/v1/live`) receives the events
  that the kernels of an installation send with PostgreSQL `NOTIFY` in the transaction of the
  request, so that an event leaves only if the change commits; each kernel `LISTEN`s on a connection
  of its own. A NATS implementation of the same bus comes when an installation runs several kernels
  under load; nothing else changes then.
- **Small events, rights at the source.** An event says what changed (`documents.<plugin>.<collection>`
  with the identifier of the document, or a topic of a plugin); the page reads the change through
  the API, with the rights of the person. The kernel checks every subscription.
- **Collaboration as frontend-only plugins.** `app-chat` and `app-teams` are plugins without a
  backend: their messages and posts are documents of the data API, which gains sharing with a team
  or with some people, enforced by row-level security; mentions and replies use the notifications of
  the kernel (MK-038). Sharing with a team came with MK-032; a guest is a member of the organization
  with the role `organization-guest` only, kept by the kernel to the teams where they were added.
  A private channel is a group of the team, a private team inside it whose people are people of
  the team (MK-034): the same sharing and policy apply, and leaving the team leaves its groups.
  Sharing with some people comes with the chats (MK-036).
- **In this repository for now.** `app-chat` and `app-teams` live in `plugins/` until their API is
  stable, so that their end-to-end tests run with the changes of the kernel they need; they move to
  repositories of their own (ADR-0024) afterwards.

## Consequences

- Nothing to install or operate for real time; an installation with several kernels works as soon
  as they share the database.
- A plugin publishes events through `LiveEvents` of `kernel-api` (Java) or receives them through
  `context.live` and `collection.onChange` (frontend).
- The data API and its row-level security become the shared foundation of collaboration; queries
  that it cannot answer (search, counts across collections) come with search (MK-040).
