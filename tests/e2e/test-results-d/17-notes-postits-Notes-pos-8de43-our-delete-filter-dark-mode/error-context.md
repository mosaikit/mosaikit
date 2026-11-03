# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 17-notes-postits.spec.ts >> Notes: post-its >> colour, size kept after a reload, tags (create, rename, colour, delete), filter, dark mode
- Location: specs\17-notes-postits.spec.ts:20:3

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator: locator('iframe.plugin-frame').contentFrame().locator('.msk-item.pi').filter({ hasText: 'Postit B' }).locator('.pi-tag')
Timeout: 15000ms
- Expected  - 4
+ Received  + 1

- Array [
-   "ideas",
-   "errands",
- ]
+ Array []

Call log:
  - Expect "toHaveText" locator('iframe.plugin-frame').contentFrame().locator('.msk-item.pi').filter({ hasText: 'Postit B' }).locator('.pi-tag') with timeout 15000ms
  - waiting for locator('iframe.plugin-frame').contentFrame().locator('.msk-item.pi').filter({ hasText: 'Postit B' }).locator('.pi-tag')
    24 × locator resolved to 0 elements

```

# Page snapshot

```yaml
- generic [ref=f3e2]:
  - generic [ref=f3e4]:
    - button "Skip to the content" [ref=f3e5]
    - generic [ref=f3e8]:
      - generic [ref=f3e22]:
        - list [ref=f3e25]:
          - listitem [ref=f3e26]:
            - link "Tenant overview" [ref=f3e27] [cursor=pointer]:
              - /url: "#/t/alfa"
              - generic [ref=f3e33]: Overview
        - list [ref=f3e36]:
          - listitem [ref=f3e37]:
            - link "Contacts" [ref=f3e38] [cursor=pointer]:
              - /url: "#/t/alfa/p/com.mosaikit.contacts"
          - listitem [ref=f3e44]:
            - link "Documents" [ref=f3e45] [cursor=pointer]:
              - /url: "#/t/alfa/p/com.mosaikit.files"
          - listitem [ref=f3e49]:
            - link "Maps" [ref=f3e50] [cursor=pointer]:
              - /url: "#/t/alfa/p/com.mosaikit.maps"
          - listitem [ref=f3e54]:
            - link "Notes" [ref=f3e55] [cursor=pointer]:
              - /url: "#/t/alfa/p/com.mosaikit.notes"
            - button "Open the pages of Notes" [ref=f3e60]
          - listitem [ref=f3e63]:
            - link "Sites" [ref=f3e64] [cursor=pointer]:
              - /url: "#/t/alfa/p/com.mosaikit.static-site"
          - listitem [ref=f3e71]:
            - link "Tasks" [ref=f3e72] [cursor=pointer]:
              - /url: "#/t/alfa/p/com.mosaikit.tasks"
        - list [ref=f3e79]:
          - listitem [ref=f3e80]:
            - link "Manage" [ref=f3e81] [cursor=pointer]:
              - /url: "#/t/alfa/manage"
          - listitem [ref=f3e88]:
            - link "Plugins" [ref=f3e89] [cursor=pointer]:
              - /url: "#/t/alfa/plugins"
          - listitem [ref=f3e93]:
            - link "Shares" [ref=f3e94] [cursor=pointer]:
              - /url: "#/t/alfa/shares"
          - listitem [ref=f3e102]:
            - link "Usage" [ref=f3e103] [cursor=pointer]:
              - /url: "#/t/alfa/usage"
          - listitem [ref=f3e108]:
            - link "Log" [ref=f3e109] [cursor=pointer]:
              - /url: "#/t/alfa/log"
      - list [ref=f3e116]:
        - listitem [ref=f3e117]:
          - link "Tenant settings" [ref=f3e118] [cursor=pointer]:
            - /url: "#/t/alfa/settings"
            - generic [ref=f3e122]: Settings
    - main [ref=f3e123]:
      - generic [ref=f3e124]:
        - generic [ref=f3e125]:
          - button "Open or close the sidebar" [ref=f3e126]
          - generic [ref=f3e129]:
            - generic [ref=f3e130]: CO
            - generic [ref=f3e131]: City of Alfa
        - button "Search everywhere Ctrl K" [ref=f3e133]:
          - generic [ref=f3e137]: Search everywhere
          - generic [ref=f3e138]: Ctrl K
        - generic [ref=f3e140]:
          - 'button "EN · Language: English" [ref=f3e141]': EN
          - button "Mode" [ref=f3e142]
          - button "Help" [ref=f3e146]
          - button "Notifications" [ref=f3e150]
          - button "manager Tenant Manager person menu" [ref=f3e154]:
            - generic [ref=f3e155]:
              - generic [ref=f3e156]: manager
              - generic [ref=f3e157]: Tenant Manager
            - generic [ref=f3e158]: person menu
            - generic [ref=f3e160]: M
      - iframe [active] [ref=f3e164]:
        - generic [ref=f4e2]:
          - generic [ref=f4e4]:
            - generic [ref=f4e5]:
              - generic [ref=f4e6]:
                - heading "Notes" [level=1] [ref=f4e7]
                - generic [ref=f4e8]: ›
                - generic [ref=f4e9]: All notes
              - text: 2 items
            - generic [ref=f4e10]:
              - group "View" [ref=f4e11]:
                - button "Post-its" [pressed] [ref=f4e12] [cursor=pointer]
                - button "List" [ref=f4e13] [cursor=pointer]
              - searchbox "Filter" [ref=f4e14]
              - button "＋ New note" [ref=f4e15] [cursor=pointer]
          - generic [ref=f4e17]:
            - generic [ref=f4e18]:
              - generic [ref=f4e19]:
                - combobox "Filter by tag" [ref=f4e20]:
                  - option "All tags" [selected]
                  - option "ideas"
                  - option "personal"
                - button "Tags" [ref=f4e21] [cursor=pointer]
              - list [ref=f4e23]:
                - listitem [ref=f4e24] [cursor=pointer]:
                  - generic [ref=f4e25]:
                    - strong [ref=f4e26]: Postit A
                    - paragraph [ref=f4e27]: Buy paper Call Anna
                    - generic [ref=f4e28]: ideas
                  - button "Colour of the note" [ref=f4e30]
                  - 'button "Resize the note: drag, or press Alt and the arrow keys" [ref=f4e31]'
                - listitem [ref=f4e32] [cursor=pointer]:
                  - generic [ref=f4e33]:
                    - strong [ref=f4e34]: Weekly plan v2
                    - paragraph [ref=f4e35]: "Monday: kickoff Tuesday: review"
                    - generic [ref=f4e36]: personal
                  - button "Colour of the note" [ref=f4e38]
                  - 'button "Resize the note: drag, or press Alt and the arrow keys" [ref=f4e39]'
            - complementary "Detail" [ref=f4e40]:
              - generic [ref=f4e41]:
                - heading "New item" [level=3] [ref=f4e42]
                - tablist "Sections of the item" [ref=f4e43]
                - generic [ref=f4e44]:
                  - generic [ref=f4e45]:
                    - generic [ref=f4e46]: Title *
                    - textbox "Title *" [ref=f4e47]
                  - generic [ref=f4e48]:
                    - generic [ref=f4e49]: Text
                    - textbox "Text" [ref=f4e50]
                  - generic [ref=f4e51]:
                    - generic [ref=f4e52]:
                      - generic [ref=f4e53]: Colour
                      - radiogroup "Colour of the note" [ref=f4e54]:
                        - radio "yellow" [checked] [ref=f4e55] [cursor=pointer]
                        - radio "orange" [ref=f4e56] [cursor=pointer]
                        - radio "pink" [ref=f4e57] [cursor=pointer]
                        - radio "violet" [ref=f4e58] [cursor=pointer]
                        - radio "blue" [ref=f4e59] [cursor=pointer]
                        - radio "teal" [ref=f4e60] [cursor=pointer]
                        - radio "green" [ref=f4e61] [cursor=pointer]
                        - radio "grey" [ref=f4e62] [cursor=pointer]
                    - generic [ref=f4e63]:
                      - generic [ref=f4e64]: Tags
                      - group "Tags of the note" [ref=f4e65]:
                        - button "ideas" [pressed] [ref=f4e66] [cursor=pointer]
                        - button "personal" [ref=f4e67] [cursor=pointer]
                        - button "errands" [pressed] [ref=f4e68] [cursor=pointer]
                      - generic [ref=f4e69]:
                        - textbox "New tag" [ref=f4e70]
                        - button "Add" [ref=f4e71] [cursor=pointer]
                - generic [ref=f4e72]:
                  - button "Save" [ref=f4e73] [cursor=pointer]
                  - button "Cancel" [ref=f4e74] [cursor=pointer]
                - status [ref=f4e75]: Invalid request
  - region "Notifications alt+T"
