# Mosaikit — Plan for the common plugins

The official plugins (`mosaikit-plugins`) are the business card of Mosaikit: they must be useful and, above
all, attractive. This plan improves the existing ones (functional completeness and look) and adds a set of
common plugins that serve very different products (chat, calls, task management, polls, ...).

Status: proposal, 2026-11-11. Estimates are working days of one developer with the existing code base
(agent-assisted work shortens the coding, not the decisions, the reviews or the screenshots). The order of the
phases after phase 8 is decided later by the maintainer.

## 1. Where we are

| Plugin | UI lines | Gap |
|---|---|---|
| Tasks | 79 | Generic `mountCrud` (list + 3-column board). No assignee field, description, subtasks, labels, projects, recurrence, drag and drop. |
| Contacts | 68 | A plain table. No avatars, multiple emails/phones, address, birthday, tags, vCard/CSV, detail card. |
| Notes | 443 | Plain text only. No checklist, markdown, pin, archive, attachments, text search. Most polished one (post-its, tags). |
| Maps, Sites | ~530, ~740 | Lists only: no thumbnails, preview or card view. |
| Files | 1645 | The most complete. Thumbnails, gallery, recents and favourites are missing. |

Structural limits:

- `FieldKind` is `text | number | bool | date | choice`: no multi-value, relation, person, rich text, colour.
- Look: one base stylesheet (`ui/plugin-api/src/style.css`), only 7 empty-state illustrations (`ArtName`),
  schematic SVG screenshots in each `media/`.
- The kernel has **no real-time service** (architecture: presence is just data the plugin passes). Chat, calls
  and live co-editing need one.

Principle (CLAUDE.md): the kernel stays domain-agnostic. What these plugins need from it is asked as a
generic request to the kernel (phase 5), never as a change for one product.

## 2. Phases

Sizes: S ≤ 3 days, M 4–7, L 8–15, XL > 15.

| # | Phase | Content | Effort |
|---|---|---|---|
| 0 | Design language | Design review of the shell and plugin tokens (spacing, radius, elevation, motion, type scale); one reference mockup for list, board, card, detail, dialog; dark and light checked. Output: rules added to `docs/refactoring-ui.md`. | S · 3 d |
| 1 | Shared UI kit (`@mosaikit/plugin-api`) | New components, all accessible, themed, i18n-ready, unit-tested: `avatar` (initials, colour, image, stack), `card`, `kanban` (drag and drop, keyboard moves), `popover`/`menu`, `dialog`, `toast`, `skeleton`, `progress`, `tabs`, `segmented`, `tagInput`, `personPicker` (on `DirectoryApi`), `datePicker`, `richText` (markdown editor with toolbar), `timeline`, micro-animations (reduced motion respected). 12 new empty-state illustrations. Additive keys of API 1 (no bump, CHANGELOG). New field kinds if the kernel allows: `multi`, `person`, `color`, `longtext` (kernel request, optional). | L · 12 d |
| 2 | Tasks 2.0 | Own UI over `mountCrud`: assignee, description (rich text), subtasks, labels, projects, recurrence; views Today / Next 7 days / Calendar strip / Board with drag and drop / List with grouping; quick-add line (`buy milk tomorrow !high`); progress rings; KPI; real screenshots. Migration `003`. | L · 10 d |
| 3 | Contacts 2.0 | Card grid and A–Z list, avatars with colour, detail panel, multiple emails/phones/addresses, birthday, tags, company link, vCard and CSV import/export, duplicate finder, quick actions (mail, call, copy). Migration `003`. | M · 7 d |
| 4 | Notes 2.0 | Markdown editor (phase 1), checklists, pin, archive, attachments from Files, full-text search, note linking `[[...]]`, templates, export (md, pdf). Keep post-it view as one of the views. Migration `003`. | M · 7 d |
| 5 | Kernel request: real-time channel | Generic service: authenticated channel per tenant and topic (SSE or WebSocket), ACL-checked on a resource, fan-out in PostgreSQL (`LISTEN/NOTIFY`) and in-process on SQLite desktop; presence as data with TTL; `msk.realtime` in the plugin API; limits and quotas. Written as a request with a design note first (architecture §8 addition), then agreed with the maintainer. Also WebRTC signalling relay (small, built on the same channel). | L · 12 d |
| 6 | Chat | Channels (public, private), direct messages, threads, mentions, reactions, edit/delete, read markers, typing and presence, attachments (Files), link previews (`embeds`), notifications (`msk.notify`), search, retention. Data on PostgreSQL with RLS / SQLite; UI with virtual list. | XL · 18 d |
| 7 | Call / Meet | Two options, chosen in a short spike. A: embed of an external meeting service through `frame_src` + `[[embeds]]` (rooms tied to a resource, join link) — S/M. B: own WebRTC (mesh up to ~6, TURN configuration, screen share, mute, device choice, in-chat call button) on the signalling of phase 5 — L. Plan assumes A first, B as extension. | A: M · 5 d, B: L · +12 d |
| 8 | Live co-editing | CRDT (Yjs-like) document sync on the real-time channel for Notes 2.0 (and later Wiki): cursors and selections of the people present, offline merge, snapshots and history in the plugin data, ACL write/read respected. | XL · 15 d |
| 9+ | Other plugins | Order decided later (list in §3). Each one is one phase, sized below. | see §3 |

