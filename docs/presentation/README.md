# Mosaikit — PDF manuals and presentation

`cargo xtask docs` makes, in `dist/docs`:

| File | From |
|---|---|
| `mosaikit-user-manual-<version>-en.pdf` | `docs/guide/` (User, Tenant Manager, Administrator) |
| `mosaikit-installation-guide-<version>-en.pdf` | the Desktop, Docker, Kubernetes and Configuration sections of `README.md`, `deploy/README.docker.md`, `deploy/k8s/README.md` |
| `mosaikit-developer-guide-<version>-en.pdf` | `docs/devkit/` |
| `mosaikit-architecture-<version>-en.pdf` | `docs/architecture.md` |
| `mosaikit-presentation-<version>-en.pptx` | `docs/presentation/deck.json` |

The documents are in English. `--lang en,it` also makes the Italian ones that have a source (the Italian guides, the
Italian texts of the deck). Every release (`release.yml`, job `docs`) builds the English ones and attaches them to the GitHub Release next to the Dev Kit.
They are not committed: the Markdown and `deck.json` are the only sources.

## Keeping them up to date

- **The manuals** follow the Markdown. Nothing to do, unless a document is added: list it in `tools/docs/manuals.json`
  (the order of the chapters is the order of the list). A language that has no source for a manual is skipped.
- **The presentation** is `deck.json`: slides of a few kinds (`title`, `bullets`, `columns`, `cards`, `steps`, `kpis`,
  `savings`, `closing`), each text in English with an Italian version. `cargo xtask docs --check` (part of `cargo xtask ci`)
  fails when a text misses one of the two languages or a source of a manual is gone.
- **The numbers.** `measured` holds the footprint and the start-up times: measure again on the release you present
  and change them there. `estimate` holds the effort of each part of the platform if built from scratch, in
  person-days, and the day rate: they are indicative figures of the team, not measurements, and say so on the
  slide. Replace them with the figures of your own organisation before a presentation to a customer. The total, the
  percentage and the cost are computed.
- The version and the date are the ones of the build.

## The screenshots of the user manuals

`docs/presentation/screens/*.png` are the pictures of the user manual. They are not part of the guides of the application (`docs/guide/*.md` are shown inside the app and stay text): `tools/docs/manuals.json` says after which heading of which guide each picture goes (`figures`). To make them again, start a new desktop release (empty data folder; `open_browser = false`, a free port) and run `node tools/docs/shots.mjs --server http://127.0.0.1:<port>/`: it signs in as `admin` and `user`, makes sample people, groups and notes, and writes the pictures.

## Needs

Node 24 and a Chromium (the one of Playwright; `DOCS_BROWSER` points to another). `cargo xtask docs` runs
`npm ci` in `tools/docs` the first time.
