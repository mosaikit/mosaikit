# 0038. Permissions declared by extensions, granted through profiles

- Status: proposed
- Date: 2026-10-13
- Deciders: Massimo Antonini

## Context and problem statement

Roles alone (platform administrator, organization administrator, member) are too coarse: an
organization wants some members to build and others only to look, per app. A fixed list of roles per
extension would multiply roles.

## Decision

- **Three roles** stay: platform administrator, organization administrator, member.
- Extensions **declare their permissions** in the manifest (for example "create a dashboard", "run a
  process"). A permission added by an updated extension arrives switched off.
- **Profiles** are named sets of permissions that administrators assign to people; groups and
  personal exceptions **add** permissions, never remove them (MK-056).
- Permissions say what a person may do; sharing (ADR-0037) says on which resources. The backend checks
  both at every request; the interface uses them only to hide what is not available.

## Consequences

- The apps per organization and role (MK-030) become a special case of permissions.
- Administrators see, per app, which permission comes from where.
