import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { crc32 } from 'node:zlib'
import { PASSWORD, adminLogin, login } from './support'

// Documents (com.mosaikit.files): a zip is unpacked into a folder (the dialog of the upload) and the folder is served as a
// static tree through the address of a ticket, with byte ranges and ETag. Self-contained: it makes its own tenant.

const API = (page: Page, method: string, path: string, body?: unknown) =>
  page.evaluate(
    async ([method, path, body]) => {
      const s = await (await fetch('api/session')).json()
      const r = await fetch(path as string, { method: method as string, headers: { 'content-type': 'application/json', 'x-csrf-token': s.csrf }, body: body === undefined ? undefined : JSON.stringify(body) })
      return { status: r.status, json: await r.json().catch(() => null) }
    },
    [method, path, body] as const,
  )

/** A zip with stored (not compressed) entries. */
function zip(entries: Record<string, string>): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(entries)) {
    const n = Buffer.from(name)
    const data = Buffer.from(text)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(n.length, 26)
    parts.push(local, n, data)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(20, 4)
    c.writeUInt16LE(20, 6)
    c.writeUInt32LE(crc, 16)
    c.writeUInt32LE(data.length, 20)
    c.writeUInt32LE(data.length, 24)
    c.writeUInt16LE(n.length, 28)
    c.writeUInt32LE(offset, 42)
    central.push(c, n)
    offset += local.length + n.length + data.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(entries).length, 8)
  end.writeUInt16LE(Object.keys(entries).length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cd, end])
}

