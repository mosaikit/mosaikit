# Mosaikit — Performance at scale

Load test of a full installation (all official plugins, release build), the slow queries it found, what
was changed and what is left. Run again with `cargo xtask perf` (below).

## Scenario

| | PostgreSQL (`--scale full`) | SQLite, desktop (`--backend sqlite --scale desktop`) |
|---|---|---|
| Tenants | 200 | 1 |
| People | 20,000 (100 per tenant, 2 Tenant Managers each, 5% guests in a second tenant) | 20 |
| Groups | 5 per tenant, everyone in one or two | 5 |
| Items | 1,000,000: 500,000 notes, 300,000 tasks, 200,000 files (a fifth folders, the rest inside them) | 35,000 (20,000 notes, 10,000 tasks, 5,000 files) |
| Shares | 2% of notes and tasks, to a person or a group | same |
| Public links | 0.5% of the notes | same |
| Trash | 1% of the items | same |
| Log | 5,000,000 events over a year | 500,000 |
| Notifications | 10 per person (200,000) | 200 |
| Database | 2.8 GB | — |

`cargo xtask perf` builds the plugins (release, signed, preinstalled from the registry as in production)
and the server (release), seeds the data with SQL (`xtask/perf/seed_pg.sql`, `seed_sqlite.mjs`: the
API would take hours for millions of rows), then `xtask/perf/run.mjs` measures:

- **interactive calls**, sequential and warm, as a person, a Tenant Manager and the Administrator of a
  tenant in the middle of the platform, with sessions created by the seed;
- **a concurrent mix**: 50 people of different tenants for 30 s, each looping over context, notes,
  unread count, search, tasks and home;
- **the queries of the background jobs**, with `EXPLAIN ANALYZE` (PostgreSQL).

Options: `--reuse` measures again on the data of the previous run (new migrations are applied when the
server starts); `--no-build` measures the binary already built (used for the "before" numbers);
`--clean` drops the database and the data. `PERF_ONLY` and `PERF_SKIP` (names of the measures) narrow a
run.

**Machine**: a laptop with a 12-thread i7-1265U and 16 GB of RAM. PostgreSQL 15, the server and the load
generator all ran on it, and other builds were running at the same time. Absolute numbers are therefore
pessimistic and noisy; the ratios are what matters.

**Sampling**: the measures after the changes are 5 calls per operation, after one warm-up call. Before
the changes, the operations already known to be slow were sampled less: 20 calls for the first part of
the list, then a single call for those taking seconds (one call for the CRUD lists that took 3–7 s was
enough). The "before" column of those rows is therefore one or a few samples.

## PostgreSQL: before and after (ms, p50 / p95)