Total of phases 0–8 (call with option A): about 90 working days. With option B: about 102.

## 3. Candidate plugins for phase 9 onwards

**Order decided by the maintainer on 2026-11-12:** Announcements, Bookmarks, Snippets, Polls, Surveys / Quiz, Approvals, Dashboard, Forms, Projects, Calendar, Whiteboard. Not in this round (kept below as candidates): Timesheet, Expenses, Inventory / Assets, Booking, Wiki, CRM lite, Tickets / Helpdesk, polish of Maps, Sites and Files. Each plugin is one phase: built, tested, documented, with its card, then one commit.

Sizes as above; all use only what the kernel has today unless noted. Each one comes with Italian and Spanish texts,
KPIs, empty state, manual checks (`P<n>-<nn>`) and their Playwright twin.

| Plugin | What | Effort |
|---|---|---|
| Polls | Single/multiple choice, deadline, anonymous, live results with charts, public link | M · 6 d |
| Forms | Form builder, public link for answers, results table, CSV export | L · 10 d |
| Calendar | Month/week/day, events, invitations, recurrence, feeds tasks due dates | L · 12 d |
| Projects | Projects, boards, milestones, sprints, on top of Tasks | L · 10 d |
| Wiki | Page tree in markdown, versions, search, links; co-editing after phase 8 | L · 10 d |
| Tickets / Helpdesk | Requests with status, priority, SLA, comments, public intake form | L · 12 d |
| CRM lite | Companies, deals, pipeline board, on top of Contacts | L · 10 d |
| Timesheet | Hours per project, weekly grid, approval, CSV/KPI | M · 6 d |
| Expenses | Claims with receipts (Files), approval, totals | M · 6 d |
| Approvals | Request/approve flows using schedules and `run_commands` | M · 6 d |
| Booking | Rooms and resources, slots, public booking link | M · 7 d |
| Inventory / Assets | Items, status, assignee, QR labels | M · 6 d |
| Dashboard | Widgets built from the KPIs of all plugins | M · 6 d |
| Announcements | Notice board with read confirmation | S · 3 d |
| Bookmarks, Snippets | Link and text collections with tags and sharing | S · 3 d each |
| Whiteboard | Shared board; live after phase 5 | L · 12 d |
| Surveys / Quiz | Scored questions, results | M · 6 d |
| Maps, Sites, Files polish | Thumbnails, preview, card view, gallery, recents | M · 6 d total |


### 3b. What each candidate is for

Ordered as in the table above (smallest first). "Uses" are the typical cases the plugin is built around.

