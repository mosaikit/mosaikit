// Small helpers for the checks: soft expectations, visibility, accessibility, navigation.

import AxeBuilder from '@axe-core/playwright'
import type { Frame, Locator, Page } from '@playwright/test'
import * as L from './lib.ts'

/** Collects expectations: ok(cond, text); result() -> { status, note }. */
export function checker() {
  const bad: string[] = []
  const notes: string[] = []
  return {
    ok(cond: unknown, what: string): boolean {
      if (!cond) bad.push(what)
      return !!cond
    },
    note(t: string) {
      notes.push(t)
    },
    result(extra?: string): L.Result {
      const n = [...bad.map((b) => 'MISSING/WRONG: ' + b), ...notes, ...(extra ? [extra] : [])].join('; ')
      return { status: bad.length ? 'FAIL' : 'PASS', note: n }
    },
  }
}

export const vis = async (loc: Locator) => (await loc.count()) > 0 && (await loc.first().isVisible().catch(() => false))

/** Serious and critical axe violations (optionally of some rules only). */
export async function axe(p: Page, rules?: string[]): Promise<string[]> {
  let b = new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('[data-sonner-toaster]')
  if (rules) b = b.withRules(rules)
  const r = await b.analyze()
  return r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}(${v.nodes.length}): ${v.nodes[0].target.join(' ')}`)
}
export async function nav(p: Page, name: string) {
  await p.locator('[data-sidebar="sidebar"]').getByRole('link', { name, exact: true }).first().click()
  await p.waitForTimeout(900)
}
export async function menu(p: Page): Promise<string[]> {
  await p.getByRole('button', { name: /person menu/ }).click()
  await p.waitForTimeout(400)
  return (await p.getByRole('menuitem').allInnerTexts()).map((s) => s.trim())
}
export async function closeMenus(p: Page) {
  await p.keyboard.press('Escape')
  await p.waitForTimeout(200)
}
export async function toast(p: Page): Promise<string> {
  await p.waitForTimeout(700)
  return (await p.locator('[data-sonner-toast]').allInnerTexts()).join(' | ')
}
export async function go(p: Page, hash: string) {
  await p.goto(L.BASE + hash)
  await p.waitForTimeout(1500)
}
export async function text(p: Page): Promise<string> {
  return (await p.locator('main').innerText().catch(() => '')) || ''
}
export async function setMode(p: Page, mode: string) {
  await p.evaluate((m) => {
    const raw = localStorage.getItem('msk_theme')
    const t = raw ? JSON.parse(raw) : {}
    t.mode = m
    localStorage.setItem('msk_theme', JSON.stringify(t))
  }, mode)
}

/** Opens Notes fresh and the detail of a note; returns the frame. */
export async function openNote(p: Page, title: string): Promise<Frame> {
  await go(p, p.url().includes('regione-lazio') ? '#/t/regione-lazio' : '#/t/comune-roma')
  // a page kept open from an earlier check has the plugins of the tenant it loaded: a plugin turned off and on since then is missing
  await p.reload()
  await p.waitForTimeout(1500)
  await nav(p, p.url().includes('#/t/') && (await p.evaluate(() => document.documentElement.lang)) === 'it' ? 'Note' : 'Notes')
  const f = await L.pluginFrame(p, 'notes')
  for (let i = 0; i < 4; i++) {
    await f.getByRole('row', { name: new RegExp(title) }).first().click()
    await p.waitForTimeout(900)
    if (await vis(f.getByRole('button', { name: /Share…|Condividi…|^Close$|^Chiudi$/ }))) return f
  }
  await L.shot(p, 'open-note-failed')
  throw new Error('the detail of «' + title + '» does not open')
}
