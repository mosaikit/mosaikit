# @mosaikit/plugin-testing

Playwright helpers to test a [Mosaikit](https://github.com/mosaikit) plugin end to end against the development
server (`mosaikit-plugin dev`, the developer profile). The package ships TypeScript source (`exports` points at
`src/index.ts`); Playwright runs it as it is.

```ts
import { test, expect } from '@playwright/test'
import { attachDevServer, signIn, openPlugin, createItem, expectAccessible } from '@mosaikit/plugin-testing'

test('Alice creates a note', async ({ page }) => {
  const dev = await attachDevServer() // MOSAIKIT_DEV_URL, else http://localhost:8080/
  await signIn(page, dev.url, 'alice')
  const frame = await openPlugin(page, dev.url, 'com.example.notes')
  const row = await createItem(frame, { title: 'Plan the week' })
  await expect(row).toContainText('Plan the week')
  await expectAccessible(page) // axe, serious and critical violations of the page and of the plugin frame
})
```

## What it gives

| Function | What it does |
|---|---|
| `startDevServer({ plugin, port, fresh, ... })` | starts `mosaikit-plugin dev --no-open --no-watch` for a plugin folder, waits for the address it prints and for `/api/health`; `stop()` ends the tool and the server. The tool is `MOSAIKIT_PLUGIN_BIN` or `mosaikit-plugin` |
| `attachDevServer(url?)` | uses a server that is running (`MOSAIKIT_DEV_URL`, the Docker kit); refuses one that is not in the developer profile |
| `signIn(page, app, user)` | signs in as `admin`, `manager`, `alice` or `bob` (tenant `dev`, password `mosaikit-dev`: `DEV_USERS`, `DEV_PASSWORD`) |
| `openPlugin(page, app, pluginId)` | opens the plugin in the shell and returns the frame of its UI |
| `createItem(frame, { title: '...' })` | in a page built with `mountCrud`: New, fills the fields by their key, Save; returns the row |
| `accessibilityViolations`, `expectAccessible`, `formatViolations` | the axe smoke test; needs the optional peer package `@axe-core/playwright` |
| `pluginUrl`, `waitForHealth`, `devArgs`, `parseDevOutput`, `freePort` | the small pieces, for tests that do things their own way |

The shell is driven in English (`signIn` sets the language), so the labels the helpers click are the English ones.
The helpers work only against a server in the developer profile: it has the test users, and it refuses to start on
anything but a computer of its own (`docs/architecture.md` §8.12).

## Versions

The package has its own version (see [CHANGELOG.md](CHANGELOG.md)) and follows the dev kit. Peer dependencies:
`@playwright/test` and, optional, `@axe-core/playwright`. Only what `src/index.ts` exports is public.

Documentation: `docs/architecture.md` §8.12 of the Mosaikit repository.