- **Announcements.** A notice board for the tenant: a manager publishes a notice, people see it on their Home and confirm they read it, and the author sees who has not yet. *Uses:* office closures, new procedures, safety notices, "read and acknowledged" evidence for policies.
- **Bookmarks.** A shared collection of web links with a title, a note and tags, shareable with people and groups. *Uses:* the team's reference sites, a customer's portals, links collected for a project or a course.
- **Snippets.** A collection of reusable texts and pieces of code with tags and copy in one click, shareable. *Uses:* standard replies, contract clauses, commands and configuration fragments the team keeps repeating.
- **Polls.** A quick question to a group: single or multiple choice, a deadline, anonymous or named votes, results with a live chart, and a public link for people outside the tenant. *Uses:* choosing a date for a meeting, a lunch venue, a quick opinion of a team, a vote of an association.
- **Surveys / Quiz.** Series of questions with answers that are scored, with the results per person and per question. *Uses:* customer satisfaction, internal climate survey, onboarding or safety quizzes with a pass mark.
- **Timesheet.** A weekly grid where people enter hours per project, a manager approves it, totals and CSV export, indicators for the hours of each project. *Uses:* billing of a consulting team, cost of a project, attendance of part-time staff.
- **Expenses.** A claim with the amount, the category and the photo or file of the receipt (kept in Files), approval by a manager and totals by person and by month. *Uses:* travel and meal reimbursements, small purchases of a department.
- **Approvals.** A request with a flow of approvers (one, in sequence or any of a group), reminders by schedule and a history of who decided what and when. *Uses:* purchase requests, holidays, access requests, sign-off of a document before it goes out.
- **Inventory / Assets.** A list of things the organisation owns (laptops, tools, keys, furniture) with status, who has it, where it is, a QR label to print and scan, and the history of who held it. *Uses:* IT equipment handed to staff, tools of a workshop, a loan desk.
- **Dashboard.** A page the person arranges from widgets that show the indicators (KPIs) every plugin already exposes: open tasks, notes by tag, hours of the week. *Uses:* the morning view of a manager, a wall screen for a team, a report of the tenant without a spreadsheet.
- **Booking.** Rooms and resources with their open hours, slots that people book, conflicts refused, and a public booking link for visitors. *Uses:* meeting rooms, a shared vehicle, appointments with a consultant or a clinic, a sports facility.
- **Forms.** A form builder (text, choices, dates, files, required fields), a public link to collect answers from anyone, a table of the answers and CSV export. *Uses:* registrations to an event, requests of citizens, order forms, collecting data from outside people without giving them an account.
- **Projects.** Projects with boards, milestones and sprints built on top of Tasks: the tasks stay Tasks, the project gives them a plan and a progress bar. *Uses:* a product release, a construction site, a campaign with deadlines and owners.
- **Wiki.** A tree of pages written in Markdown, with versions and who changed what, links between pages, search, and live co-editing as in Notes. *Uses:* team handbook, procedures, onboarding guide, project documentation.
- **CRM lite.** Companies and deals on top of Contacts: a pipeline board (lead, offer, won, lost), amounts, next steps, notes and totals by stage. *Uses:* a small sales team, a professional keeping track of offers, fundraising for an association.
- **Calendar.** Month, week and day views, events with people invited from the tenant, recurrence, reminders, and the due dates of Tasks shown next to the events. *Uses:* the team's agenda, shared holidays and absences, deadlines and meetings in one place.
- **Tickets / Helpdesk.** Requests with status, priority, assignee, SLA times and comments, and a public intake form so people outside the tenant can open a ticket and follow it. *Uses:* internal IT support, customer support, reports of faults or problems from citizens.
- **Whiteboard.** A shared free-form board with notes, shapes, connectors and drawing, edited live by several people. *Uses:* brainstorming, workshops, diagrams and flows drawn together in a call.
- **Maps, Sites, Files polish.** Thumbnails and previews, a card view, a gallery and recent items in the three existing plugins. *Uses:* finding a file or a map by its picture, showing a set of images, going back to what was opened last.

Plugins that need a kernel request before they can be built: Polls, Forms and Booking (Polls and Forms are in the order above: the request for public write commands is made when Polls starts) (public commands that **write**: today `[[public_commands]]` is read-only).

## 4. Rules for every phase

- UI rules of `docs/refactoring-ui.md`; empty lists and pages: centred illustration, title, text, primary action.
- English by default, Italian and Spanish translations; no text outside the i18n tables.
- Each plugin: version bump, migration with data conversion, KPI, `details`, real screenshots in `media/`.
- **Every plugin of `mosaikit-plugins` is published on the Mosaikit site with a descriptive card**: name, what it does, who it is for, permissions it asks, and, whenever possible, screenshots shown in a carousel (the real ones from `media/`). A new plugin, or a new version that changes its look, is not done until its card on the site is created or updated (the site update follows the GitHub publish plan; never push without the user starting it).
- **The text of the card is `CARD.md` in the plugin folder**: one paragraph that says what the plugin is for and what it does, then `Uses:` and a bullet list with the three most representative cases. The site is rebuilt with `python tools/site-cards.py <clone of mosaikit.github.io>` (cards, pictures, count of plugins); a plugin without `CARD.md` is not finished.
- Targeted tests while working; full e2e and `cargo xtask ci` once before merging; manual checks and Playwright
  twin for each feature; `tests/results/test-results.md` regenerated.