test.describe.serial('24-files-tree', () => {
  test('a zip unpacked into a folder is served as a tree with ranges and ETag', async ({ page }) => {
    test.setTimeout(180_000)
    await adminLogin(page)
    const made = await API(page, 'POST', 'api/admin/tenants', { slug: 'treeco', name: 'Tree Co', manager_username: 'mgr', manager_email: 'mgr@treeco.example.org', manager_password: PASSWORD })
    expect(made.status).toBeLessThan(410)
    await page.context().clearCookies()
    await login(page, 'Tree Co', 'mgr', PASSWORD)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('./#/t/treeco/p/com.mosaikit.files')
    const frame = page.frameLocator('iframe.plugin-frame')

    await frame.locator('input[type="file"]:not([webkitdirectory])').setInputFiles([
      { name: 'tiles.zip', mimeType: 'application/zip', buffer: zip({ 'tileset.json': '{"asset":{"version":"1.1"}}', 'tiles/0/a.b3dm': '0123456789', '__MACOSX/._tileset.json': 'junk' }) },
    ])
    // the zip is not unpacked until the person chooses
    const dlg = frame.locator('.fm-dlg')
    await expect(dlg).toContainText('tiles.zip')
    await dlg.getByRole('button', { name: 'Unpack into a new folder' }).click()
    const row = frame.locator('.fm-main').getByText('tiles', { exact: true }).first()
    await expect(row).toBeVisible()

    const list = await API(page, 'GET', 'api/t/treeco/p/com.mosaikit.files/files')
    const folder = list.json.entries.find((e: { name: string }) => e.name === 'tiles')
    expect(folder.is_dir).toBe(true)
    const inside = await API(page, 'GET', `api/t/treeco/p/com.mosaikit.files/files?parent=${folder.id}`)
    expect(inside.json.entries.map((e: { name: string }) => e.name).sort()).toEqual(['tiles', 'tileset.json'])

    // the address of the folder: its files by relative path
    const t = await API(page, 'POST', `api/t/treeco/p/com.mosaikit.files/ticket/${folder.id}`, {})
    expect(t.status).toBe(200)
    const base: string = t.json.url
    expect(base.endsWith('/')).toBe(true)
    const json = await page.request.get(base + 'tileset.json')
    expect(json.status()).toBe(200)
    expect(await json.json()).toEqual({ asset: { version: '1.1' } })
    expect(json.headers()['accept-ranges']).toBe('bytes')
    expect(json.headers()['access-control-allow-origin']).toBe('*')

    const part = await page.request.get(base + 'tiles/0/a.b3dm', { headers: { range: 'bytes=2-5' } })
    expect(part.status()).toBe(206)
    expect(part.headers()['content-range']).toBe('bytes 2-5/10')
    expect((await part.body()).toString()).toBe('2345')
    const tail = await page.request.get(base + 'tiles/0/a.b3dm', { headers: { range: 'bytes=-3' } })
    expect((await tail.body()).toString()).toBe('789')
    const past = await page.request.get(base + 'tiles/0/a.b3dm', { headers: { range: 'bytes=50-' } })
    expect(past.status()).toBe(416)

    const etag = json.headers()['etag']
    expect(etag).toBeTruthy()
    expect((await page.request.get(base + 'tileset.json', { headers: { 'if-none-match': etag } })).status()).toBe(304)

    // what is not in the folder is not served: a missing file, a folder, the junk of the zip (a path that climbs is refused by the resolver, kernel test `folder_served_as_a_tree`: a client folds `..` before sending)
    for (const p of ['missing.json', 'tiles/', 'tiles/0', '__MACOSX/._tileset.json']) {
      expect((await page.request.get(base + p)).status(), p).toBe(404)
    }

    // the folder has a marker a plugin knows (the fixture « Folder probe »): the notice, in the bell and in Files
    const note = frame.locator('.fm-note')
    await expect(note).toContainText('“tiles” looks like a 3D Tiles dataset')
    const bell = await API(page, 'GET', 'api/me/notifications')
    expect(JSON.stringify(bell.json)).toContain('looks like 3D Tiles dataset')
    // its button opens the plugin at that folder; the page reads where it was opened and what the Files calls answer
    await note.getByRole('button', { name: 'Open in Folder probe' }).click()
    await expect(page).toHaveURL(/#\/t\/treeco\/p\/com\.mosaikit\.e2e-folder-probe\/profile%2Ftiles3d%2F/)
    const probe = page.frameLocator('iframe.plugin-frame')
    await expect(probe.locator('#at')).toHaveText(`profile/tiles3d/${folder.id}?source=com.mosaikit.files`)
    await expect(probe.locator('#list')).toHaveText('ok')
    await expect(probe.locator('#mkdir')).toHaveText(/^err:/)
    await expect(probe.locator('#profiles')).toHaveText('tiles3d')
  })

  test('a folder picked from the disk is uploaded with its structure, and the app that knows it is offered', async ({ page }) => {
    test.setTimeout(180_000)
    // a folder on disk: files, a folder inside it and an empty one
    const root = fs.mkdtempSync(path.join(process.env.MOSAIKIT_TEMP ?? os.tmpdir(), 'folder-upload-'))
    try {
      const dir = path.join(root, 'plateau')
      fs.mkdirSync(path.join(dir, 'tiles', '0'), { recursive: true })
      fs.mkdirSync(path.join(dir, 'empty'))
      fs.writeFileSync(path.join(dir, 'tileset.json'), '{"asset":{"version":"1.1"}}')
      fs.writeFileSync(path.join(dir, 'tiles', '0', 'a.b3dm'), 'tile')
      await login(page, 'Tree Co', 'mgr', PASSWORD)
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto('./#/t/treeco/p/com.mosaikit.files')
      const frame = page.frameLocator('iframe.plugin-frame')
      // «Upload folder» in the menu of the page asks the browser for a folder (the chooser is answered with the one on disk)
      const pickFolder = async () => {
        const chooser = page.waitForEvent('filechooser')
        await frame.locator('.fm-main').click({ button: 'right', position: { x: 20, y: 480 } })
        await frame.getByRole('menuitem', { name: 'Upload folder' }).click()
        await (await chooser).setFiles(dir)
      }
      await pickFolder()
      await expect(frame.locator('.fm-main').getByText('plateau', { exact: true }).first()).toBeVisible()
      await expect(frame.locator('.fm-note')).toContainText('“plateau” looks like a 3D Tiles dataset')

      const list = await API(page, 'GET', 'api/t/treeco/p/com.mosaikit.files/files')
      const top = list.json.entries.find((e: { name: string }) => e.name === 'plateau')
      expect(top.is_dir).toBe(true)
      const names = async (id: string) => (await API(page, 'GET', `api/t/treeco/p/com.mosaikit.files/files?parent=${id}`)).json.entries.map((e: { name: string }) => e.name).sort()
      expect(await names(top.id)).toEqual(['tiles', 'tileset.json'])
      // the same folder again: a new one next to it, nothing merged
      await pickFolder()
      await expect(frame.locator('.fm-main').getByText('plateau (1)', { exact: true }).first()).toBeVisible()
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
