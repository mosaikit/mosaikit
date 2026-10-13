# 0040. Accounts in Keycloak, and one emergency administrator account

- Status: proposed
- Date: 2026-10-13
- Deciders: Massimo Antonini

## Context and problem statement

In the server edition people sign in through the Keycloak realm of their organization (ADR-0011),
but local accounts with passwords kept by the kernel remain. Two places for credentials mean two
policies, two password resets and two attack surfaces; and when Keycloak is down nobody can repair
anything.

## Decision

- In the server edition **every account is a user of the realm** of its organization, also the local
  ones, created and managed by the kernel through Keycloak: the kernel keeps no password.
- The portable distribution, without Keycloak, keeps local accounts in the kernel.
- **One emergency administrator account**, local and outside Keycloak, for when Keycloak does not
  answer: reachable only from the internal network, at its own address, with a second factor; every
  use is audited and notified to the other administrators; switched on and off only in the
  configuration of the installation (MK-064).

## Consequences

- Migration: existing local accounts move to the realms of their organizations.
- MK-012 keeps its acceptance that sign-in survives an unreachable Keycloak, through the emergency
  account only.