- One commit at the end of every phase, after checks pass; never push. Work in an own xtask worktree.

## 4b. Rules for every change that touches the kernel

The distributions (Geoportal first) run on the same kernel and must not break.

1. Additive only: new keys, tables, commands and field kinds; never a new meaning for an existing key. A new
   key is opt-in and a plugin that uses it declares `[requires] mosaikit = ">=1.0"`. `[[public_commands]]` stays
   read-only for every plugin that does not declare the new write key.
2. No bump of plugin API 1 (§8.11); an entry in the CHANGELOG of `@mosaikit/plugin-api` and of
   `mosaikit-plugin-sdk`.
3. Database migrations of the kernel are additive (new tables and columns with defaults).
4. `cargo xtask --dist ../geoportal test` passes before the merge of any kernel change.

## 5. Risks

| Risk | Answer |
|---|---|
| Real-time channel is a kernel change | Phase 5 starts with a design note and the maintainer's approval; generic, not tied to a product. |
| Kit grows too large and slows plugins | Components tree-shakeable, each its own module; size budget per plugin UI checked in CI. |
| Rich text and CRDT are costly | Reuse a maintained library inside the plugin UI (checked for licence and size) instead of writing one. |
| Own WebRTC needs TURN and is hard to test | Option A first; B only after a spike with real networks. |
| Look drifts between plugins | Phase 0 rules and the kit are the only source of components; review of screenshots per phase. |

## 6. Progress

