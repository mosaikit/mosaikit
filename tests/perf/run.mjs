// Load test of a full installation (cargo xtask perf, docs/reports/performance.md).
//
// Started by xtask with the server already running: seeds the data at scale (PERF_SEED=1), then
// measures the interactive calls (sequential, warm), a concurrent mix of 50 people and the queries of
// the background jobs (PostgreSQL: EXPLAIN ANALYZE), and writes PERF_OUT (JSON) plus a summary on
// stdout. Sessions are minted by the seed (token "perf-<username>"), so the measures never depend on
// the sign-in, which is measured on its own.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const env = process.env
const BASE = env.PERF_BASE
const PG = env.PERF_BACKEND === 'postgres'
const here = dirname(fileURLToPath(import.meta.url))

const SCALES = {
  probe: { tenants: 5, people: 12, notes: 100, tasks: 50, files: 50, events: 10000 },
  medium: { tenants: 50, people: 50, notes: 1000, tasks: 500, files: 500, events: 1000000 },
  full: { tenants: 200, people: 100, notes: 2500, tasks: 1500, files: 1000, events: 5000000 },
  desktop: { tenants: 1, people: 20, notes: 20000, tasks: 10000, files: 5000, events: 500000 },
}
const S = SCALES[env.PERF_SCALE]
if (!S) throw new Error(`unknown scale ${env.PERF_SCALE}`)

// ------------------------------------------------------------------ database
const psql = (args) =>
  execFileSync(env.PERF_PSQL, ['-v', 'ON_ERROR_STOP=1', '-d', env.PERF_DB_URL, ...args], { maxBuffer: 1 << 28 }).toString()
const q = (sql) => psql(['-At', '-c', sql]).trim()
// one value from the database of the run: PostgreSQL through psql, SQLite read directly (core.x -> core_x)
async function one(sql) {
  if (PG) return q(sql)
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(env.PERF_SQLITE, { readOnly: true })
  const row = db.prepare(sql.replace(/core\.(\w+)/g, 'core_$1')).get()
  db.close()
  return row ? Object.values(row)[0] : ''
}

async function seed() {
  const t0 = Date.now()
  if (PG) {
    psql(['-q', ...Object.entries(S).flatMap(([k, v]) => ['-v', `${k}=${v}`]), '-f', join(here, 'seed_pg.sql')])
  } else {
    const { seedSqlite } = await import('./seed_sqlite.mjs')
    seedSqlite(env.PERF_SQLITE, S)
  }
  return (Date.now() - t0) / 1000
}

// ------------------------------------------------------------------ HTTP
const pad = (n, w) => String(n).padStart(w, '0')
const userName = (ti, j) => `u${pad(ti, 4)}-${pad(j, 3)}`
const token = (username) => createHash('sha256').update(`perf-${username}`).digest('hex')
const session = (username) => ({ cookie: `msk_session=${token(username)}`, 'x-csrf-token': 'perf-csrf' })

