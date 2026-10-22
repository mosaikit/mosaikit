import { createHmac } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// Scenario completo nella shell: amministratore (secondo fattore, plugin, tenant, barra in alto, tema)
// -> Tenant Manager (persone, tema del tenant, invito) -> membro (Account, plugin in iframe,
// condivisione, link pubblico, notifica di un invito) -> Tenant Manager (condivisioni, consumi).
// Poi isolamento dell'iframe, lingua, telefono, accessibilita' (axe) e contrasto dei temi.

const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'e2e-admin-password'
const PASSWORD = 'password-e2e-123'
const NEW_PASSWORD = 'password-e2e-456'
// l'app e' servita sotto un percorso base (url = "http://127.0.0.1:18080/mosaikit")
const BASE = process.env.E2E_BASE_PATH ?? '/mosaikit'

/** Codice TOTP (RFC 6238, SHA-1, 6 cifre) di un segreto in base32. */
function totp(secret: string, step = Math.floor(Date.now() / 30000)): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of secret.replace(/\s|=/g, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)))
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(step))
  const h = createHmac('sha1', key).update(msg).digest()
  const off = h[h.length - 1] & 0x0f
  return String((h.readUInt32BE(off) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

let adminSecret = ''

/** Lingua italiana e niente stato di prove precedenti. */
async function fresh(page: Page, hash = '') {
  await page.goto('./' + hash)
  await page.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('msk_lang', 'it')
  })
  await page.goto('./' + hash)
}

async function login(page: Page, tenant: string, user: string, password: string) {
  await fresh(page)
  await expect(page.getByLabel('Utente')).toBeVisible()
  // il menu dei tenant compare solo se ce n'e' piu' di uno
  const select = page.getByRole('combobox', { name: 'Tenant' })
  if (await select.count()) {
    await select.click()
    await page.getByRole('option', { name: tenant }).click()
  }
  await page.getByLabel('Utente').fill(user)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Accedi' }).click()
  await expect(page.getByRole('button', { name: /menu della persona/ })).toBeVisible()
}

/** Accesso amministratori: la prima volta registra il secondo fattore, poi chiede il codice. */
async function adminLogin(page: Page) {
  await fresh(page, '#/admin')
  await expect(page.getByRole('heading', { name: 'Accesso amministratori' })).toBeVisible()
  await page.getByLabel('Utente').fill('admin')
  await page.getByLabel('Password').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Accedi' }).click()
  if (!adminSecret) {
    await expect(page.getByRole('img', { name: "QR code da inquadrare con l'app" })).toBeVisible()
    adminSecret = ((await page.locator('code').first().textContent()) ?? '').replace(/\s/g, '')
    await page.getByLabel('Codice mostrato dall’app').fill(totp(adminSecret))
    await page.getByRole('button', { name: 'Attiva e accedi' }).click()
    await expect(page.getByLabel('Codici di recupero').locator('li')).toHaveCount(10)
    await page.getByRole('button', { name: 'Ho salvato i codici: continua' }).click()
  } else {
    await page.getByLabel('Codice', { exact: true }).fill(totp(adminSecret))
    await page.getByRole('button', { name: 'Conferma' }).click()
  }
  await expect(page.getByRole('heading', { name: 'Panoramica della piattaforma' })).toBeVisible()
}

async function logout(page: Page) {
  await page.getByRole('button', { name: /menu della persona/ }).click()
  await page.getByRole('menuitem', { name: 'Esci' }).click()
  await expect(page.getByRole('button', { name: 'Accedi' })).toBeVisible()
}

/** Una voce della sidebar (barra a icone o pannello aperto). */
const nav = (page: Page, name: string) => page.locator('[data-sidebar="sidebar"]').getByRole('link', { name, exact: true })

