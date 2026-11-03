# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 14-lang-es-coverage.spec.ts >> Spanish covers the whole shell >> nothing left in English
- Location: specs\14-lang-es-coverage.spec.ts:132:3

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 6

- Array []
+ Array [
+   "admin-overview: Disco casi lleno: 1.2% of the disk free",
+   "admin-overview: Alerta: 1.4% of the disk free",
+   "tenant-account-appearance: Names under the icons",
+   "tenant-account-appearance: In the closed sidebar. Off: only the icons, the name shows as a tooltip.",
+ ]
```

# Test source

```ts
  36  | 
  37  | const same: string[] = []
  38  | async function scan(page: Page, name: string, found: string[]) {
  39  |   await page.waitForTimeout(700)
  40  |   if (process.env.LANG_EXPLORE) {
  41  |     const es = await lines(page)
  42  |     await page.evaluate(() => localStorage.setItem('msk_lang', 'en'))
  43  |     await page.reload()
  44  |     await page.waitForTimeout(900)
  45  |     const en = new Set(await lines(page))
  46  |     same.push(...es.filter((l) => en.has(l) && /[A-Za-z]{4}/.test(l)).map((l) => `${name}: ${l}`))
  47  |     await page.evaluate(() => localStorage.setItem('msk_lang', 'es'))
  48  |     await page.reload()
  49  |     await page.waitForTimeout(900)
  50  |   }
  51  |   fs.mkdirSync(OUT, { recursive: true })
  52  |   await page.screenshot({ path: new URL(`${name}.png`, OUT).pathname.replace(/^\/([A-Za-z]:)/, '$1') })
  53  |   for (const l of await lines(page)) if (ENGLISH.test(l.replace(DATA, '')) && !ALLOWED.test(l)) found.push(`${name}: ${l}`)
  54  | }
  55  | 
  56  | async function spanish(page: Page) {
  57  |   await page.evaluate(() => localStorage.setItem('msk_lang', 'es'))
  58  |   await page.reload()
  59  | }
  60  | 
  61  | test.describe.serial('Spanish covers the whole shell', () => {
  62  |   const found: string[] = []
  63  | 
  64  |   test('Administrator pages', async ({ page }) => {
  65  |     await adminLogin(page)
  66  |     await nav(page, 'Tenants').click()
  67  |     await createTenant(page, SLUG, 'Ciudad ES')
  68  |     await spanish(page)
  69  |     for (const [name, hash] of [
  70  |       ['admin-overview', '#/admin'],
  71  |       ['admin-tenants', '#/admin/tenants'],
  72  |       ['admin-people', '#/admin/people'],
  73  |       ['admin-plugins', '#/admin/plugins'],
  74  |       ['admin-plugin', '#/admin/plugin/com.mosaikit.notes'],
  75  |       ['admin-system', '#/admin/system'],
  76  |       ['admin-keys', '#/admin/system/keys'],
  77  |       ['admin-email', '#/admin/system/email'],
  78  |       ['admin-admins', '#/admin/system/admins'],
  79  |       ['admin-backup', '#/admin/system/backup'],
  80  |       ['admin-quotas', '#/admin/system/quotas'],
  81  |       ['admin-monitoring', '#/admin/system/monitoring'],
  82  |       ['admin-log', '#/admin/system/log'],
  83  |     ] as const) {
  84  |       await page.goto('./' + hash)
  85  |       await scan(page, name, found)
  86  |     }
  87  |   })
  88  | 
  89  |   test('Tenant Manager pages', async ({ page }) => {
  90  |     await fresh(page)
  91  |     await page.getByLabel('Username').fill('manager')
  92  |     const select = page.getByRole('combobox', { name: 'Tenant' })
  93  |     if (await select.count()) {
  94  |       await select.click()
  95  |       await page.getByRole('option', { name: 'Ciudad ES' }).click()
  96  |     }
  97  |     await page.getByLabel('Password').fill(PASSWORD)
  98  |     await page.getByRole('button', { name: 'Sign in' }).click()
  99  |     await expect(page.getByRole('button', { name: /person menu/ })).toBeVisible()
  100 |     await spanish(page)
  101 |     for (const [name, hash] of [
  102 |       ['home', ''],
  103 |       ['overview', '/overview'],
  104 |       ['manage', '/manage'],
  105 |       ['groups', '/manage/groups'],
  106 |       ['profiles', '/manage/profiles'],
  107 |       ['pending', '/manage/pending'],
  108 |       ['plugins', '/plugins'],
  109 |       ['shares', '/shares'],
  110 |       ['usage', '/usage'],
  111 |       ['log', '/log'],
  112 |       ['settings', '/settings'],
  113 |       ['trash', '/trash'],
  114 |       ['account', '/account'],
  115 |       ['account-security', '/account/security'],
  116 |       ['account-appearance', '/account/appearance'],
  117 |       ['account-usage', '/account/usage'],
  118 |       ['account-notifications', '/account/notifications'],
  119 |       ['notes', '/app/com.mosaikit.notes'],
  120 |     ] as const) {
  121 |       await page.goto(`./#/t/${SLUG}${hash}`)
  122 |       await scan(page, `tenant-${name}`, found)
  123 |     }
  124 |     // the dialogs and menus of the top bar
  125 |     await page.getByRole('button', { name: /Ayuda/ }).first().click()
  126 |     await scan(page, 'tenant-help-menu', found)
  127 |     await page.keyboard.press('Escape')
  128 |     await page.getByRole('button', { name: /Notificaciones/ }).first().click()
  129 |     await scan(page, 'tenant-notifications', found)
  130 |   })
  131 | 
  132 |   test('nothing left in English', async () => {
  133 |     fs.mkdirSync(OUT, { recursive: true })
  134 |     fs.writeFileSync(new URL('english-left.txt', OUT), found.join('\n'))
  135 |     fs.writeFileSync(new URL('same-in-both.txt', OUT), same.join('\n'))
> 136 |     expect(found).toEqual([])
      |                   ^ Error: expect(received).toEqual(expected) // deep equality
  137 |   })
  138 | })
  139 | 
```