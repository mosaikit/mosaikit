// Global setup of the automated manual tests: seeds the new instance like the development environment
// (the accounts of docs/manual-tests.md, two tenants, a guest, a few notes) and registers the second
// factor of the Administrator, whose secret the checks use to sign in (state.json of the run).

import * as L from './lib.ts'

export default async function seed() {
  if (L.state().seeded) return
  const a = await L.api()
  const r = await a.call('POST', '/mosaikit/api/auth/admin/login', { username: 'admin', password: L.ADMIN_PASSWORD })
  if (r.pending === 'totp_setup') {
    const s = await a.call('POST', '/mosaikit/api/auth/totp/setup')
    L.save({ adminSecret: s.secret, lastStep: 0 })
    const done = await a.call('POST', '/mosaikit/api/auth/totp/enable', { code: await L.freshCode() })
    L.save({ recovery: done.recovery_codes })
  } else if (r.pending === 'totp') {
    await a.call('POST', '/mosaikit/api/auth/totp/verify', { code: await L.freshCode() })
  }
  const tenants: Record<string, string> = {}
  for (const [slug, name, user, disp] of [
    ['comune-roma', 'Comune di Roma', 'e.ricci', 'Elena Ricci'],
    ['regione-lazio', 'Regione Lazio', 'l.verdi', 'Luca Verdi'],
  ]) {
    const t = await a.call('POST', '/mosaikit/api/admin/tenants', {
      slug,
      name,
      manager_username: user,
      manager_display_name: disp,
      manager_password: L.PASSWORD,
    })
    tenants[slug] = t.id ?? t.tenant_id ?? t
  }
  const m = await L.apiUser('comune-roma', 'e.ricci')
  const ids: Record<string, string> = {}
  for (const [u, d, role] of [
    ['m.esposito', 'Marco Esposito', 'tenant_manager'],
    ['s.greco', 'Sara Greco', 'user'],
    ['l.bianchi', 'Luca Bianchi', 'user'],
    ['d.conti', 'Davide Conti', 'user'],
    ['g.marini', 'Giulia Marini', 'user'],
  ]) {
    const x = await m.call('POST', '/mosaikit/api/t/comune-roma/manage/members', { username: u, display_name: d, password: L.PASSWORD, role })
    ids[u] = x.user_id
  }
  await a.call('POST', `/mosaikit/api/admin/people/${ids['d.conti']}/tenants`, { tenant: tenants['regione-lazio'], role: 'user' })
  const notes = '/mosaikit/api/t/comune-roma/p/com.mosaikit.notes/r/notes'
  const sg = await L.apiUser('comune-roma', 's.greco')
  await sg.call('POST', notes, { values: { title: 'Shopping list', body: 'Milk and bread', tag: 'personal' } })
  await sg.call('POST', notes, { values: { title: 'Meeting notes', body: 'Agenda of Monday', tag: 'work' } })
  const er = await L.apiUser('comune-roma', 'e.ricci')
  await er.call('POST', notes, { values: { title: 'Budget 2027', body: 'Draft of the budget', tag: 'work' } })
  L.save({ tenants, ids, seeded: true, data: {} })
}