async function createTenant(page: Page, slug: string, name: string) {
  await page.getByRole('button', { name: 'Nuovo tenant' }).click()
  const d = page.getByRole('dialog', { name: 'Nuovo tenant' })
  await d.getByLabel('Identificativo').fill(slug)
  await d.getByLabel('Nome', { exact: true }).fill(name)
  await d.getByLabel('Username del Tenant Manager').fill('gestore')
  await d.getByLabel('Password iniziale').fill(PASSWORD)
  await d.getByRole('button', { name: 'Crea il tenant' }).click()
  await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible()
}

/** No serious or critical WCAG 2.1 AA violation (axe). */
async function accessible(page: Page, where: string) {
  // toasts fade in and out: measured half-transparent they would fail colour contrast by chance
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('[data-sonner-toaster]').analyze()
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${where}: ${v.id} ${v.nodes.map((n) => n.target.join(' ') + ' ' + n.html.slice(0, 300) + ' => ' + n.failureSummary).join(' | ')}`)).toEqual([])
}

test.describe.serial('piattaforma', () => {
  test('amministratore: secondo fattore, plugin, tenant, barra in alto e tema', async ({ page }) => {
    // prima di ogni tenant la pagina di accesso lo dice e rimanda all'accesso amministratori
    await fresh(page)
    await expect(page.getByText('Nessun tenant disponibile.')).toBeVisible()
    await accessible(page, 'accesso')
    await adminLogin(page)
    await expect(page.getByText('Piattaforma', { exact: true }).first()).toBeVisible()
    await accessible(page, 'panoramica della piattaforma')

    // plugin preinstallati dal registry
    await nav(page, 'Plugin').click()
    for (const name of ['Note', 'Attività', 'Contatti', 'Mappe', 'Siti statici', 'File']) {
      await expect(page.getByRole('row', { name: new RegExp(name) }).first()).toContainText('attivo')
    }
    await accessible(page, 'plugin della piattaforma')

    // due tenant, ciascuno con il suo Tenant Manager
    await nav(page, 'Tenant').click()
    await createTenant(page, 'alfa', 'Comune di Alfa')
    await createTenant(page, 'beta', 'Comune di Beta')
    await page.getByRole('link', { name: 'Comune di Alfa' }).click()
    await page.getByRole('link', { name: 'Utenti e gestori' }).click()
    await expect(page.getByRole('row', { name: /gestore/ })).toContainText('Tenant Manager')
    await accessible(page, 'dettaglio del tenant')

    // la barra in alto, decisa dall'Administrator: senza guida, l'aiuto passa nel menu della persona
    await nav(page, 'Sistema').click()
    await page.getByRole('link', { name: 'Barra in alto' }).click()
    await page.getByRole('switch', { name: 'Guida' }).click()
    await accessible(page, 'barra in alto, con modifiche')
    await page.getByRole('button', { name: 'Salva' }).click()
    await expect(page.getByRole('button', { name: 'Aiuto', exact: true })).toBeHidden()
    await page.getByRole('button', { name: /menu della persona/ }).click()
    await expect(page.getByRole('menuitem', { name: 'Tour guidato di questa pagina' })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('switch', { name: 'Guida' }).click()
    await page.getByRole('button', { name: 'Salva' }).click()
    await expect(page.getByRole('button', { name: 'Aiuto', exact: true })).toBeVisible()

    // il tema della piattaforma: Tessera, i colori del logo
    await page.getByRole('link', { name: 'Tema', exact: true }).click()
    await page.getByRole('button', { name: /Tessera/ }).click()
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'tessera')
    await accessible(page, 'sistema, tema Tessera')
    await logout(page)
  })

  test('Tenant Manager: navigazione, persone, tema del tenant, invito', async ({ page }) => {
    await login(page, 'Comune di Alfa', 'gestore', PASSWORD)
    // il tenant eredita il tema della piattaforma
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'tessera')
    for (const name of ['Panoramica del tenant', 'Gestisci', 'Plugin', 'Condivisioni', 'Consumi', 'Impostazioni del tenant']) {
      await expect(nav(page, name)).toBeVisible()
    }
    await nav(page, 'Gestisci').click()
    await page.getByRole('button', { name: 'Nuovo utente' }).click()
    const d = page.getByRole('dialog', { name: 'Nuovo utente' })
    await d.getByLabel('Username').fill('anna')
    await d.getByLabel('Nome visualizzato').fill('Anna Rossi')
    await d.getByLabel('Password iniziale').fill(PASSWORD)
    await d.getByRole('button', { name: 'Crea utente' }).click()
    await expect(page.getByRole('row', { name: /Anna Rossi/ })).toBeVisible()
    // la barra delle azioni compare solo con una selezione
    await expect(page.getByRole('group', { name: 'Azioni sulla selezione' })).toBeHidden()
    await page.getByRole('row', { name: /Anna Rossi/ }).getByRole('checkbox').click()
    await expect(page.getByRole('group', { name: 'Azioni sulla selezione' })).toBeVisible()
    await accessible(page, 'gestisci')

    // tema del tenant: personalizzato, poi di nuovo quello della piattaforma
    await nav(page, 'Impostazioni del tenant').click()
    await page.getByRole('link', { name: 'Tema', exact: true }).click()
    await expect(page.getByText('Ereditato', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Designers Italia/ }).click()
    await expect(page.getByText('Personalizzato', { exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'italia')
    await page.getByRole('button', { name: 'Ripristina il tema della piattaforma' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'tessera')
    await logout(page)

    // il Tenant Manager di Beta invita Anna, che sta in Alfa
    await login(page, 'Comune di Beta', 'gestore', PASSWORD)
    await nav(page, 'Gestisci').click()
    await page.getByRole('link', { name: /In attesa/ }).click()
    await page.getByRole('button', { name: 'Invita' }).click()
    const inv = page.getByRole('dialog', { name: 'Invita una persona di un altro tenant' })
    await inv.getByLabel('Tenant di appartenenza').fill('alfa')
    await inv.getByLabel('Username').fill('anna')
    await inv.getByRole('button', { name: 'Invia l’invito' }).click()
    await expect(page.getByRole('row', { name: /anna/ })).toBeVisible()
    await logout(page)
  })

  test('membro: Account, notifica, plugin, condivisione e link pubblico', async ({ page, context }) => {
    await login(page, 'Comune di Alfa', 'anna', PASSWORD)
    await expect(nav(page, 'Gestisci')).toBeHidden()
    await accessible(page, 'home')

    // cambio della propria password: la regola accanto al campo
    await page.getByRole('button', { name: /menu della persona/ }).click()
    await page.getByRole('menuitem', { name: 'Account' }).click()
    await page.getByRole('link', { name: 'Accesso e sicurezza' }).click()
    await page.getByLabel('Password attuale').fill(PASSWORD)
    await page.getByLabel('Nuova password', { exact: true }).fill(NEW_PASSWORD)
    await page.getByLabel('Ripeti la nuova password').fill(NEW_PASSWORD)
    await page.getByRole('button', { name: 'Aggiorna password' }).click()
    await expect(page.getByText('Password aggiornata: le altre sessioni sono state chiuse')).toBeVisible()
    await accessible(page, 'account')

    // la campanella: l'invito di Beta, accettato dal pannello
    await page.getByRole('button', { name: /^Notifiche/ }).click()
    const panel = page.getByRole('dialog')
    await expect(panel).toContainText('Comune di Beta')
    await panel.getByRole('button', { name: 'Accetta' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: /^Tenant: / })).toBeVisible()

    // una nota nel plugin, nell'iframe
    await nav(page, 'Note').click()
    const frame = page.frameLocator('iframe.plugin-frame')
    await expect(frame.getByRole('heading', { name: 'Note' })).toBeVisible()
    await frame.locator('[data-key="title"]').fill('Verbale riunione')
    await frame.locator('[data-key="body"]').fill('<b>contenuto riservato</b>')
    await frame.getByRole('button', { name: 'Salva' }).click()
    const row = frame.locator('tbody tr.row', { hasText: 'Verbale riunione' })
    await expect(row).toBeVisible()
    // hook WASM del plugin: tag di default
    await expect(row).toContainText('personale')

    // condivisione in lettura con il gestore, nella finestra dell'host
    await frame.getByRole('button', { name: 'Condividi…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Condivisione' })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Cerca persone o gruppi').fill('gestore')
    await dialog.getByRole('option', { name: /gestore/ }).click()
    await dialog.getByRole('button', { name: 'Condividi', exact: true }).click()
    await expect(dialog.getByRole('list', { name: 'Con chi è condiviso' })).toContainText('gestore')
    await accessible(page, 'condivisione')

    // link pubblico
    await dialog.getByRole('button', { name: 'Crea link' }).click()
    const url = await dialog.getByLabel('Link pubblico', { exact: true }).inputValue()
    expect(url).toMatch(/\/p\/[0-9a-f]{48}\/$/)
    await dialog.getByRole('button', { name: 'Chiudi' }).click()

    const pub = await context.newPage()
    await pub.goto(url)
    await expect(pub.getByRole('heading', { name: 'Verbale riunione' })).toBeVisible()
    // il contenuto e' mostrato come testo, non come HTML
    await expect(pub.locator('body')).toContainText('<b>contenuto riservato</b>')
    await pub.close()
    await logout(page)
  })

  test('Tenant Manager: la nota condivisa in sola lettura, condivisioni e consumi', async ({ page }) => {
    await login(page, 'Comune di Alfa', 'gestore', PASSWORD)
    await expect(page.getByRole('heading', { name: 'Panoramica del tenant' })).toBeVisible()
    // modo scuro, con il tema del tenant
    await page.getByRole('button', { name: 'Tonalità' }).click()
    await page.getByRole('menuitemradio', { name: 'Scuro' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await accessible(page, 'panoramica del tenant, scuro')
    await page.getByRole('button', { name: 'Tonalità' }).click()
    await page.getByRole('menuitemradio', { name: 'Chiaro' }).click()
    await nav(page, 'Note').click()
    const frame = page.frameLocator('iframe.plugin-frame')
    const row = frame.locator('tbody tr.row', { hasText: 'Verbale riunione' })
    await expect(row).toContainText('sola lettura')
    await row.click()
    await expect(frame.locator('[data-key="title"]')).toBeDisabled()
    await expect(frame.getByRole('button', { name: 'Salva' })).toBeHidden()

    await nav(page, 'Condivisioni').click()
    await expect(page.getByRole('row', { name: /Verbale riunione/ })).toContainText('Anna Rossi')
    await page.getByRole('radio', { name: /Pubblici/ }).click()
    await expect(page.getByRole('row', { name: /Verbale riunione/ })).toBeVisible()
    await accessible(page, 'condivisioni')

    await nav(page, 'Consumi').click()
    await expect(page.getByText('Note per tag')).toBeVisible()
    await expect(page.getByRole('table', { name: /Note per tag/ })).toContainText('personale')
    await accessible(page, 'consumi')
    await logout(page)
  })

  test("l'iframe del plugin non accede all'app", async ({ page }) => {
    await login(page, 'Comune di Alfa', 'anna', NEW_PASSWORD)
    await nav(page, 'Note').click()
    const frameEl = page.locator('iframe.plugin-frame')
    await expect(frameEl).toHaveAttribute('src', new RegExp(`^http://127\\.0\\.0\\.1:18081${BASE}/ui/`))
    const frame = page.frames().find((f) => f.url().includes(`:18081${BASE}/ui/`))!
    // origine diversa: niente cookie di sessione, niente DOM del padre
    expect(await frame.evaluate(() => document.cookie)).not.toContain('msk_session')
    const parentAccess = await frame.evaluate(() => {
      try {
        return String(window.parent.document.title)
      } catch {
        return 'bloccato'
      }
    })
    expect(parentAccess).toBe('bloccato')
    // una chiamata diretta alle API dell'app dall'iframe fallisce (CORS e CSRF)
    const direct = await frame.evaluate(async (base) => {
      try {
        const r = await fetch(`http://127.0.0.1:18080${base}/api/session`, { credentials: 'include' })
        return String(r.status)
      } catch {
        return 'bloccato'
      }
    }, BASE)
    expect(direct).toBe('bloccato')
    await logout(page)
  })

  test('lingua: inglese in tutta la cornice, errori del server tradotti', async ({ page }) => {
    await fresh(page)
    await page.getByRole('combobox', { name: 'Lingua' }).click()
    await page.getByRole('option', { name: 'English' }).click()
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    // l'errore arriva con il suo codice e si legge nella lingua scelta
    await page.getByRole('combobox', { name: 'Tenant' }).click()
    await page.getByRole('option', { name: 'Comune di Alfa' }).click()
    await page.getByLabel('Username').fill('anna')
    await page.getByLabel('Password').fill('sbagliata-123')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('alert')).toHaveText('Wrong username or password')
    await page.getByLabel('Password').fill(NEW_PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
    await expect(page.getByText('Your space')).toBeVisible()
    await expect(page.getByRole('button', { name: /person menu/ })).toBeVisible()
    // nessuna frase italiana rimasta nella cornice e nella pagina
    const text = await page.locator('body').innerText()
    expect(text).not.toMatch(/\b(Il tuo spazio|Condivisi da me|Gestione del tenant|Impostazioni|Esci|Notifiche)\b/)
    // il plugin riceve la lingua nuova
    await page.getByRole('link', { name: 'Notes', exact: true }).or(nav(page, 'Note')).first().click()
    await expect(page.locator('iframe.plugin-frame')).toBeVisible()
  })

  test('telefono: la sidebar diventa un pannello', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 820 } })
    const page = await ctx.newPage()
    await login(page, 'Comune di Alfa', 'gestore', PASSWORD)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'Apri o chiudi la sidebar' }).first().click()
    const drawer = page.getByRole('dialog', { name: 'Navigazione' })
    await expect(drawer).toBeVisible()
    await drawer.getByRole('link', { name: 'Gestisci', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Gestisci' })).toBeVisible()
    await accessible(page, 'telefono')
    await ctx.close()
  })

  test('temi: contrasto della barra e dei pulsanti (WCAG AA), chiaro e scuro', async ({ page }) => {
    await fresh(page)
    const ratios = await page.evaluate(() => {
      const rgb = (c: string) => {
        const el = document.createElement('i')
        el.style.color = c
        document.body.appendChild(el)
        const m = getComputedStyle(el).color.match(/[\d.]+/g)!.map(Number)
        el.remove()
        return m
      }
      const lum = (c: string) => {
        const [r, g, b] = rgb(c).map((v) => {
          const s = v / 255
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      const ratio = (a: string, b: string) => {
        const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
        return (x + 0.05) / (y + 0.05)
      }
      const root = document.documentElement
      const out: Record<string, number> = {}
      for (const preset of ['mosaikit', 'italia', 'tessera'])
        for (const dark of [false, true]) {
          root.dataset.preset = preset
          root.classList.toggle('dark', dark)
          const v = (n: string) => getComputedStyle(root).getPropertyValue(n).trim()
          const k = `${preset}${dark ? ' scuro' : ''}`
          out[`${k}: barra`] = ratio(v('--band-foreground'), v('--band'))
          out[`${k}: pulsante`] = ratio(v('--primary-foreground'), v('--primary'))
          out[`${k}: testo`] = ratio(v('--foreground'), v('--background'))
          out[`${k}: testo secondario`] = ratio(v('--muted-foreground'), v('--background'))
        }
      return out
    })
    for (const [k, r] of Object.entries(ratios)) expect(r, k).toBeGreaterThanOrEqual(4.5)
  })
})