| Phase | State |
|---|---|
| 0 Design language | done (tokens in `style.css`, rules in `refactoring-ui.md` §13) |
| 1 Shared UI kit | done, except the optional new field kinds (they need the kernel; not asked yet). Real screenshots of the plugins are still to take |
| 2 Tasks 2.0 | done: quick add, grouped list, board and week with drag and drop, check list, labels, project, repetition |
| 3 Contacts 2.0 | done: cards, A–Z list, tags, birthdays, vCard and CSV, duplicates |
| 4 Notes 2.0 | done: Markdown, check list progress, pin, archive, export. Left for later: attachments from Files, `[[links]]`, templates, PDF export (they need a picker of resources of other plugins) |
| 5 Real-time channel | done for one server: routes, presence, limits, `msk.realtime` (architecture §8.18). Not built: PostgreSQL relay between servers, `rt.publish` from the logic |
| 6 Chat | v1 done: channels shared like any item, live messages with presence and typing, Markdown, replies, reactions, edit and delete, history, rules in a WASM hook. Left for later: a thread panel, @mentions with notifications, attachments from Files, link previews, search, retention, unread markers, direct messages (they need a way to create a channel for two people) |
| 7 Call / Meet | option A done: the Meet plugin (rooms shared like any item, the Jitsi Meet service inside the page, who has the room open), `permissions.media` for the camera and the microphone, a «Start a call» button in Chat. Option B (own WebRTC, TURN credentials) not started |
| 8 Co-editing | done for Notes: Yjs document on the channel `doc`, two or more editors, offline merge after a reconnection, who is editing with you. Left for later: cursors and selections of the others, history and snapshots, notes over 8000 characters, the Wiki (it does not exist yet) |
| Site | done 2026-11-12: the plugins page of the Mosaikit site has a card for each of the 20 official plugins (applications, extensions and layouts with a thumbnail that opens the screenshots as a carousel, languages with the flag); the home shows the number of plugins. Real screenshots instead of illustrations are still to do |
| Languages | done 2026-11-12: Portuguese, French, Dutch, Arabic, Chinese and Russian next to Spanish (shell texts and manifest texts of the official plugins); the page takes its direction from the language (`dir`, right to left for Arabic); coverage test for every language plugin; e2e `22-languages.spec.ts`. The texts inside the pages of the plugins are a separate point: see §7.2 |
| 9.1 Announcements | done 2026-11-12: `com.mosaikit.announcements` 0.1.0: notices with a level and a period, pinned and urgent first, filters Current / Upcoming / Past / All, confirmation of reading with the list of who confirmed (table `acks` that a reader writes, `[[tables]]`), KPI, hook rules; e2e `30-announcements.spec.ts`, checks ANN-01..06 |
| 9.2 Bookmarks | done 2026-11-12: `com.mosaikit.bookmarks` 0.1.0: links with note, tags and favourites, search and tag filter, only http(s), nothing fetched from the sites; e2e `31-bookmarks.spec.ts`, checks BKM |
| 9.3 Snippets | done 2026-11-12: `com.mosaikit.snippets` 0.1.0: texts and code with a kind and tags, list and detail, copy in one click; e2e `32-snippets.spec.ts`, checks SNP |
| 9.4 Polls | done 2026-11-12 for signed-in people: `com.mosaikit.polls` 0.1.0: single or multiple choice, deadline, hidden voters, when results show (always, after voting, after closing), live bars on a real-time channel, KPI; votes are rows a reader writes (`[[tables]]`); e2e `33-polls.spec.ts`, checks POL. **Left for later: voting from a public link by people outside the tenant**: it needs public commands that write (kernel, additive; built together with Forms, then Polls 0.2) |
| 9.5 Surveys | done 2026-11-12: `com.mosaikit.surveys` 0.1.0: questions (choice, multiple, text, 1 to 5 scale), results per question, respondents, CSV export, quiz mode with scores and a pass mark; the answer key lives in a table only the commands read (a reader never receives the right answers before answering); e2e `34-surveys.spec.ts`, checks SUR |
| 9.6 Approvals | done 2026-11-12: `com.mosaikit.approvals` 0.1.0: a request with approvers (any, all or in sequence), computed state, comments, history, live refresh; e2e `35-approvals.spec.ts`, checks APR. Reminders by schedule are left for later |
| 9.7 Dashboard | done 2026-11-12: `com.mosaikit.dashboard` 0.1.0: boards of widgets; the other plugins contribute widgets with `[[contributes]]` to the point `com.mosaikit.dashboard.widget` and a command that answers for the caller only; widgets added to Tasks, Notes, Announcements, Polls, Approvals and Surveys (patch versions); e2e `36-dashboard.spec.ts`, checks DSH |
| Kernel: public commands that write | done 2026-11-12 (before Forms): `[[public_commands]] write = true` and `[[tables]] insert_for = "visitor"`: a visitor of a public link inserts rows into the tables made for visitors, for the item of the link, never update or delete; 10 calls a minute per link; architecture §8.13, devkit, changelogs; tests on both backends. To do with it: Polls 0.2 (vote from a public link) |
| 9.8 Forms | done 2026-11-12: `com.mosaikit.forms` 0.1.0: a form builder (text, long text, choice, multiple, number, date, email), a public link for answers without an account (public command that writes), a table of answers, per-field counts, CSV export; e2e `37-forms.spec.ts` with the public flow in a browser with no session, checks FRM. **Polls 0.2.0** (same day): voting from a public link, `38-polls-public.spec.ts` |
| 9.9 Projects | done 2026-11-12: `com.mosaikit.projects` 0.1.0: board columns, milestones, sprints and progress over the tasks of Tasks, which stay in Tasks (Tasks 0.6.0 adds the commands `for_project`, `set_project`, `add_for_project`, `without_project`, `due_between`); needs PostgreSQL (plugin calls): on the desktop (SQLite) the board says Tasks is unavailable; e2e `39-projects.spec.ts`, checks PRJ |
| 9.10 Calendar | done 2026-11-12: `com.mosaikit.calendar` 0.1.0: month, week and day views, events with recurrence, invitations and answers, due dates of Tasks next to the events, `.ics` export, a Dashboard widget; times are floating local times; no reminders yet; e2e `40-calendar.spec.ts`, checks CAL |
| 9.11 Whiteboard | done 2026-11-12: `com.mosaikit.whiteboard` 0.1.0: notes, shapes, text, arrows, pen, undo, zoom, export; live editing with Yjs on a real-time channel, cursors, saved in the item; unit-tested in a fake host and e2e `41-whiteboard.spec.ts` with two sessions, checks WBD. Not done: arrows attached to objects; two people typing in the same note at the same moment keep one version |