```

# Test source

```ts
  1   | import { expect, test, type FrameLocator, type Page } from '@playwright/test'
  2   | import { PASSWORD, accessible, login, nav } from './support'
  3   | 
  4   | // Notes as post-its (docs/manual-tests.md, NPI-01..04): colour, quick colour menu, resize (keyboard and drag) kept after a
  5   | // reload, tags of the person (create, rename, change colour, delete removes it from the notes), filter by tag, light and dark.
  6   | 
  7   | const frameOf = (page: Page) => page.frameLocator('iframe.plugin-frame')
  8   | const postit = (frame: FrameLocator, title: string) => frame.locator('.msk-item.pi', { hasText: title })
  9   | const size = (frame: FrameLocator, title: string) =>
  10  |   postit(frame, title).evaluate((e) => ({ w: Math.round((e as HTMLElement).offsetWidth), h: Math.round((e as HTMLElement).offsetHeight) }))
  11  | 
  12  | async function openNotes(page: Page) {
  13  |   await nav(page, 'Notes').click()
  14  |   const frame = frameOf(page)
  15  |   await expect(frame.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible()
  16  |   return frame
  17  | }
  18  | 
  19  | test.describe.serial('Notes: post-its', () => {
  20  |   test('colour, size kept after a reload, tags (create, rename, colour, delete), filter, dark mode', async ({ browser }) => {
  21  |     const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  22  |     const page = await ctx.newPage()
  23  |     await login(page, 'Alfa', 'manager', PASSWORD)
  24  |     let frame = await openNotes(page)
  25  | 
  26  |     // a note with a colour from the editor and a tag of its own
  27  |     await frame.getByRole('button', { name: /^＋ New/ }).first().click()
  28  |     await frame.locator('[data-key="title"]').fill('Postit A')
  29  |     await frame.locator('[data-key="body"]').fill('Buy paper\nCall Anna')
  30  |     await frame.getByRole('radio', { name: 'pink' }).click()
  31  |     await frame.getByRole('textbox', { name: 'New tag' }).fill('ideas')
  32  |     await frame.getByRole('button', { name: 'Add', exact: true }).click()
  33  |     await frame.getByRole('button', { name: 'Save' }).click()
  34  |     await expect(postit(frame, 'Postit A')).toHaveClass(/pc-pink/)
  35  |     await expect(postit(frame, 'Postit A').locator('.pi-tag', { hasText: 'ideas' })).toBeVisible()
  36  |     await expect(postit(frame, 'Postit A').locator('.pi-tag', { hasText: 'personal' })).toHaveCount(0)
  37  |     // a post-it is slightly turned, the same on every drawing, straight under the pointer
  38  |     const tilt = () => postit(frame, 'Postit A').evaluate((e) => (e as HTMLElement).style.getPropertyValue('--pi-tilt'))
  39  |     const t0 = await tilt()
  40  |     expect(t0).toMatch(/deg$/)
  41  | 
  42  |     // the quick menu of the colour on the post-it
  43  |     await frame.locator('.msk-detail').press('Escape')
  44  |     await postit(frame, 'Postit A').locator('.pi-pal').click()
  45  |     await postit(frame, 'Postit A').getByRole('button', { name: 'blue' }).click()
  46  |     await expect(postit(frame, 'Postit A')).toHaveClass(/pc-blue/)
  47  | 
  48  |     // size: Alt+arrows, bounds, drag; all kept after a reload
  49  |     const start = await size(frame, 'Postit A')
  50  |     expect(start).toEqual({ w: 240, h: 200 })
  51  |     await postit(frame, 'Postit A').focus()
  52  |     for (let i = 0; i < 3; i++) await page.keyboard.press('Alt+ArrowRight')
  53  |     await expect.poll(async () => (await size(frame, 'Postit A')).w).toBe(300)
  54  |     // the size is saved a moment after the last key; the list is drawn again with it
  55  |     await expect(postit(frame, 'Postit A')).toBeFocused()
  56  |     for (let i = 0; i < 20; i++) await page.keyboard.press('Alt+ArrowUp')
  57  |     await expect.poll(async () => (await size(frame, 'Postit A')).h).toBe(120)
  58  |     // the keys save their size 500 ms after the last one; a drag that ends before that is overwritten by it
  59  |     // (the list is also drawn again when the save lands, which would drop the grip: wait for both; the plugin
  60  |     // itself should cancel the pending save on a drag, see mosaikit-plugins)
  61  |     await page.waitForTimeout(2500)
  62  |     const grip = postit(frame, 'Postit A').locator('.pi-grip')
  63  |     await expect(grip).toBeVisible()
  64  |     const g = (await grip.boundingBox())!
  65  |     await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
  66  |     await page.mouse.down()
  67  |     await page.mouse.move(g.x + g.width / 2 + 60, g.y + g.height / 2 + 120, { steps: 5 })
  68  |     await page.mouse.up()
  69  |     await expect.poll(async () => size(frame, 'Postit A')).toEqual({ w: 360, h: 240 })
  70  |     // the drag is saved on release: give the request time before the reload (slow runner)
  71  |     await page.waitForTimeout(1500)
  72  |     await page.reload()
  73  |     frame = await openNotes(page)
  74  |     await expect.poll(async () => size(frame, 'Postit A')).toEqual({ w: 360, h: 240 })
  75  |     await expect(postit(frame, 'Postit A')).toHaveClass(/pc-blue/)
  76  |     expect(await tilt()).toBe(t0)
  77  |     // too big or too small never goes past the bounds
  78  |     await postit(frame, 'Postit A').focus()
  79  |     for (let i = 0; i < 12; i++) await page.keyboard.press('Alt+Shift+ArrowRight')
  80  |     await expect.poll(async () => (await size(frame, 'Postit A')).w).toBe(480)
  81  | 
  82  |     // a second note with a tag chosen from the list of tags
  83  |     await frame.getByRole('button', { name: /^＋ New/ }).first().click()
  84  |     await frame.locator('[data-key="title"]').fill('Postit B')
  85  |     await frame.getByRole('button', { name: 'ideas', exact: true }).click()
  86  |     await frame.getByRole('textbox', { name: 'New tag' }).fill('errands')
  87  |     await frame.getByRole('button', { name: 'Add', exact: true }).click()
  88  |     await frame.getByRole('button', { name: 'Save' }).click()
> 89  |     await expect(postit(frame, 'Postit B').locator('.pi-tag')).toHaveText(['ideas', 'errands'])
      |                                                                ^ Error: expect(locator).toHaveText(expected) failed
  90  | 
  91  |     // filter by tag
  92  |     await frame.getByLabel('Filter by tag').selectOption('errands')
  93  |     await expect(postit(frame, 'Postit B')).toBeVisible()
  94  |     await expect(postit(frame, 'Postit A')).toHaveCount(0)
  95  |     await frame.getByLabel('Filter by tag').selectOption('')
  96  |     await expect(postit(frame, 'Postit A')).toBeVisible()
  97  | 
  98  |     // tags: change the colour, rename, create, delete (the tag leaves the notes)
  99  |     await frame.getByRole('button', { name: 'Tags', exact: true }).click()
  100 |     const dlg = frame.getByRole('dialog', { name: 'Tags' })
  101 |     await expect(dlg).toBeVisible()
  102 |     await dlg.getByRole('textbox', { name: 'Name of the tag', exact: true }).fill('later')
  103 |     await dlg.getByLabel('Colour', { exact: true }).selectOption('teal')
  104 |     await dlg.getByRole('button', { name: 'Add', exact: true }).click()
  105 |     await expect(dlg.getByRole('textbox', { name: 'Name of the tag later' })).toBeVisible()
  106 |     await dlg.getByLabel('Colour of the tag later').selectOption('green')
  107 |     await expect(dlg.locator('li.pi-trow:has(input[aria-label="Name of the tag later"]) .pi-dot')).toHaveClass(/pc-green/)
  108 |     const errands = dlg.getByRole('textbox', { name: 'Name of the tag errands' })
  109 |     await errands.fill('shopping')
  110 |     await errands.press('Enter')
  111 |     await expect(dlg.getByRole('textbox', { name: 'Name of the tag shopping' })).toBeVisible()
  112 |     await dlg.getByLabel('Colour of the tag shopping').selectOption('orange')
  113 |     await expect(dlg.locator('li.pi-trow:has(input[aria-label="Name of the tag shopping"]) .pi-used')).toHaveText('1 note')
  114 |     await dlg.getByRole('button', { name: 'Close' }).click()
  115 |     await expect(frame.getByRole('dialog')).toHaveCount(0)
  116 |     // every tag has its own colour, not the colour of the note
  117 |     await expect(postit(frame, 'Postit B').locator('.pi-tag', { hasText: 'shopping' })).toHaveClass(/pc-orange/)
  118 |     await expect(postit(frame, 'Postit B')).toHaveClass(/pc-yellow/)
  119 |     await expect(postit(frame, 'Postit B').locator('.pi-tag', { hasText: 'errands' })).toHaveCount(0)
  120 | 
  121 |     await frame.getByRole('button', { name: 'Tags', exact: true }).click()
  122 |     await dlg.getByRole('button', { name: 'Delete the tag ideas' }).click()
  123 |     await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click()
  124 |     await expect(dlg.getByRole('textbox', { name: 'Name of the tag ideas' })).toHaveCount(0)
  125 |     await dlg.getByRole('button', { name: 'Close' }).click()
  126 |     await expect(postit(frame, 'Postit A').locator('.pi-tag')).toHaveCount(0)
  127 |     await expect(postit(frame, 'Postit B').locator('.pi-tag')).toHaveText(['shopping'])
  128 |     // and after a reload, the notes keep it that way
  129 |     await page.reload()
  130 |     frame = await openNotes(page)
  131 |     await expect(postit(frame, 'Postit A')).toBeVisible()
  132 |     await expect(postit(frame, 'Postit A').locator('.pi-tag')).toHaveCount(0)
  133 |     await expect(frame.getByLabel('Filter by tag').locator('option', { hasText: 'ideas' })).toHaveCount(0)
  134 | 
  135 |     // the list view stays available
  136 |     await frame.getByRole('button', { name: 'List' }).click()
  137 |     await expect(frame.locator('.msk-item', { hasText: 'Postit B' }).locator('.pi-tag', { hasText: 'shopping' })).toBeVisible()
  138 |     await frame.getByRole('button', { name: 'Post-its' }).click()
  139 |     await expect(postit(frame, 'Postit B')).toBeVisible()
  140 | 
  141 |     // light and dark: nothing breaks the contrast
  142 |     await accessible(page, 'notes post-its')
  143 |     await page.evaluate(() => localStorage.setItem('msk_mode', 'dark'))
  144 |     await page.reload()
  145 |     frame = await openNotes(page)
  146 |     await expect(frame.locator('html')).toHaveAttribute('data-mode', 'dark')
  147 |     await expect(postit(frame, 'Postit A')).toBeVisible()
  148 |     await accessible(page, 'notes post-its dark')
  149 |     await page.evaluate(() => localStorage.removeItem('msk_mode'))
  150 |     await ctx.close()
  151 |   })
  152 | })
  153 | 
```