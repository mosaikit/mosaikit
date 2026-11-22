# @mosaikit/plugin-api

The UI of a [Mosaikit](https://github.com/mosaikit) plugin talks to the shell through this package: the postMessage
bridge, the generic list/editor (`mountCrud`), tables, empty states and the theme. The package ships TypeScript
source (`exports` points at `src/index.ts`): a bundler such as Vite compiles it with your plugin.

```ts
import { connect, mountCrud, errText } from '@mosaikit/plugin-api'

const msk = await connect() // handshake: API version, language, theme, mode, user, tenant
mountCrud(document.getElementById('app')!, msk, 'notes', { title: 'Notes' })
```

## Shared UI kit helpers

All exported from the package root, framework-free, themed by the host tokens, usable with the keyboard, and quiet under `prefers-reduced-motion`.

| Helper | Use |
|---|---|
| `shortcuts([{ keys: 'n', label: 'New', run }])` | page shortcuts; `?` opens the help sheet; `dispose()` on leave |
| `shareChip({ names, onOpen: () => msk.share(id) })` | who can see this item, on a detail header |
| `undoToast({ text, commit, undo })` | delete at once, really delete after 6 s, Undo in between |
| `downloadCsv(name, rows, { header })`, `toCsv`, `downloadFile` | export a list |
| `filteredEmpty(msg, 'Clear filters', clear)` | a filter that matches nothing (not the big empty state) |
| `virtualList({ count, estimateSize, render })` | long lists; put `el` in a box with a height |
| `chart({ type, label, categories, series })` | line, bar, pie; loads ECharts lazily; `await c.ready` |

## Versions

- The package implements **plugin API 1** (`API_VERSION`). `connect()` sends it to the shell and the shell answers
  with the one it speaks (`msk.api`). A plugin built for a newer API than the shell speaks is refused with the
  error code `incompatible_api` (`isIncompatible(e)`); declare it in `plugin.toml` with `[requires] api = 1`.
- The package has its own version (see [CHANGELOG.md](CHANGELOG.md)).
- **Deprecation rule.** A deprecated item stays for one major version, is marked `@deprecated` with what replaces it,
  and is removed in the next major version. Deprecated in API 1: the `theme` event (use `context` / `msk.onContext`).
- Only what `src/index.ts` exports is public. The bridge class, the wire types and the theme helpers are internal.
- Errors carry a `code` typed as `ErrorCode`: switch on it, never on the text.
- Experimental, until an official sample uses them: `CrudOptions.panel`, `msk.notify`, `msk.web`.

Documentation: `docs/architecture.md` §8.4 and §8.11 of the Mosaikit repository.