async function call(path, headers = {}, init = {}) {
  const t = performance.now()
  const r = await fetch(BASE + path, { ...init, headers: { 'accept-language': 'en', ...headers, ...(init.headers ?? {}) } })
  const body = await r.arrayBuffer()
  const ms = performance.now() - t
  if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${r.status} ${Buffer.from(body).toString().slice(0, 200)}`)
  return { ms, bytes: body.byteLength, json: () => JSON.parse(Buffer.from(body).toString()) }
}

const pct = (xs, p) => {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}
const results = []
// PERF_SKIP: names already measured (separated by ';', the names have commas), PERF_ONLY: measure only these
const SKIP = new Set((env.PERF_SKIP ?? '').split(';').map((x) => x.trim()).filter(Boolean))
const ONLY = new Set((env.PERF_ONLY ?? '').split(';').map((x) => x.trim()).filter(Boolean))
const CAP_MS = 120000 // at most about two minutes per operation
async function measure(name, fn, n = 5) {
  if (SKIP.has(name) || (ONLY.size && !ONLY.has(name))) return
  try {
    const warm = await fn() // warm up
    // the slow ones (seconds each) are measured fewer times
    // the slow ones (seconds each) are measured once more only
    if (warm.ms > 3000) n = 1
    const ms = []
    let bytes = 0
    const start = Date.now()
    for (let i = 0; i < n && (i === 0 || Date.now() - start < CAP_MS); i++) {
      const r = await fn(i)
      ms.push(r.ms)
      bytes = r.bytes
    }
    const row = { name, n: ms.length, p50: +pct(ms, 50).toFixed(1), p95: +pct(ms, 95).toFixed(1), max: +Math.max(...ms).toFixed(1), bytes }
    results.push(row)
    console.log(`${name.padEnd(46)} p50 ${String(row.p50).padStart(8)} ms  p95 ${String(row.p95).padStart(8)} ms  ${bytes} B`)
  } catch (e) {
    results.push({ name, error: String(e.message ?? e).slice(0, 300) })
    console.log(`${name.padEnd(46)} ERROR ${String(e.message ?? e).slice(0, 200)}`)
  }
}

// ------------------------------------------------------------------ server resources
function serverStats() {
  const pid = env.PERF_SERVER_PID
  try {
    const out = execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      `$p = Get-Process -Id ${pid}; "{0} {1}" -f [math]::Round($p.WorkingSet64/1MB), [math]::Round($p.CPU,1)`,
    ])
      .toString()
      .trim()
    const [rss, cpu] = out.split(/\s+/).map((x) => Number(x.replace(',', '.')))
    return { rss_mb: rss, cpu_s: cpu }
  } catch {
    return {}
  }
}

// ------------------------------------------------------------------ the measures
async function interactive() {
  const ti = Math.ceil(S.tenants / 2)
  const slug = `t${pad(ti, 4)}`
  const user = session(userName(ti, 5))
  const manager = session(userName(ti, 0))
  const admin = session('admin')
  const notes = `/api/t/${slug}/p/com.mosaikit.notes/r/notes`

  await measure(
    'sign-in (argon2)',
    () =>
      call('/api/auth/login', {}, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant: slug, username: userName(ti, 6), password: 'perf-admin-password' }),
      }),
    5,
  )
  await measure('session', () => call('/api/session', user))
  await measure('tenant context (sidebar, plugins)', () => call(`/api/t/${slug}/context`, user))
  await measure('home overview', () => call(`/api/t/${slug}/overview`, user))
  await measure('notes: list (user)', () => call(notes, user))
  await measure('notes: list with filter (user)', () => call(`${notes}?filter=budget`, user))
  await measure('notes: list (manager)', () => call(notes, manager))
  // a page as the shell asks it (mountCrud: 100 rows, the latest changed first)
  await measure('notes: first page (user)', () => call(`${notes}?limit=100`, user))
  await measure('notes: first page with filter (user)', () => call(`${notes}?limit=100&filter=budget`, user))
  try {
    const next = (await call(`${notes}?limit=100`, user)).json().next
    if (next) await measure('notes: next page (user)', () => call(`${notes}?limit=100&cursor=${encodeURIComponent(next)}`, user))
  } catch {}
  try {
    const rows = (await call(notes, user)).json().rows
    if (rows.length) await measure('notes: get one', () => call(`${notes}/${rows[0].id}`, user))
  } catch {}
  await measure('tasks: list', () => call(`/api/t/${slug}/p/com.mosaikit.tasks/r/tasks`, user))
  await measure('files: top folder', () => call(`/api/t/${slug}/p/com.mosaikit.files/files`, user))
  await measure('search (common word)', () => call(`/api/t/${slug}/search?q=budget`, user))
  await measure('search (rare word)', () => call(`/api/t/${slug}/search?q=alpha42`, user))
  await measure('notifications: list', () => call('/api/me/notifications', user))
  await measure('notifications: unread count', () => call('/api/me/notifications/count', user))
  await measure('shared by me', () => call(`/api/t/${slug}/me/shared`, user))
  await measure('trash (user)', () => call(`/api/t/${slug}/trash`, user))
  await measure('trash (manager)', () => call(`/api/t/${slug}/trash`, manager))
  await measure('my usage', () => call(`/api/t/${slug}/usage/mine`, user))

  await measure('manager: members', () => call(`/api/t/${slug}/manage/members`, manager))
  await measure('manager: groups', () => call(`/api/t/${slug}/manage/groups`, manager))
  await measure('manager: all items', () => call(`/api/t/${slug}/manage/resources`, manager))
  // the pages of the shell (50 rows, searched on the server)
  await measure('manager: members, first page', () => call(`/api/t/${slug}/manage/members?limit=50`, manager))
  await measure('manager: members, search', () => call(`/api/t/${slug}/manage/members?limit=50&q=005`, manager))
  await measure('manager: groups, first page', () => call(`/api/t/${slug}/manage/groups?limit=50`, manager))
  await measure('manager: shares, first page', () => call(`/api/t/${slug}/manage/resources?limit=50&show=shared`, manager))
  await measure('manager: all items, first page', () => call(`/api/t/${slug}/manage/resources?limit=50`, manager))
  await measure('manager: log (first page)', () => call(`/api/t/${slug}/manage/log`, manager))
  // a person with events in the tenant
  const uid = await one(`select e.user_id from core.events e where e.tenant_id = (select id from core.tenants where slug = '${slug}') and e.user_id is not null order by e.id desc limit 1`)
  await measure('manager: log, one person', () => call(`/api/t/${slug}/manage/log?user=${uid}`, manager))
  await measure('manager: log, only failures', () => call(`/api/t/${slug}/manage/log?failed=true`, manager))
  await measure('manager: log, search', () => call(`/api/t/${slug}/manage/log?q=login`, manager))
  await measure('manager: log CSV (all)', () => call(`/api/t/${slug}/manage/log.csv`, manager), 3)
  await measure('manager: plugin KPIs', () => call(`/api/t/${slug}/manage/kpi`, manager))
  await measure('manager: quotas', () => call(`/api/t/${slug}/manage/quotas`, manager))
  await measure('manager: usage trend', () => call(`/api/t/${slug}/manage/usage/trend`, manager))
  await measure('manager: who uses the most', () => call(`/api/t/${slug}/manage/usage/consumers`, manager))

  await measure('admin: overview', () => call('/api/admin/overview', admin))
  await measure('admin: tenants', () => call('/api/admin/tenants', admin))
  await measure('admin: people', () => call('/api/admin/people', admin))
  await measure('admin: tenants, first page', () => call('/api/admin/tenants?limit=50', admin))
  await measure('admin: tenants, search', () => call('/api/admin/tenants?limit=50&q=t01', admin))
  await measure('admin: people, first page', () => call('/api/admin/people?limit=50', admin))
  await measure('admin: people, search', () => call(`/api/admin/people?limit=50&q=${userName(ti, 7)}`, admin))
  await measure('admin: people, every id (select all)', () => call('/api/admin/people?limit=50&ids=true', admin), 3)
  await measure('admin: log (first page)', () => call('/api/admin/log', admin))
  const tid = await one(`select id from core.tenants where slug = '${slug}'`)
  await measure('admin: log, one tenant', () => call(`/api/admin/log?tenant=${tid}`, admin))
  await measure('admin: log, search', () => call('/api/admin/log?q=login', admin))
  await measure('admin: platform KPIs', () => call('/api/admin/kpi', admin))
  await measure('admin: platform KPIs, computed now', () => call('/api/admin/kpi?refresh=true', admin), 1)
  await measure('admin: quotas', () => call('/api/admin/quotas', admin))
  await measure('admin: search', () => call('/api/admin/search?q=t0001', admin))
  for (const page of ['status', 'performance', 'errors', 'tenants', 'capacity', 'alerts']) {
    await measure(`admin: monitoring ${page}`, () => call(`/api/admin/monitoring/${page}`, admin))
  }
}

// 50 people of different tenants at the same time, each a loop of the calls of a working session
// paged: the notes and tasks lists as the shell asks them now (100 rows); otherwise the whole lists
async function concurrent(people = 50, seconds = 30, paged = true, only = null) {
  const ms = []
  const byPath = {}
  let errors = 0
  let firstError = ''
  const end = Date.now() + seconds * 1000
  const one = async (k) => {
    const ti = 1 + (k % S.tenants)
    const slug = `t${pad(ti, 4)}`
    const h = session(userName(ti, 2 + (k % Math.min(10, S.people - 2))))
    const loop = [
      `/api/t/${slug}/context`,
      `/api/t/${slug}/p/com.mosaikit.notes/r/notes${paged ? '?limit=100' : ''}`,
      '/api/me/notifications/count',
      `/api/t/${slug}/search?q=meeting`,
      `/api/t/${slug}/p/com.mosaikit.tasks/r/tasks${paged ? '?limit=100' : ''}`,
      `/api/t/${slug}/overview`,
    ]
    // `only`: a word of the path, to load one kind of request (to tell which one makes the others wait)
    const mine = only ? loop.filter((x) => x.includes(only)) : loop
    for (let i = 0; Date.now() < end; i++) {
      try {
        const t = (await call(mine[i % mine.length], h)).ms
        ms.push(t)
        const key = mine[i % mine.length].replace(/t\d{4}/, '{t}')
        ;(byPath[key] ??= []).push(t)
      } catch (e) {
        errors++
        firstError ||= String(e.message ?? e).slice(0, 200)
      }
    }
  }
  const before = serverStats()
  await Promise.all(Array.from({ length: people }, (_, k) => one(k)))
  const after = serverStats()
  const row = {
    paged,
    people,
    seconds,
    requests: ms.length,
    rps: +(ms.length / seconds).toFixed(1),
    p50: +pct(ms, 50).toFixed(1),
    p95: +pct(ms, 95).toFixed(1),
    p99: +pct(ms, 99).toFixed(1),
    errors,
    firstError,
    paths: Object.fromEntries(
      Object.entries(byPath).map(([k, v]) => [k, { n: v.length, p50: +pct(v, 50).toFixed(1), p95: +pct(v, 95).toFixed(1) }]),
    ),
    server: { before, after },
  }
  console.log(row.paths)
  console.log(`concurrent ${people} people${paged ? ', paged lists' : ', whole lists'} ${seconds}s: ${row.rps} req/s, p50 ${row.p50} ms, p95 ${row.p95} ms, p99 ${row.p99} ms, errors ${errors} ${firstError}`, after)
  return row
}

// the queries of the background jobs, timed in the database (PostgreSQL)
function background() {
  if (!PG) return []
  const out = []
  const time = (name, sql) => {
    let ms = null
    try {
      const plan = psql(['-At', '-c', `explain (analyze, format text) ${sql}`])
      const m = plan.match(/Execution Time: ([\d.]+) ms/)
      ms = m ? +m[1] : null
    } catch (e) {
      console.log(String(e.message).slice(0, 200))
    }
    out.push({ name, ms })
    console.log(`${name.padEnd(46)} ${ms ?? '?'} ms`)
  }
  for (const [name, sql] of BACKGROUND) time(name, sql)
  return out
}
// the same queries as the workers of the kernel (kept in step with crates/kernel by hand)
const BACKGROUND = [
  ['search: items not indexed yet (batch)', 'select id from core.resources where search_text is null and deleted_at is null limit 200'],
  ['trash: items to purge', "select id from core.resources where deleted_at is not null and deleted_at < now() - interval '30 days'"],
  ['log: events past retention', "select count(*) from core.events where ts < now() - interval '365 days'"],
  ['notifications: past retention', "select count(*) from core.notifications where created_at < now() - interval '90 days'"],
  ['quotas: storage and items of every tenant', 'select tenant_id, sum(size_bytes), count(*) from core.resources group by tenant_id'],
  ['quotas: people of every tenant', "select tenant_id, count(*) from core.memberships where status = 'active' group by tenant_id"],
]

function sizes() {
  if (!PG) return {}
  return JSON.parse(
    q(`select json_build_object(
      'database', pg_size_pretty(pg_database_size(current_database())),
      'resources', (select count(*) from core.resources), 'events', (select count(*) from core.events),
      'users', (select count(*) from core.users), 'notifications', (select count(*) from core.notifications))`),
  )
}

const seeded = env.PERF_SEED === '1' ? await seed() : null
if (seeded !== null) console.log(`seeded in ${seeded.toFixed(0)} s`)
await interactive()
const bg = background()
const conc = env.PERF_NO_CONCURRENT ? null : await concurrent()
// the same mix with the whole lists (as before paging): what the database costs under load
const concWhole = env.PERF_NO_CONCURRENT ? null : await concurrent(50, 30, false)
// the paged mix once more, on a warm database: the first mix reads the items of 50 tenants from disk
const concAgain = env.PERF_NO_CONCURRENT ? null : await concurrent()
// each of the heavy requests alone with 50 people: which one is slow by itself
let isolated = null
if (env.PERF_ISOLATE) {
  isolated = {}
  for (const w of ['notes', 'tasks', 'search']) isolated[w] = await concurrent(50, 15, true, w)
}
const report = {
  backend: env.PERF_BACKEND,
  scale: env.PERF_SCALE,
  data: S,
  sizes: sizes(),
  seeded_s: seeded,
  interactive: results,
  background: bg,
  concurrent: conc,
  concurrent_whole_lists: concWhole,
  concurrent_again: concAgain,
  concurrent_isolated: isolated,
  server: serverStats(),
}
writeFileSync(env.PERF_OUT, JSON.stringify(report, null, 2))
console.log(`written ${env.PERF_OUT}`)
