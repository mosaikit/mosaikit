# 0038. Permissions declared by extensions, granted through profiles

- Status: accepted
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

### Refined on 2026-10-13

Answers of the maintainer to the review of the extension API (pull request #42), before acceptance:

- The calling extension passes its identifier in every call; the kernel checks it against an
  installed extension and its manifest.
- Wherever a permission is named outside its extension (profiles, answers of the API) it has one
  qualified identifier, `<extension>:<permission>`.
- The administrators of the organization hold every permission implicitly; guests hold none unless
  granted explicitly, through a group or a personal exception.
- The apps per role (MK-030) move onto permissions in the implementation.

### Apps on permissions (2026-10-13)

Every app of an extension has a permission, `<extension>:use-<app>`, that the kernel declares for
it. The organization keeps switching each app on or off and chooses whether everyone sees it or
only the people who hold its permission; the second replaces "for the administrators only", which
keeps its effect because administrators hold every permission. No extension has to change and no
installation changes behaviour, except that an app set for members only before is now seen by
guests too.

## Consequences

- The apps per organization and role (MK-030) become a special case of permissions.
- Administrators see, per app, which permission comes from where.