## 7. Open items

### 7.1 Left over from phases 0–8

| Phase | Left for later |
|---|---|
| 1 Shared UI kit | new field kinds of the kernel (multi, person, colour, long text); real screenshots in each plugin's `media/` (they feed the site cards) |
| 4 Notes | attachments from Files, `[[links]]`, templates, PDF export, notes over 8000 characters |
| 5 Real-time | PostgreSQL relay between servers (today a channel reaches the people on the same server), `rt.publish` from the logic |
| 6 Chat | thread panel, mentions with notifications, attachments, link previews, search, retention, unread markers, direct messages |
| 7 Call / Meet | option B: own WebRTC and TURN credentials (after a spike with real networks) |
| 8 Co-editing | cursors and selections of the others, history and snapshots, the Wiki |

### 7.2 Outside the phases

1. **Texts inside the pages of the plugins.** A plugin page draws its own texts: English and Italian everywhere, Spanish only in Tasks, Contacts, Chat and Meet. Files, Maps, Sites and Note review have no Spanish, and the six new languages have no text inside any plugin page: those pages stay in English. To do: add the missing languages to the plugin pages, or, better, point 2.
2. **One mechanism for all languages (platform done 2026-11-12: `lang/ui/<plugin-id>.json`, `context.texts`, `msk.t`, `msk.ownTexts`; adopted by Files, Maps, Static site and Note review; the other plugins still to move).** A language plugin brings a file per plugin (`lang/ui/<plugin-id>.json`, English phrase to translation); the kernel serves it with the texts of the language, the shell passes it to the plugin page in its context and the plugin API exposes `msk.t(phrase)`. Additive changes to the kernel, the shell and the plugin API, then each plugin reads its texts through it (the plugins of the key-is-the-English-phrase kind, Files, Maps and Sites, first). Then about 1000 phrases per language to translate. Needs the maintainer's approval of the design before it starts (kernel rules of §4b).

### 7.2b Left over from the phase 9 plugins

- Announcements: reminders to the people who did not confirm; the audience (who should confirm) is not readable by a plugin (it sees only `core.visible_resources` and `core.level_of`, never the grants), so the author cannot see who is still missing: needs a kernel request (a command or view that lists the people a resource is shared with).
- Approvals: reminders by schedule.
- Surveys: a public survey (Surveys has no public link, Forms does).
- Calendar: reminders and notifications; time zone of the person in the form of an event is the one of the browser; the .ics uses TZID without a VTIMEZONE block; invitations of a series show the first occurrence only.
- Projects: works on PostgreSQL only; ordering of cards inside a column is approximate; the burndown counts the tasks the project has today (no history of scope) and needs Tasks 0.7.1 for the completion day.
- Whiteboard: arrows attached to objects, text co-editing inside a note; a frame carries what its centre contains, it does not resize with it.
- Dashboard: the labels of the widgets only in en, it and es (the other languages fall back to English).
- Forms and Surveys: single answers of an anonymous form cannot be deleted; an anonymous survey or form cannot be made named again.
- Every phase 9 plugin: the texts inside the pages exist in en, it and es (the manifest texts exist in the seven languages): see 7.2.

### 7.3 Rules that every item above must respect

- UI rules of `docs/refactoring-ui.md`; English by default, Italian and Spanish (and the other language plugins where the mechanism of 7.2 exists); no text outside the translation tables.
- Kernel changes follow §4b: additive, opt-in keys, no bump of plugin API 1, additive migrations, `cargo xtask --dist ../geoportal test` before merging (today the gate has 9 failing tests of the distribution that fail on `main` too: they are not ours, but the gate must be re-read at each merge).
- Each plugin: version bump, migration with data conversion, KPI, `details`, real screenshots in `media/`, and **its card on the Mosaikit site** (thumbnail and carousel; languages with the flag).
- Targeted tests while working; full e2e, `cargo xtask ci` and a regenerated `tests/results/test-results.md` once before merging; manual checks (`docs/manual-tests.md`) with their Playwright twin for every feature.
- One commit at the end of every phase after the checks pass; never push (except the GitHub publication and the site update when the maintainer asks); own xtask worktree; temporary files under `C:\tmp\mosaikit`, removed when done.
