# Mockup vs product

Screen-by-screen comparison of the mockup (`docs/mockup`, as of `d928843`) with the shell
(`ui/host/src/app`) at the same commit.

**Method.** Every mockup screen was opened headless for the three roles, and its headings, buttons and
text were dumped: 51 screens in all (20 Administrator, 23 Tenant Manager, 8 User). Each was compared
with the matching product page from the QA walkthrough.

- Screenshots of the mockup: `qa-screens/mockup/` (outside git).
- Screenshots of the product: `qa-screens/<check>.png`.
- «Intentional» means the difference is covered by `docs/refactoring-ui.md` or by a recorded phase
  decision.

The phase 10 layouts added to the mockup later (`85c7c9d`, `layouts.js`) are not in this comparison:
they are a plan, not yet in the product.

## Summary

| Screen (mockup id) | Role | Verdict | Main gap |
|---|---|---|---|
| `login` | all | different | no «Support» / «Administrator access» links; tenant panel shows the platform tagline |
| `platform` | A | matches, minor | «PLATFORM» badge has no «1 near limit» counter |
| `tenants` | A | **missing parts** | no Show pills / filters (Active, On trial, Suspended, Sign-in): only a search |
| `tenant/details` | A | **missing parts** | no Contact person, Registration / VAT fields; tab «Users and managers» vs «People» |
| `gusers` | A | different | fewer filters and columns (no «Signs in with», no Export); product has Home tenant / Tenants / Status / Last sign-in |
| `marketplace/installed` | A | matches, minor | Signature shows the raw key; Catalog card shows the plugin id |
| `mpmod/overview` | A | matches, minor | What it asks without the permissions |
| `monitoring/status` | A | **missing parts** | fewer services (no kernel instances, relay, search index); no side panel for a row |
| `audit` | A, M | different | mockup facets with counts (Who / What); product uses selects |
| `system/email` | A | matches | — (product failure on test, see QA F4) |
| `themeedit` | A, M | matches | — |
| `space` | M | matches | Tenant overview |
| `members/people` | M | **missing parts** | no «Import from CSV»; «Invite people» only inside Pending |
| `splugins` | M | different | no «Ask for a plugin», no State filter; product has a Kind filter and switches |
| `shares` | M | matches | — |
| `usage/quotas` | M | intentional | Automation minutes / AI credits replaced by Storage, People, Items |
| `activity` | M | different | as `audit` |
| `config/security` | M | matches | — |
| `module` | M | different | title «Access and permissions · Notes» vs «Permissions · Notes»; no custom columns |
| `group/settings` | M | matches | — |
| `person/profile` | A, M | matches, minor | Activity tab shows only actions by the person |
| `home` | U | **missing parts** | no «Pick up where you left off», «Due soon», «For you», no greeting |
| `account/profile` | all | **missing parts** | read-only: no profile image or editable details |
| `inbox` | all | different | kind filter chips → selects |
| `trash` | M, U | different | App facets with counts → select |
| `dlg-search` | all | matches, minor | «Tenant 0» pill for a User; stale results (QA F3) |
| `dlg-share` | M, U | different | levels Owner / Manage / Edit / Use / View → Read / Write / Manage |
| `dlg-create` | M, U | matches | — |
| `dlg-invite` | M | different | bulk invite of several addresses with groups → one address at a time in Pending |
| `dlg-roles` | A, M | matches | — |
| `dlg-new-group` | M | matches | — |
| `dlg-remove-person` | M | matches | owner question only when the person owns items |
| `dlg-confirm` | A, M | matches | — |
| `dlg-new-organization` | A | matches | «New tenant» wizard |
| `dlg-new-admin` | A | matches | — |
| `dlg-move-home` | A | matches | — |

Totals: **36 distinct screen ids**:

- 19 match;
- 10 differ in form;
- 6 lack parts of the mockup;
- 1 is an intentional difference.

The system sections are counted separately below.

## Missing in the product (ranked)