| Operation | Before | After |
|---|---|---|
| sign-in (argon2, by design) | 35 / 71 | 34 / 36 |
| session | 3 / 5 | 4 / 8 |
| tenant context (sidebar, plugins) | 4 / 9 | 5 / 8 |
| home overview | 13 / 15 | 14 / 17 |
| **notes: list (person)** | **6,565 / 7,606** | **19 / 23** |
| **notes: list with filter** | **7,339 / 7,872** | **19 / 20** |
| **notes: list (Tenant Manager)** | **7,563 / 7,908** | **15 / 16** |
| notes: get one | 9 / 11 | 9 / 9 |
| **tasks: list** | **4,045 / 4,645** | **10 / 12** |
| **files: top folder** | **2,817 / 3,457** | **18 / 19** |
| **search (common word)** | **671 / 936** | **7 / 8** |
| search (rare word) | 21 / 35 | 6 / 6 |
| notifications: list, unread count | 4 / 5, 2 / 4 | 2 / 2, 1 / 1 |
| shared by me | 5 / 9 | 3 / 4 |
| trash (person) | 3 / 4 | 2 / 3 |
| **trash (Tenant Manager)** | **53,906 / 58,377** | **3 / 3** |
| Tenant Manager: members, groups | 18 / 61, 4 / 6 | 14 / 16, 2 / 3 |
| Tenant Manager: all items | 251 / 323 | 29 / 32 |
| Tenant Manager: log, first page | 6 / 17 | 2 / 3 |
| **Tenant Manager: log, only failures** | **718 / 740** | **2 / 2** |
| Tenant Manager: log, search | 5,016 (1 sample) | 1,031 / 1,346 |
| Tenant Manager: log CSV (25,000 events) | 375 | 217 / 219 |
| Tenant Manager: plugin KPIs | 906 / 1,183 | 450 / 648 |
| Tenant Manager: quotas, trend, who uses the most | 5, 6, 25 | 4, 3, 23 |
| Administrator: overview | 1,228 / 1,459 | 1,071 / 1,359 |
| Administrator: tenants | 2,735 (1 sample) | 1,137 / 1,181 |
| **Administrator: people (20,000, 11 MB)** | **3,837 (1 sample)** | **582 / 648** |
| Administrator: log (first page, one tenant, search) | 3, 4, 5 | 4, 15, 5 |
| **Administrator: platform KPIs** | **214,375 (1 sample)** | **10,560 (1 sample)** |
| Administrator: quotas | 2,821 / 3,316 | 840 / 990 |
| Administrator: monitoring status, performance, errors, capacity, alerts | 3, 1, 4, 24, 2 | 3, 1, 4, 25, 2 |
| Administrator: monitoring tenants | 4,972 (1 sample) | 1,412 (1 sample) |

The lists, the search and the trash return the same number of bytes before and after (same rows, same
JSON); the equivalence of the visibility is also checked directly (below).

**Concurrent mix, 50 people, 30 s**

| | requests/s | p50 | p95 | p99 | errors |
|---|---|---|---|---|---|
| Before | 7.9 | 248 ms | 18,759 ms | 22,076 ms | 84 (pool timeouts: the 6-s queries held the 8 connections of a plugin) |
| After | 221 | 29 ms | 1,218 ms | 1,528 ms | 0 |

After the changes the machine is CPU bound (PostgreSQL, the server and 50 clients on 12 threads). Per
path: context p50 10 ms, unread count 3 ms, search 22 ms, tasks 27 ms, home 60 ms, but the notes list has
p50 1,082 ms while it takes 19 ms alone (see "Left open").

**Background jobs** (query of the job, `EXPLAIN ANALYZE`)

| Job | Before | After |
|---|---|---|
| search: next batch of items to index | 265 ms | 0.02 ms (partial index) |
| trash: items to purge | 0.7 ms | 0.3 ms |
| log: events past retention | 0.1 ms | 0.1 ms |
| notifications: past retention | 13 ms | 13 ms |
| quotas: storage and items of every tenant (every 10 minutes) | 228 ms | 140 ms |
| quotas: people of every tenant | 7 ms | 5 ms |

## SQLite (desktop): before and after (ms, p50 / p95)

"Before" here is the first desktop run, which already had the PostgreSQL changes but the original SQLite
queries; three pages failed in it because of a mistake of mine during the work (raw SQLite text given to
a query that expected the translated one) and have no "before" number.

| Operation | Before | After |
|---|---|---|
| notes: list (person, about 1,000 visible) | 230 / 297 | 230 / 236 |
| tasks: list, files: top folder | 115, 71 | 123, 66 |
| search (common word) | 51 | 92 |
| **trash (person)** | **318 / 370** | **20 / 24** |
| **trash (Tenant Manager, 350 items)** | **6,737** | **108 / 109** |
| **Tenant Manager: log, first page** | **1,979 / 2,592** | **3 / 3** |
| **Tenant Manager: log, only failures, search** | **1,547, 1,862** | **2, 2** |
| **Tenant Manager: log CSV** | **1,987** | **68 / 74** |
| Tenant Manager: plugin KPIs | failed | see below (the 30-day activity took 5 s) |
| Tenant Manager: all items | failed | 121 / 123 |
| Administrator: platform KPIs | failed | 203 / 240 |
| everything else | 1–300 | 1–300 |

