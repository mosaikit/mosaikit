import { createHmac } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

// Scenario completo: amministratore -> tenant -> gestore -> membro -> plugin in
// iframe -> condivisione -> link pubblico -> isolamento e KPI del gestore.

const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'e2e-admin-password'
const PASSWORD = 'password-e2e-123'
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

async function login(page: Page, tenant: string, user: string, password: string) {
  await page.goto('./')
  await expect(page.getByLabel('Utente')).toBeVisible()
  // il menu dei tenant compare solo se ce n'e' piu' di uno
  const select = page.getByLabel('Tenant')
  if (await select.count()) await select.selectOption(tenant)
  await page.getByLabel('Utente').fill(user)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Accedi' }).click()
  await expect(page.locator('.statusbar')).toContainText(user)
}

/** Accesso amministratori; al primo accesso registra il secondo fattore. */
async function adminLogin(page: Page) {
  await page.goto('./#/admin')
  await expect(page.getByText('Accesso amministratori')).toBeVisible()
  await page.getByLabel('Utente').fill('admin')
  await page.getByLabel('Password').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Accedi' }).click()
  const secret = page.locator('.totp-secret')
  await expect(secret).toBeVisible()
  await expect(page.getByRole('img', { name: "QR code da inquadrare con l'app" })).toBeVisible()
  await page.getByLabel("Codice mostrato dall'app").fill(totp((await secret.textContent()) ?? ''))
  await page.getByRole('button', { name: 'Attiva e accedi' }).click()
  await expect(page.getByLabel('Codici di recupero').locator('li')).toHaveCount(10)
  await page.getByRole('button', { name: 'Ho salvato i codici: continua' }).click()
  await expect(page.locator('.statusbar')).toContainText('admin')
}

async function logout(page: Page) {
  await page.getByRole('button', { name: 'Esci' }).click()
  await expect(page.getByRole('button', { name: 'Accedi' })).toBeVisible()
}

test.describe.serial('piattaforma', () => {
  test('amministratore: secondo fattore, plugin preinstallati e nuovo tenant', async ({ page }) => {
    // prima di ogni tenant la pagina di accesso lo dice e rimanda all'accesso amministratori
    await page.goto('./')
    await expect(page.getByText('Nessun tenant disponibile.')).toBeVisible()
    await adminLogin(page)
    await expect(page.locator('.overview')).toContainText('Administrator')
    await page.getByTitle('Amministrazione di sistema').click()
    await page.getByRole('tab', { name: 'Plugin' }).click()
    for (const name of ['Note', 'Attività', 'Contatti', 'Mappe', 'Siti statici', 'File']) {
      await expect(page.locator('tr', { hasText: name }).first()).toContainText('active')
    }
    await page.getByRole('tab', { name: 'Tenant' }).click()
    await page.getByLabel('Slug').fill('alfa')
    await page.getByLabel('Nome', { exact: true }).fill('Comune di Alfa')
    await page.getByLabel('Username del Tenant Manager').fill('gestore')
    await page.getByLabel('Password del Tenant Manager').fill(PASSWORD)
    await page.getByRole('button', { name: 'Crea tenant' }).click()
    await expect(page.locator('tr', { hasText: 'Comune di Alfa' })).toBeVisible()
    // utenti e gestori del tenant, visti dall'amministratore
    await page.locator('tr', { hasText: 'Comune di Alfa' }).getByRole('button', { name: 'Utenti e gestori' }).click()
    await expect(page.locator('.tenant-users tr', { hasText: 'gestore@alfa' })).toContainText('Tenant Manager')
    await logout(page)
  })

  test('gestore: crea un membro', async ({ page }) => {
    await login(page, 'alfa', 'gestore', PASSWORD)
    await page.getByTitle('Gestione del tenant').click()
    await page.getByLabel('Username').fill('anna')
    await page.getByLabel('Nome visualizzato').fill('Anna Rossi')
    await page.getByLabel('Password iniziale').fill(PASSWORD)
    await page.getByRole('button', { name: 'Crea utente' }).click()
    await expect(page.locator('tr', { hasText: 'Anna Rossi' })).toBeVisible()
    await logout(page)
  })

  test('membro: nota nel plugin, condivisione e link pubblico', async ({ page, context }) => {
    await login(page, 'alfa', 'anna', PASSWORD)
    await page.getByRole('button', { name: 'Note', exact: false }).first().click()
    const frame = page.frameLocator('iframe.plugin-frame')
    await expect(frame.getByRole('heading', { name: 'Note' })).toBeVisible()
    await frame.locator('[data-key="title"]').fill('Verbale riunione')
    await frame.locator('[data-key="body"]').fill('<b>contenuto riservato</b>')
    await frame.getByRole('button', { name: 'Salva' }).click()
    const row = frame.locator('tbody tr.row', { hasText: 'Verbale riunione' })
    await expect(row).toBeVisible()
    // hook WASM del plugin: tag di default
    await expect(row).toContainText('personale')

    // condivisione in lettura con il gestore (finestra dell'host)
    await frame.getByRole('button', { name: 'Condividi…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Condivisione' })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Cerca utenti o gruppi').fill('gestore')
    await dialog.locator('.picker-list button', { hasText: 'gestore' }).click()
    await dialog.getByRole('button', { name: 'Condividi', exact: true }).click()
    await expect(dialog.locator('tr', { hasText: 'gestore@alfa' })).toBeVisible()

    // link pubblico
    await dialog.getByRole('button', { name: 'Crea link' }).click()
    const url = await dialog.getByLabel('Link pubblico').inputValue()
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

  test('gestore: vede la nota condivisa in sola lettura e i KPI', async ({ page }) => {
    await login(page, 'alfa', 'gestore', PASSWORD)
    // pagina iniziale: Panoramica con i dati del ruolo (Tenant Manager: anche il tenant)
    const overview = page.locator('.overview')
    await expect(page.getByRole('heading', { name: 'Panoramica' })).toBeVisible()
    await expect(overview).toContainText('Tenant Manager')
    await expect(overview.locator('.ov-list').first()).toContainText('Verbale riunione')
    await expect(overview).toContainText('Il tenant Comune di Alfa')
    await page.getByRole('button', { name: 'Note', exact: false }).first().click()
    const frame = page.frameLocator('iframe.plugin-frame')
    const row = frame.locator('tbody tr.row', { hasText: 'Verbale riunione' })
    await expect(row).toContainText('sola lettura')
    await row.click()
    await expect(frame.locator('[data-key="title"]')).toBeDisabled()
    await expect(frame.getByRole('button', { name: 'Salva' })).toBeHidden()

    await page.getByTitle('Gestione del tenant').click()
    await page.getByRole('tab', { name: 'Risorse' }).click()
    await expect(page.locator('tr', { hasText: 'Verbale riunione' })).toContainText('Anna Rossi')
    await page.getByRole('tab', { name: 'KPI' }).click()
    await expect(page.locator('.kpi-card', { hasText: 'risorse' })).toContainText('1')
    await expect(page.locator('.card', { hasText: 'Note per tag' })).toContainText('personale')
    await logout(page)
  })

  test("l'iframe del plugin non accede all'app", async ({ page }) => {
    await login(page, 'alfa', 'anna', PASSWORD)
    await page.getByRole('button', { name: 'Note', exact: false }).first().click()
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
})