1. **Home of the User** (`home`): «Pick up where you left off», «Due soon», «For you» and the greeting
   are missing. The product has Your space, Shared by me and Apps. This is the first screen most people
   see.
2. **Manage › People** (`members/people`, `dlg-invite`): «Import from CSV» and the multi-address
   «Invite people» dialog, with groups, are missing. Invite is one address at a time, only in Manage ›
   Pending.
3. **Account › Profile** (`account/profile`): no profile image and no editable details; the page is
   read-only for everybody.
4. **Tenants list** (`tenants`): the Show pills (Active, On trial, Suspended) and the Sign-in filter are
   missing.
5. **Tenant details** (`tenant/details`): the Contact person and Registration / VAT fields are missing.
6. **Monitoring** (`monitoring/status`):
   - the services kernel instances, relay and search index are missing (the product lists 6);
   - the side panel for a row is missing (product: an empty «—» line, against refactoring-ui §9).
7. **Tenant plugins** (`splugins`): «Ask for a plugin» and the State filter are missing.
8. **People of the platform** (`gusers`): the «Signs in with» column/filter and Export are missing.
9. **Login** (`login`): the «Support» and «Administrator access» links are missing.
10. **Bar**: the «1 near limit» counter next to the «Platform» badge is missing.

## Different

- **Share levels.** The mockup has Owner / Manage / Edit / Use / View. The product names them
  differently in four places:
  - Read / Write / Manage in Share;
  - view / edit / manage in the guide;
  - See / Edit in access requests;
  - Can view / edit / manage in permissions.

  One vocabulary is needed. The «Use» level of the mockup has no counterpart in the product.
- **Filters.**
  - The mockup uses facet lists with counts: Log Who / What, Trash App, Inbox kind chips.
  - The product uses native selects. They work but do not show counts.
- **System sections.**
  - Mockup: Addresses, Security, Email, Identity and appearance, Backup.
  - Product: Passwords and sessions, Notifications, Retention, Quotas, Embedding, Email, Identity and
    appearance, Backup, Administrators, Keys.
  - The product split is finer and follows refactoring-ui §5 and §6. «Notifications kept, in days» sits
    in Notifications, not Retention.
- **Module permissions** (`module`):
  - the title reads «Access and permissions · Notes» instead of «Permissions · Notes»;
  - the mockup has custom columns per profile.
- **Admin tenant tab** «Users and managers» vs the sidebar and mockup «People».
- **Admin sidebar** «Tenant» (singular) vs mockup «Tenants».
- **Quota in the sidebar.**
  - The mockup shows a small widget at the foot.
  - The product shows an alert icon only when near the limit. This follows refactoring-ui §6 («only an
    alert near the limit, not a fixed box»), so the product is right.

## Intentionally different

| Screen | Difference | Source |
|---|---|---|
| `usage/quotas` | Automation minutes and AI credits not shown; Storage, People, Items instead | phase 6 decision (no automation or AI metering in the kernel) |
| sidebar quota | alert, not a fixed box | refactoring-ui §6 |
| person menu | no Trash for the Administrator | refactoring-ui §2 |
| `login` | local accounts or OIDC, never both | refactoring-ui §11 |

## Product extras (not in the mockup)

- **Platform level**
  - Platform People with suspend and move.
  - System › Administrators with TOTP.
  - System › Keys of outside services, shared with tenants.
  - Embedding.
  - Restore an item from a backup (FU-B).
- **Plugins**
  - Extension tabs in their own sandboxed frame (FU-B).
  - Kind filter and switches.
  - Uninstall / Turn on in the ⋯ menu.
- **Help and guidance**
  - Guided tour per page.
  - Keyboard shortcuts dialog.
  - «What is new».
- **Notifications**: the bell panel with a gear and per-kind channels.
- **Access requests**: a page (`#/t/<tenant>/requests`), but no menu entry for a User.
- **Sign-in**: maintenance mode with the planned notice.