The final desktop numbers, after the last two SQLite changes (the 30-day activity of the KPIs and the
index left out), are in `.dev/perf/sqlite/sqlite-desktop.json` of the run and summed up in "Final
check" below.

Concurrent mix with 50 people in the one tenant: 16 requests/s, p95 7.8 s, and 12 requests failed with
"database is locked" (see "Left open"). The desktop is for one person; this is far beyond its use.

## What was slow, and what changed

1. **Visibility of the items (every list of every plugin).** `core.visible_resources` called
   `core.level_of()` (plpgsql, half a dozen queries) for every item of the tenant and of the plugin, so a
   list cost 2,500–5,000 function calls whatever the person could see. New `core.levels_for(person,
   tenant)` computes what a person sees as sets: what they own, what is shared with them or their groups,
   and the descendants of those through the GIN index on `ancestors`, with the same rules (trash, owner
   of an ancestor, highest share on the chain). `core.ctx_levels()` reads the context like `level_of()`,
   adds the public-link case and keeps only the items of the current plugin; the view is built on it, with
   the same columns and rows. The candidates are looked up one by one by key, because the planner
   overestimates the descendants and otherwise reads the whole tenant.
2. **GIN indexes with a pending list.** With `fastupdate` (the default) new entries wait in a pending
   list that every search reads in full, up to 4 MB: after many inserts a lookup on `ancestors` took
   110 ms instead of 0.3 ms. `fastupdate = off` on `resources_ancestors_idx` and `resources_search_vec`
   (items are written much less often than they are read).
3. **Descendants through the index.** `x = any(ancestors)` reads the whole table; `ancestors @> array[x]`
   uses the GIN index. Changed in `core.delete_resource`, `core.move_resource`, the trash (size of a
   folder's contents, the purge) and the restore of an item from a backup. The Tenant Manager's trash went
   from 54 s to 3 ms. SQLite keeps `= any` (no arrays) and sums the contents of a tenant in one pass over
   `json_each`.
4. **Search.** It checked `core.level_for()` per match; it now keeps the matches among
   `core.levels_for()`.
5. **The Log.** `($n is null or column = $n)` for every filter: the plan prepared once cannot use the
   index of a column. Only the filters in use become conditions now. New indexes `(tenant_id, id)`,
   `(user_id, id)` and `(tenant_id, id) where not ok` for `order by id desc limit 51`. On SQLite the same
   except `(user_id, id)`, which SQLite chose for `count(distinct user_id)` over a period and read every
   event (6 s).
6. **The trash in the KPIs and the home.** `core.in_trash()` twice for every item (2,000,000 calls for the
   Administrator: 214 s). New `core.trashed(tenant)` returns the items in the trash as a set (deleted ones
   and the contents of deleted folders); the KPIs, the home and the list of all items use it. SQLite gets
   the same as SQL of its own.
7. **Platform KPIs, one query for the tenants.** Three queries per tenant (active people, shares, links)
   became one grouped query.
8. **KPIs of a tenant.** `$1 is null or tenant_id = $1` kept the view of a plugin from being filtered by
   tenant; two statements now. Plugin tables get an index on `tenant_id`, created by the kernel with every
   table of a plugin and, for plugins already installed, by the migration.
9. **Storage and items of a tenant** (quotas at every addition, tenant lists, monitoring): covering index
   `(tenant_id) include (size_bytes)`, read without the rows once the visibility map is set (autovacuum).
10. **Administrator's people.** Every person was compared with every membership in Rust (20,000 ×
    21,000); memberships are grouped by person first.
