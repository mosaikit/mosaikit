// Data of the load test on SQLite (cargo xtask perf --backend sqlite): the same shape as
// seed_pg.sql, written with node:sqlite while the server runs (WAL). The triggers of the plugin
// tables check the access through functions of the server: they are dropped for the seed and created
// again, unchanged, at the end.

import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'

const iso = (ms) => new Date(ms).toISOString()
const pad = (n, w) => String(n).padStart(w, '0')
const sha = (s) => createHash('sha256').update(s).digest()

export function seedSqlite(file, S) {
  const db = new DatabaseSync(file)
  db.exec('pragma busy_timeout = 60000')
  let seed = 42
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  const now = Date.now()
  const day = 86400000
  const triggers = db
    .prepare("select name, sql from sqlite_master where type = 'trigger' and tbl_name like 'plg_%'")
    .all()
  db.exec('begin')
  for (const t of triggers) db.exec(`drop trigger "${t.name}"`)
  const hash = db.prepare("select password_hash from core_users where username = 'admin'").get().password_hash
  const ins = (sql) => db.prepare(sql)
  const tenant = ins('insert into core_tenants (id, slug, name) values (?, ?, ?)')
  const profile = ins(
    "insert into core_permission_profiles (id, tenant_id, name, description, is_default) values (?, ?, 'Standard', 'The permissions every plugin gives by default.', 1)",
  )
  const user = ins(
    'insert into core_users (id, home_tenant_id, username, display_name, email, password_hash, last_sign_in_at) values (?, ?, ?, ?, ?, ?, ?)',
  )
  const member = ins('insert into core_memberships (tenant_id, user_id, role) values (?, ?, ?)')
  const group = ins('insert into core_groups (id, tenant_id, name) values (?, ?, ?)')
  const gm = ins('insert or ignore into core_group_members (group_id, user_id) values (?, ?)')
  const res = ins(
    `insert into core_resources (id, tenant_id, plugin_id, kind, parent_id, ancestors, owner_id, title, size_bytes, meta, search_text, created_at, updated_at, deleted_at, deleted_by)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const note = ins('insert into "plg_com_mosaikit_notes__notes" (resource_id, tenant_id, title, body, tag) values (?, ?, ?, ?, ?)')
  const task = ins(
    'insert into "plg_com_mosaikit_tasks__tasks" (resource_id, tenant_id, title, due, priority, done, completed_on) values (?, ?, ?, ?, ?, ?, ?)',
  )
  const grant = ins('insert or ignore into core_grants (resource_id, principal_type, principal_id, level) values (?, ?, ?, ?)')
  const link = ins('insert into core_public_links (id, resource_id, token_hash, created_by) values (?, ?, ?, ?)')
  const event = ins(
    'insert into core_events (ts, tenant_id, user_id, plugin_id, action, detail, ok, ip, agent) values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
  const notif = ins(
    "insert into core_notifications (id, user_id, tenant_id, kind, title, body, link, created_at, read_at) values (?, ?, ?, ?, ?, 'Something happened', '#/', ?, ?)",
  )
  const sess = ins("insert into core_sessions (token_hash, user_id, csrf, expires_at) values (?, ?, 'perf-csrf', ?)")

  const tenants = []
  for (let ti = 1; ti <= S.tenants; ti++) {
    const id = randomUUID()
    tenant.run(id, `t${pad(ti, 4)}`, `Tenant ${ti}`)
    profile.run(randomUUID(), id)
    const people = []
    for (let j = 0; j < S.people; j++) {
      const uid = randomUUID()
      const name = `u${pad(ti, 4)}-${pad(j, 3)}`
      user.run(uid, id, name, `Person ${j} of tenant ${ti}`, `${name}@example.org`, hash, iso(now - rnd() * 30 * day))
      member.run(id, uid, j < 2 ? 'tenant_manager' : 'user')
      if (j < 12) sess.run(sha(createHash('sha256').update(`perf-${name}`).digest('hex')), uid, iso(now + 7 * day))
      people.push(uid)
    }
    const groups = []
    for (let g = 1; g <= 5; g++) {
      const gid = randomUUID()
      group.run(gid, id, `Group ${g}`)
      groups.push(gid)
    }
    people.forEach((uid, j) => {
      gm.run(groups[j % 5], uid)
      if (j % 3 === 0) gm.run(groups[(j + 2) % 5], uid)
    })
    tenants.push({ id, people, groups })
    const owner = () => people[Math.floor(rnd() * people.length)]
    const words = ['budget', 'roadmap', 'meeting', 'invoice', 'contract', 'travel', 'design', 'release']
    const add = (plugin, kind, n, title, extra = {}) => {
      const rid = randomUUID()
      const o = owner()
      const ts = now - rnd() * 365 * day
      const text = kind === 'notes' ? `Text of the note ${n}: words alpha${n % 97} beta${n % 31}` : ''
      res.run(
        rid, id, plugin, kind, extra.parent ?? null, JSON.stringify(extra.parent ? [extra.parent] : []), o, title,
        extra.size ?? 0, extra.meta ?? '{}', n % 20 === 0 && kind === 'notes' ? null : text, iso(ts), iso(ts + rnd() * 10 * day),
        n % 100 === 9 ? iso(now - rnd() * 20 * day) : null, n % 100 === 9 ? o : null,
      )
      if (n % 50 === 1) {
        if (n % 2 === 0) grant.run(rid, 'user', people[(n * 13) % people.length], 1 + (n % 2))
        else grant.run(rid, 'group', groups[n % 5], 1 + (n % 2))
      }
      return { rid, o }
    }
    for (let n = 1; n <= S.notes; n++) {
      const title = `Note ${n} of tenant ${ti} about ${words[n % 8]}`
      const { rid, o } = add('com.mosaikit.notes', 'notes', n, title)
      note.run(rid, id, title, `Text of the note ${n}: words alpha${n % 97} beta${n % 31}`, ['personal', 'work', 'urgent', null][n % 4])
      if (n % 200 === 3) link.run(randomUUID(), rid, sha(`perf-link-${rid}`), o)
    }
    for (let n = 1; n <= S.tasks; n++) {
      const title = `Task ${n} of tenant ${ti}`
      const { rid } = add('com.mosaikit.tasks', 'tasks', n, title)
      task.run(rid, id, title, iso(now + ((n % 60) - 30) * day).slice(0, 10), ['low', 'medium', 'high'][n % 3], n % 3 === 0 ? 1 : 0, n % 3 === 0 ? iso(now).slice(0, 10) : null)
    }
    let folder = null
    for (let n = 1; n <= S.files; n++) {
      if (n % 5 === 1) folder = add('com.mosaikit.files', 'folder', n, `Folder ${n}`).rid
      else add('com.mosaikit.files', 'file', n, `Document ${n}.pdf`, { parent: folder, size: 1000 + ((n * 7919) % 5000000), meta: '{"mime":"application/pdf"}' })
    }
    people.forEach((uid, j) => {
      for (let k = 1; k <= 10; k++) {
        notif.run(randomUUID(), uid, id, ['share', 'link', 'system', 'plugin'][k % 4], `Notification ${k}`, iso(now - k * day), k > 3 ? iso(now) : null)
      }
    })
  }
  const admin = db.prepare("select id from core_users where username = 'admin'").get().id
  sess.run(sha(createHash('sha256').update('perf-admin').digest('hex')), admin, iso(now + 7 * day))
  const actions = ['auth.login', 'crud.create', 'crud.update', 'crud.delete', 'share.grant', 'link.create', 'auth.logout', 'files.upload']
  for (let i = 1; i <= S.events; i++) {
    const t = tenants[(i * 7) % tenants.length]
    event.run(
      iso(now - (1 - i / S.events) * 365 * day), t.id, t.people[(i * 11) % t.people.length], i % 3 === 0 ? 'com.mosaikit.notes' : null,
      actions[i % 8], '{}', i % 50 === 0 ? 0 : 1, `10.0.${i % 250}.${i % 200}`, 'Mozilla/5.0 perf',
    )
  }
  for (const t of triggers) db.exec(t.sql)
  db.exec('commit')
  db.exec('analyze')
  db.close()
}
