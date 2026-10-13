# 0039. A console with a sidebar for work, organization and platform

- Status: accepted
- Date: 2026-10-13
- Deciders: Massimo Antonini

## Context and problem statement

The shell started as a frame like Teams: an app bar and a top bar. Products built on Mosaikit add
many pages of administration for organizations and for the platform, which do not fit an app bar
and today live in separate hubs.

## Decision

- The shell keeps the app bar for the apps, and gains a **console**: a sidebar grouped as *work*
  (the apps of the person), *organization* (for its administrators: people, groups, apps and
  permissions, usage, activity, configuration) and *platform* (for the platform administrators:
  organizations, people, marketplace, monitoring, audit, system), with settings at the bottom.
- The home is a **launcher** of the apps with widgets contributed by extensions (MK-101).
- The pages follow one model of list, detail and empty state (MK-072, MK-105); the mockup of the
  console is in `docs/design/mockup`.

## Consequences

- Every administration page has one place, by role, instead of hubs with their own sidebars.
- Products add their pages to the groups through extension points, not by forking the frame.