11. **SQLite, activity of the last 30 days.** `substr(ts, 1, 10) = day` kept the index from being used
    (5 s for the Tenant Manager's KPIs); it is a range on `ts` now.
12. **Search indexer**: partial index on the items not indexed yet.

Migrations: PostgreSQL `0015_performance.sql`, SQLite `0013_performance.sql`.

## Equivalence of the visibility

`xtask/perf/check_visibility.sql` compares, on the data of the load test and inside a transaction that
is rolled back, the rows and levels of the new view with the old rule (`level_of()` on every item of the
tenant and the plugin). It adds the cases the seed lacks: folders shared with a group at levels 1 and 2,
a shared folder in the trash, a share to a person on top of a group share. 8 people (2 Tenant Managers,
4 Users, a guest of another tenant, a person of another tenant) × notes, tasks and files, plus a public
link on a folder: no difference in any of the 25 cases.

## Pool sizes

Unchanged: 20 connections for the application (configurable, `[database] max_connections`) and 8 per
plugin. The errors of the concurrent mix came from the 6-second queries holding the 8 connections of a
plugin, not from the sizes; with the queries fixed there are no errors. Raising the plugin pools would
multiply the connections (7 plugins × 8 + 20 already = 76, close to PostgreSQL's default 100).

## Left open

- **Platform KPIs: 10 s** for 200 tenants and 1,000,000 items. The statistics of the items group the whole
  table (about 1 s in psql) and the page also reads every plugin's KPI view for every tenant; in the
  server these statements took 3–5 times longer than in psql, for reasons not found. Next step: read the
  daily snapshots that the quotas already keep (`core.quota_usage`) instead of scanning the items.
- **Under 50 concurrent people the notes list has p50 1 s** while the tasks list, the same kind of query,
  has 27 ms; alone it takes 19 ms. Not explained yet: something specific to the notes plugin (it has an
  extension and a hook) or to its pool of 8 connections. To investigate with per-pool metrics.
- **The access check per row** (`core.can_access()` in the row-level security of the plugin tables) is
  about a third of a list now (7 of 19 ms). Replacing it with `resource_id in (select id from
  core.ctx_levels())` would remove most of it, but it changes the policies of every plugin table and
  makes single-item reads a few ms slower: a security-sensitive change left for a decision.
- **Lists without paging**: a plugin list returns up to 5,000 rows, the Tenant Manager's all items 1,000,
  the Administrator's people every person (11 MB for 20,000). Paging changes the API and the shell.
- **Tenant Manager: log search, 1 s**: `ilike` on action, person, details and address cannot use an index;
  with few matches the whole Log of the tenant is read. A trigram index (`pg_trgm`) would help but needs
  the extension.
- **Administrator: tenants (1.1 s), quotas (0.8 s), monitoring tenants (1.4 s)**: subqueries per tenant;
  in psql the tenant list takes 0.3 s after vacuum. A single grouped query per page would bring them down.
- **SQLite with concurrent writers**: "database is locked" with 15 s of `busy_timeout`, most likely a read
  transaction that becomes a write (SQLite refuses the upgrade at once instead of waiting); `BEGIN
  IMMEDIATE` for the transactions that write would avoid it. Not a desktop scenario.
- **SQLite, the Log filtered by one person**: 123 ms (without the `(user_id, id)` index left out above).

## Final check

On the final code: `cargo fmt --check` and `cargo clippy --workspace --all-targets -D warnings` clean;
`cargo xtask test` (nextest) 214/214 on PostgreSQL and 182/182 on SQLite (run again after the last
SQLite change), the UI and plugin tests (24, 29, 14, 2); `cargo xtask e2e` 22/22.

Final desktop run (SQLite, ms, p50 / p95), after the last two changes:

| Operation | |
|---|---|
| Tenant Manager: plugin KPIs | 367 / 480 (was 5,089) |
| Administrator: overview | 20 / 21 (1,537 with the index now left out) |
| trash (Tenant Manager) | 85 / 89 |
| Tenant Manager: all items | 179 / 196 |
| Administrator: platform KPIs | 232 / 249 |
| notes, tasks, files lists | 244, 107, 70 |
| Log: first page, failures, search, CSV | 2, 1, 2, 54 |
| Tenant Manager: who uses the most | 362 / 549 |

With one person on the desktop every page answers within about a quarter of a second; the lists return
up to 5,000 rows (370 KB of notes).
