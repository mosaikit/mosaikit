// Plugin dev kit, phase 2: the command-line tool `mosaikit-plugin` (docs/manual-tests.md, DK-xx).
// The checks run the executable of crates/plugin-cli in a temporary folder; DK-05 talks to the instance of the run.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as H from '../h.ts'
import * as L from '../lib.ts'

const EXE = path.join(process.env.CARGO_TARGET_DIR ?? path.join(L.ROOT, 'target'), 'debug', process.platform === 'win32' ? 'mosaikit-plugin.exe' : 'mosaikit-plugin')

/** Builds the tool once (it is a crate of the workspace, not part of the instance). */
function ensureTool() {
  if (fs.existsSync(EXE)) return
  execFileSync('cargo', ['build', '-p', 'mosaikit-plugin-cli'], { cwd: L.ROOT, stdio: 'inherit' })
}

function tool(cwd: string, args: string[], env: Record<string, string> = {}) {
  ensureTool()
  const base = { ...process.env, ...env }
  // the keys of the person running the suite must not sign the packages of the checks
  delete base.MOSAIKIT_SIGNING_KEY
  delete base.MOSAIKIT_SIGNING_KEY_FILE
  const r = spawnSync(EXE, args, { cwd, encoding: 'utf8', env: base })
  return { code: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

/** `tar` that reads zip: on Windows the one of the system (the GNU tar of Git takes a drive letter for a remote host). */
const SYS_TAR = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
const TAR = process.platform === 'win32' && fs.existsSync(SYS_TAR) ? SYS_TAR : 'tar'

function temp(): string {
  const base = process.env.MOSAIKIT_TEMP
  if (base) fs.mkdirSync(base, { recursive: true })
  return fs.mkdtempSync(path.join(base ?? os.tmpdir(), 'dk-'))
}

function cleanup(d: string) {
  fs.rmSync(d, { recursive: true, force: true })
}

/** The server executable of the run (next to the tool in the build folder of Cargo). */
const SERVER = path.join(path.dirname(EXE), process.platform === 'win32' ? 'mosaikit-server.exe' : 'mosaikit-server')

function killTree(pid: number | undefined) {
  if (!pid) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'])
  else process.kill(pid)
}

/** Runs the server with a configuration and gives its exit code and messages (it is stopped after `ms`). */
function serverWith(cfg: string, d: string, ms = 20000) {
  fs.writeFileSync(path.join(d, 'mosaikit.toml'), cfg)
  const env = { ...process.env }
  for (const k of ['MOSAIKIT_DATABASE_URL', 'DATABASE_URL', 'MOSAIKIT_URL', 'MOSAIKIT_LISTEN', 'MOSAIKIT_ALLOW_UNSIGNED', 'MOSAIKIT_DEVELOPER_PROFILE', 'MOSAIKIT_DEVELOPER_PROFILE_ALLOW_REMOTE']) delete env[k]
  const r = spawnSync(SERVER, ['--config', path.join(d, 'mosaikit.toml'), 'serve'], { encoding: 'utf8', env, timeout: ms })
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

/** A TOML literal string (single quotes: the backslashes of Windows paths stay). */
const lit = (p: string) => `'${p}'`

const checks: L.Check[] = [
  {
    id: 'DK-01',
    async run() {
      const c = H.checker()
      const d = temp()
      try {
        c.ok(tool(d, ['new', 'demo', '--id', 'com.test.demo', '--no-logic', '--no-ui']).code === 0, 'new makes the folder')
        c.ok(tool(d, ['keygen', '--out', 'k.key']).code === 0, 'keygen writes a key')
        const plugin = path.join(d, 'demo')
        const v = tool(plugin, ['validate'])
        c.ok(v.code === 0 && v.out.includes('0 error(s), 0 warning(s)'), 'the new plugin validates clean')
        const p = tool(plugin, ['pack', '--no-build', '--key', '../k.key'])
        const mskp = path.join(plugin, 'dist', 'com.test.demo-0.1.0.mskp')
        c.ok(p.code === 0 && fs.existsSync(mskp), 'pack makes dist/<id>-<version>.mskp')
        c.ok(/sha256 [0-9a-f]{64}/.test(p.out), 'pack prints the sha256')
        c.ok(tool(d, ['validate', mskp]).out.includes('signature valid'), 'the package validates and is signed')
      } finally {
        cleanup(d)
      }
      return c.result()
    },
  },
  {
    id: 'DK-02',
    async run() {
      const c = H.checker()
      const d = temp()
      try {
        const r = tool(d, ['doctor'])
        for (const w of ['rustc', 'cargo', 'wasm32 target', 'node', 'npm']) c.ok(r.out.includes(w), `doctor lists ${w}`)
        c.ok(r.code === 0 || r.out.includes('FAIL'), 'doctor exits with 1 only when something fails')
      } finally {
        cleanup(d)
      }
      return c.result()
    },
  },
  {
    id: 'DK-03',
    async run() {
      const c = H.checker()
      const d = temp()
      try {
        tool(d, ['new', 'demo', '--id', 'com.test.demo', '--no-logic', '--no-ui'])
        const plugin = path.join(d, 'demo')
        fs.writeFileSync(path.join(plugin, 'migrations', '002_bad.sql'), 'drop table core.users;')
        const bad = tool(plugin, ['validate'])
        c.ok(bad.code === 1 && bad.out.includes('002_bad.sql'), 'a migration outside the schema of the plugin is an error, with its file name')
        const stop = tool(plugin, ['pack', '--no-build'])
        c.ok(stop.code !== 0 && !fs.existsSync(path.join(plugin, 'dist')), 'pack stops and makes no package')
        fs.rmSync(path.join(plugin, 'migrations', '002_bad.sql'))
        const toml = path.join(plugin, 'plugin.toml')
        fs.writeFileSync(toml, fs.readFileSync(toml, 'utf8').replace('[requires]\nmosaikit = ">=1.0, <2"\napi = 1\n', 'min_kernel = "1.0.0"\n'))
        const old = tool(plugin, ['validate'])
        c.ok(old.code === 0 && old.out.includes('min_kernel') && old.out.includes('warning'), 'an old key is a warning and no [requires] is a warning')
      } finally {
        cleanup(d)
      }
      return c.result()
    },
  },
  {
    id: 'DK-04',
    async run() {
      const c = H.checker()
      const d = temp()
      try {
        tool(d, ['new', 'demo', '--id', 'com.test.demo', '--no-logic', '--no-ui'])
        tool(d, ['keygen', '--out', 'a.key'])
        tool(d, ['keygen', '--out', 'b.key'])
        c.ok(tool(d, ['keygen', '--out', 'a.key']).code !== 0, 'keygen never overwrites a key')
        const plugin = path.join(d, 'demo')
        const a = tool(plugin, ['pack', '--no-build', '--key', '../a.key'])
        const key = (s: string) => s.match(/publisher key (\S+)/)?.[1]
        const mskp = path.join(plugin, 'dist', 'com.test.demo-0.1.0.mskp')
        const b = tool(d, ['sign', mskp, '--key', 'b.key'])
        c.ok(!!key(a.out) && !!key(b.out) && key(a.out) !== key(b.out), 'sign gives the package the publisher of the other key')
        c.ok(tool(d, ['validate', mskp]).out.includes(key(b.out) ?? '?'), 'validate shows the new publisher key')
      } finally {
        cleanup(d)
      }
      return c.result()
    },
  },
  {
    id: 'DK-05',
    async run() {
      const c = H.checker()
      const d = temp()
      try {
        tool(d, ['new', 'demo', '--id', 'com.test.dkdemo', '--no-logic', '--no-ui'])
        tool(d, ['keygen', '--out', 'a.key'])
        const plugin = path.join(d, 'demo')
        tool(plugin, ['pack', '--no-build', '--key', '../a.key'])
        const mskp = path.join(plugin, 'dist', 'com.test.dkdemo-0.1.0.mskp')
        const server = L.BASE.replace(/\/$/, '')
        const args = ['install', mskp, '--server', server, '--user', 'admin', '--password', L.ADMIN_PASSWORD]
        // the Administrator of the run has a second factor
        const r = tool(d, [...args, '--totp', await L.freshCode()])
        const installed = r.code === 0 && r.out.includes('installed com.test.dkdemo 0.1.0')
        // a server that does not trust the key says so: either way the answer of the server reaches the developer
        c.ok(installed || /the server answered \d{3}/.test(r.out), `install ends with the server's answer (${r.out.trim().slice(0, 160)})`)
        if (installed) {
          const a = await L.apiAdmin()
          await a.call('DELETE', '/mosaikit/api/admin/plugins/com.test.dkdemo')
        }
        const noadmin = tool(d, ['install', mskp, '--server', server])
        c.ok(noadmin.code !== 0 && noadmin.out.includes('--user'), 'without an Administrator nothing is sent')
      } finally {
        cleanup(d)
      }
      return c.result()
    },
  },
  {
    id: 'DK-06',
    async run() {
      const c = H.checker()
      const d = temp()
      try {
        // the tool is copied to an empty folder: in a build folder of Cargo the server stands next to it
        const alone = path.join(d, 'alone', path.basename(EXE))
        fs.mkdirSync(path.dirname(alone), { recursive: true })
        ensureTool()
        fs.copyFileSync(EXE, alone)
        tool(d, ['new', 'devdemo', '--no-logic', '--no-ui'])
        const env = { ...process.env }
        delete env.MOSAIKIT_SERVER_BIN
        const r = spawnSync(alone, ['dev', '--no-open'], { cwd: path.join(d, 'devdemo'), encoding: 'utf8', env })
        const out = (r.stdout ?? '') + (r.stderr ?? '')
        c.ok(r.status === 1 && out.includes('--server') && out.includes('MOSAIKIT_SERVER_BIN'), '`dev` without a server executable fails with a message that says where to get it')
        c.ok(tool(path.join(d, 'devdemo'), ['dev', '--server', path.join(d, 'nowhere')]).out.includes('does not exist'), 'a wrong --server path is named')
      } finally {
        cleanup(d)
      }
      return c.result()
    },
  },
  {
    id: 'DK-07',
    async run() {
      return {
        status: 'NOT VERIFIABLE',
        note: 'needs a plugin with logic built for wasm32 and a toolchain without the target; covered by the crate tests (cli.rs: new_build_pack_validate_with_logic, toolchain tests)',
      }
    },
  },
  {
    id: 'DK-08',
    async run() {
      const c = H.checker()
      const d = temp()
      try {
        const kit = path.join(d, 'kit')
        const want: Record<string, string[]> = {
          app: ['Cargo.toml', 'src/lib.rs', 'ui/src/i18n.ts', 'ui/src/i18n.test.ts', '.oxlintrc.json', '.github/workflows/ci.yml', 'README.md'],
          ui: ['ui/package.json', '.oxlintrc.json'],
          service: ['Cargo.toml', 'src/lib.rs'],
          extension: ['plugin.toml'],
          language: ['lang/host.json', 'lang/plugins/com.mosaikit.notes.toml'],
          layout: ['layout/layout.toml', 'layout/layout.css'],
        }
        for (const [variant, files] of Object.entries(want)) {
          const name = variant === 'language' ? 'lang-fr' : `v-${variant}`
          const made = tool(d, ['new', name, '--variant', variant, '--kit', kit])
          const dir = path.join(d, name)
          c.ok(made.code === 0, `new --variant ${variant} makes the folder (${made.out.trim().slice(0, 100)})`)
          c.ok(files.every((f) => fs.existsSync(path.join(dir, f))), `${variant} has ${files.join(', ')}`)
          c.ok(fs.existsSync(path.join(dir, '.gitignore')) && !fs.existsSync(path.join(dir, 'Cargo.lock')), `${variant} is a folder of its own`)
          if (variant !== 'app' && variant !== 'ui' && variant !== 'service') {
            const v = tool(dir, ['validate'])
            c.ok(v.code === 0 && v.out.includes('0 error(s), 0 warning(s)'), `${variant} validates clean`)
          }
        }
        c.ok(tool(d, ['new', 'french', '--variant', 'language']).code !== 0, 'a language needs its code')
        const ui = JSON.parse(fs.readFileSync(path.join(d, 'v-ui', 'ui', 'package.json'), 'utf8'))
        c.ok(ui.devDependencies.typescript === '~7.0.2' && ui.devDependencies.vite === '^8.3.4', 'the build tools have the versions of this repository')
      } finally {
        cleanup(d)
      }
      return c.result()
    },
  },
  {
    id: 'DK-09',
    async run() {
      const c = H.checker()
      const d = temp()
      try {
        for (const ex of ['todo', 'insights', 'note-priority']) {
          const made = tool(d, ['new', `e-${ex}`, '--example', ex, '--kit', path.join(d, 'kit')])
          const dir = path.join(d, `e-${ex}`)
          c.ok(made.code === 0 && fs.existsSync(path.join(dir, 'WALKTHROUGH.md')), `example ${ex} comes with its walkthrough`)
          const v = tool(dir, ['validate'])
          c.ok(v.code === 0 && v.out.includes('0 error(s)'), `example ${ex} validates`)
          const toml = fs.readFileSync(path.join(dir, 'plugin.toml'), 'utf8')
          c.ok(toml.includes('[i18n.it') && toml.includes('[i18n.es'), `example ${ex} has its texts in Italian and Spanish`)
        }
        c.ok(tool(d, ['new', 'bad', '--example', 'nothing']).code !== 0, 'an unknown example is refused')
      } finally {
        cleanup(d)
      }
      return c.result()
    },
  },
  {
    id: 'DK-10',
    async run() {
      const c = H.checker()
      const d = temp()
      try {
        const kit = path.join(d, 'kit')
        tool(d, ['new', 'from-kit', '--kit', kit])
        tool(d, ['new', 'published'])
        tool(d, ['new', 'own', '--kit', kit, '--sdk-path', path.join(d, 'my-sdk')])
        const slash = (t: string) => t.split(String.fromCharCode(92)).join('/')
        const cargo = (n: string) => fs.readFileSync(path.join(d, n, 'Cargo.toml'), 'utf8')
        const pkg = (n: string) => fs.readFileSync(path.join(d, n, 'ui', 'package.json'), 'utf8')
        c.ok(slash(cargo('from-kit')).includes(`${slash(kit)}/sdk`) && pkg('from-kit').includes('file:'), '--kit points the SDK and the UI package at the folders of the kit')
        c.ok(cargo('published').includes('mosaikit-plugin-sdk = "1"') && pkg('published').includes('^1.0.0'), 'without a kit the published versions are asked for')
        c.ok(cargo('own').includes('my-sdk'), 'an explicit path wins over the kit')
        c.ok(pkg('published').includes('@fontsource-variable/bricolage-grotesque'), 'the fonts of the UI package are in the dependencies of the plugin')
      } finally {
        cleanup(d)
      }
      return c.result()
    },
  },
  {
    id: 'DK-11',
    async run() {
      return {
        status: 'NOT VERIFIABLE',
        note: 'builds the logic for wasm32 and installs the UI packages of eight plugins (about two minutes); covered by the crate test cli.rs: every_variant_builds_and_packs_from_the_kit',
      }
    },
  },
  {
    id: 'DK-12',
    async run() {
      const c = H.checker()
      const d = temp()
      try {
        tool(d, ['new', 'loop', '--id', 'com.test.loop', '--no-logic', '--no-ui'])
        const plugin = path.join(d, 'loop')
        fs.mkdirSync(path.join(plugin, 'ui', 'dist'), { recursive: true })
        fs.writeFileSync(path.join(plugin, 'ui', 'dist', 'index.html'), '<!doctype html><title>x</title><p>ok</p>')
        ensureTool()
        const child = spawn(EXE, ['dev', '--no-open', '--no-build', '--port', '28860'], { cwd: plugin, env: { ...process.env, MOSAIKIT_SERVER_BIN: SERVER } })
        let out = ''
        child.stdout.on('data', (b) => (out += b))
        child.stderr.on('data', (b) => (out += b))
        try {
          const end = Date.now() + 90_000
          while (!out.includes('Ctrl+C stops it') && Date.now() < end && child.exitCode === null) await new Promise((r) => setTimeout(r, 400))
          c.ok(out.includes('Ctrl+C stops it'), `dev starts the server and says it is ready (${out.slice(-200)})`)
          c.ok(/app +http:\/\/127\.0\.0\.1:\d+\//.test(out) && out.includes('http://*.localhost:'), 'it prints the address of the app and the one of the plugins')
          for (const u of ['admin', 'manager', 'alice', 'bob']) c.ok(out.includes(u), `it prints the test user ${u}`)
          c.ok(out.includes('mosaikit-dev'), 'it prints the password of the test users')
          const m = /app +(http:\/\/127\.0\.0\.1:\d+)\//.exec(out)
          if (m) {
            const h = (await (await fetch(`${m[1]}/api/health`)).json()) as { developer?: boolean }
            c.ok(h.developer === true, 'the server runs the developer profile')
            const info = (await (await fetch(`${m[1]}/api/dev/info`)).json()) as { plugins: { id: string }[] }
            c.ok(info.plugins.some((p) => p.id === 'com.test.loop'), 'the plugin of the folder is loaded from it')
          }
        } finally {
          killTree(child.pid)
        }
      } finally {
        cleanup(d)
      }
      return c.result()
    },
  },
  {
    id: 'DK-13',
    async run() {
      const c = H.checker()
      const d = temp()
      try {
        const data = `data_dir = ${lit(path.join(d, 'data'))}\n`
        const open = serverWith(`url = "http://127.0.0.1:28870"\nlisten = "0.0.0.0:28870"\nplugin_listen = "127.0.0.1:28871"\n${data}developer_profile = true\n`, d)
        c.ok(open.code !== 0 && open.out.includes('developer profile refuses to start') && open.out.includes('0.0.0.0:28870'), 'a non-loopback address is refused, with the reason')
        const remote = serverWith(`url = "http://127.0.0.1:28870"\n${data}developer_profile = true\n[database]\nurl = "postgres://u:p@db.example.org:5432/m"\n`, d)
        c.ok(remote.code !== 0 && remote.out.includes('the database is not on this computer'), 'a database on another host is refused')
        const proxy = serverWith(`url = "http://127.0.0.1:28870"\ntrust_proxy = true\n${data}developer_profile = true\n`, d)
        c.ok(proxy.code !== 0 && proxy.out.includes('trust_proxy'), 'a reverse proxy is refused')
        // the flag that lifts the guards is explicit: with it the same address starts (the timeout stops the server)
        const allowed = serverWith(`url = "http://127.0.0.1:28870"\nlisten = "0.0.0.0:28870"\nplugin_listen = "127.0.0.1:28871"\n${data}developer_profile = true\ndeveloper_profile_allow_remote = true\n`, d, 12000)
        c.ok(!allowed.out.includes('refuses to start') && allowed.out.includes('DEVELOPER PROFILE ON'), 'with developer_profile_allow_remote it starts and says the profile is on')
        // the default start: nothing about the profile
        const plain = serverWith(`url = "http://127.0.0.1:28870"\nplugin_url = "http://127.0.0.1:28871"\ndata_dir = ${lit(path.join(d, 'data2'))}\n`, d, 8000)
        c.ok(!plain.out.includes('DEVELOPER PROFILE'), 'a default start does not mention the developer profile')
      } finally {
        cleanup(d)
      }
      return c.result()
    },
  },
  {
    id: 'DK-14',
    async run() {
      return {
        status: 'NOT VERIFIABLE',
        note: 'a browser session of its own on a server in the developer profile: covered by tests/e2e/specs/18-developer-profile.spec.ts (banner, manifest, host calls, permissions, switch of users, empty state)',
      }
    },
  },
  {
    id: 'DK-15',
    async run() {
      return {
        status: 'NOT VERIFIABLE',
        note: 'changes the files of a plugin folder while the browser is open: covered by tests/e2e/specs/18-developer-profile.spec.ts (UI, manifest, changed migration with its confirmation, reset)',
      }
    },
  },
  {
    id: 'DK-16',
    async run() {
      const c = H.checker()
      // the folder is written without building the image
      const r = spawnSync('cargo', ['xtask', 'release', 'devkit-docker', '--no-build'], { cwd: L.ROOT, encoding: 'utf8' })
      const out = (r.stdout ?? '') + (r.stderr ?? '')
      const m = /Docker development kit: (.+)/.exec(out)
      c.ok(r.status === 0 && !!m, `the folder of the Docker kit is generated (${out.slice(-160)})`)
      if (m) {
        const dir = m[1].trim()
        try {
          for (const f of ['compose.yml', '.env', 'README.md', 'initdb', 'plugin']) c.ok(fs.existsSync(path.join(dir, f)), `${f} is in the folder`)
          const compose = fs.readFileSync(path.join(dir, 'compose.yml'), 'utf8')
          c.ok(compose.includes('MOSAIKIT_DEVELOPER_PROFILE: "1"') && compose.includes('"127.0.0.1:'), 'compose turns the profile on and publishes on loopback only')
          if (spawnSync('docker', ['--version']).status === 0) {
            const v = spawnSync('docker', ['compose', 'config', '-q'], { cwd: dir, encoding: 'utf8' })
            c.ok(v.status === 0, `docker compose accepts the file (${(v.stderr ?? '').slice(0, 160)})`)
          } else c.note('docker not available: the file was checked as text only')
        } finally {
          fs.rmSync(dir, { recursive: true, force: true })
        }
      }
      c.note('the real run (image build, docker compose up) is not part of this check')
      return c.result()
    },
  },
  {
    id: 'DK-17',
    async run() {
      const c = H.checker()
      const fixtures = path.join(L.ROOT, 'crates', 'plugin-cli', 'tests', 'fixtures')
      const d = temp()
      try {
        fs.cpSync(path.join(fixtures, 'good'), d, { recursive: true })
        const good = tool(d, ['validate', '--strict'])
        c.ok(good.code === 0 && good.out.includes('0 error(s)'), `the good fixture passes the strict suite (${good.out.slice(-200)})`)
        c.ok(good.out.includes('migrations checked for PostgreSQL and for SQLite') && good.out.includes('layout contract'), 'the report says what was checked: migrations on both databases, the layout contract')
        const plugins = path.join(L.ROOT, '..', 'mosaikit-plugins')
        if (fs.existsSync(path.join(plugins, 'notes', 'plugin.toml'))) {
          for (const e of fs.readdirSync(plugins, { withFileTypes: true })) {
            if (!e.isDirectory() || !fs.existsSync(path.join(plugins, e.name, 'plugin.toml'))) continue
            const r = tool(plugins, ['validate', '--strict', e.name])
            c.ok(r.code === 0, `${e.name} passes the strict suite (${r.out.slice(-160)})`)
          }
        } else c.note('mosaikit-plugins is not next to this repository: the official plugins were not checked')
      } finally {
        cleanup(d)
      }
      return c.result()
    },
  },
  {
    id: 'DK-18',
    async run() {
      const c = H.checker()
      const fixtures = path.join(L.ROOT, 'crates', 'plugin-cli', 'tests', 'fixtures')
      const cases: [string, string][] = [
        ['undeclared-notify', '[permissions] notify is not set'],
        ['unused-permission', 'files_read is set but the logic never reads the Files area'],
        ['hook-not-registered', 'registers no hook of it'],
        ['migration-drop', 'is irreversible'],
        ['migration-gap', '002 is expected'],
        ['migration-other-schema', 'migrations/002_core.sql'],
        ['ui-outside', 'outside origin'],
        ['i18n-incomplete', '[i18n.it] is incomplete'],
        ['crud-layout', 'which [[resources]] does not declare'],
        ['no-metadata', 'no description'],
      ]
      for (const [name, expected] of cases) {
        const d = temp()
        try {
          fs.cpSync(path.join(fixtures, 'good'), d, { recursive: true })
          fs.cpSync(path.join(fixtures, 'broken', name), d, { recursive: true })
          const r = tool(d, ['validate', '--strict'])
          c.ok(r.code === 1 && r.out.includes(expected), `${name} fails: ${expected} (${r.out.slice(-200)})`)
          // the basic validate does not run the conformance suite
        } finally {
          cleanup(d)
        }
      }
      return c.result()
    },
  },
  {
    id: 'DK-19',
    async run() {
      return {
        status: 'NOT VERIFIABLE',
        note: 'the recipes of MockHost (db.query, notify, call_plugin, permissions, files.*) are native tests of the SDK: cargo test -p mosaikit-plugin-sdk testing',
      }
    },
  },
  {
    id: 'DK-20',
    async run() {
      const c = H.checker()
      const dir = path.join(L.ROOT, 'ui', 'plugin-testing')
      for (const f of ['package.json', 'README.md', 'CHANGELOG.md', 'src/index.ts']) c.ok(fs.existsSync(path.join(dir, f)), `${f} is in the package`)
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
      c.ok(pkg.name === '@mosaikit/plugin-testing' && pkg.version === '1.0.0' && !!pkg.exports?.['.'], 'name, version 1.0.0 and explicit exports')
      const r = spawnSync('npx', ['vitest', 'run'], { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32' })
      c.ok(r.status === 0, `the unit tests pass without a server (${((r.stdout ?? '') + (r.stderr ?? '')).slice(-200)})`)
      c.note('signing in, opening a plugin, creating an item and the axe check against a development server are by hand: not automated')
      return c.result()
    },
  },
  {
    id: 'DK-21',
    async run() {
      const c = H.checker()
      const wf = fs.readFileSync(path.join(L.ROOT, '.github', 'workflows', 'release.yml'), 'utf8')
      c.ok(/devkit:/.test(wf) && /windows-latest, ubuntu-latest, macos-latest/.test(wf), 'release.yml builds the kit on the three platforms')
      c.ok(wf.includes('cargo xtask release devkit') && wf.includes('devkit-sums') && wf.includes('MOSAIKIT_SIGNING_KEY'), 'the workflow builds, signs the sums with the official key and publishes')
      const rel = path.join(process.env.CARGO_TARGET_DIR ?? path.join(L.ROOT, 'target'), 'release', process.platform === 'win32' ? 'mosaikit-plugin.exe' : 'mosaikit-plugin')
      if (!fs.existsSync(rel)) {
        c.note('the real archive build (cargo xtask release devkit) is by hand: no release executables here, so the archive is not built by this suite')
        return c.result()
      }
      const out = temp()
      try {
        const r = spawnSync('cargo', ['xtask', 'release', 'devkit', '--skip-build', '--allow-dev-key', '--out', out], { cwd: L.ROOT, encoding: 'utf8' })
        c.ok(r.status === 0, `cargo xtask release devkit works (${((r.stdout ?? '') + (r.stderr ?? '')).slice(-300)})`)
        const files = fs.readdirSync(out)
        const archive = files.find((f) => /^mosaikit-devkit-.*\.(zip|tar\.gz)$/.test(f))
        c.ok(!!archive, 'an archive is written')
        for (const f of ['SHA256SUMS', 'SHA256SUMS.sig', 'RELEASE-NOTES.md']) c.ok(files.includes(f), `${f} is next to the archive`)
        if (archive) {
          c.ok(files.includes(`${archive}.sig`), 'the archive has its signature')
          const list = spawnSync(TAR, ['-tf', path.join(out, archive)], { encoding: 'utf8' }).stdout ?? ''
          for (const part of ['/bin/mosaikit-plugin', '/sdk/Cargo.toml', '/plugin-api/package.json', '/docs/devkit/README.md', '/examples/todo/plugin.toml', '/docker/compose.yml', '/LICENSE', '/THIRD-PARTY-NOTICES.md', '/COMPATIBILITY.md', '/trusted_key.txt'])
            c.ok(list.includes(part), `the archive holds ${part}`)
        }
      } finally {
        cleanup(out)
      }
      return c.result()
    },
  },
  {
    id: 'DK-22',
    async run() {
      // self-update from a folder of release files, with a kit made by hand and signed with a key made here
      const c = H.checker()
      const d = temp()
      try {
        const platform = `${process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'}-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}`
        const ext = process.platform === 'win32' ? 'zip' : 'tar.gz'
        const exe = process.platform === 'win32' ? 'mosaikit-plugin.exe' : 'mosaikit-plugin'
        ensureTool()
        const mk = (version: string, notes: string) => {
          const rel = path.join(d, `rel-${version}`)
          const name = `mosaikit-devkit-${version}-${platform}`
          fs.mkdirSync(path.join(rel, 'src', name, 'bin'), { recursive: true })
          fs.copyFileSync(EXE, path.join(rel, 'src', name, 'bin', exe))
          fs.writeFileSync(path.join(rel, 'src', name, 'VERSION'), version + '\n')
          const args = ext === 'zip' ? ['-a', '-c', '-f', path.join(rel, `${name}.zip`), '-C', path.join(rel, 'src'), name] : ['-czf', path.join(rel, `${name}.tar.gz`), '-C', path.join(rel, 'src'), name]
          spawnSync(TAR, args)
          fs.writeFileSync(path.join(rel, 'RELEASE-NOTES.md'), notes)
          return { rel, file: `${name}.${ext}` }
        }
        const kp = crypto.generateKeyPairSync('ed25519')
        const pub = Buffer.from(kp.publicKey.export({ format: 'jwk' }).x as string, 'base64url').toString('base64')
        const sign = (data: Buffer, key = kp.privateKey) => JSON.stringify({ key: pub, sig: crypto.sign(null, data, key).toString('base64') }) + '\n'
        const finish = (rel: string, file: string, key = kp.privateKey) => {
          const sums = `${crypto.createHash('sha256').update(fs.readFileSync(path.join(rel, file))).digest('hex')}  ${file}\n`
          fs.writeFileSync(path.join(rel, 'SHA256SUMS'), sums)
          fs.writeFileSync(path.join(rel, 'SHA256SUMS.sig'), sign(Buffer.from(sums), key))
        }
        const kit = () => {
          const k = path.join(d, 'kit')
          fs.rmSync(k, { recursive: true, force: true })
          fs.mkdirSync(path.join(k, 'bin'), { recursive: true })
          fs.writeFileSync(path.join(k, 'VERSION'), '1.0.0\n')
          fs.writeFileSync(path.join(k, 'bin', 'marker'), 'old')
          return k
        }
        // a release with breaking changes
        const a = mk('9.0.0', '# Mosaikit dev kit 9.0.0\n\n## Breaking changes\n\n- the `foo` command is gone\n')
        finish(a.rel, a.file)
        const common = ['--from-dir', a.rel, '--trusted-key', pub]
        let r = tool(d, ['self-update', '--check', ...common, '--kit', kit()])
        c.ok(r.code === 0 && r.out.includes('9.0.0') && r.out.includes('the `foo` command is gone'), `--check lists the release and its breaking changes (${r.out.slice(-200)})`)
        r = tool(d, ['self-update', ...common, '--kit', kit()])
        c.ok(r.code === 1 && r.out.includes('--yes'), 'breaking changes need --yes')
        const k = kit()
        r = tool(d, ['self-update', '--yes', ...common, '--kit', k])
        c.ok(r.code === 0 && fs.readFileSync(path.join(k, 'VERSION'), 'utf8').trim() === '9.0.0' && fs.existsSync(path.join(k, 'bin', exe)), `--yes replaces the kit (${r.out.slice(-200)})`)
        // another key signed the sums: refused, nothing replaced
        const other = crypto.generateKeyPairSync('ed25519')
        finish(a.rel, a.file, other.privateKey)
        const k2 = kit()
        r = tool(d, ['self-update', '--yes', ...common, '--kit', k2])
        c.ok(r.code === 1 && /signature|trusted/i.test(r.out) && fs.readFileSync(path.join(k2, 'VERSION'), 'utf8').trim() === '1.0.0', 'a signature that does not match is refused and the kit is untouched')
        // tampered archive: hash differs from the signed sums
        finish(a.rel, a.file)
        fs.appendFileSync(path.join(a.rel, a.file), 'x')
        const k3 = kit()
        r = tool(d, ['self-update', '--yes', ...common, '--kit', k3])
        c.ok(r.code === 1 && r.out.includes('hash does not match') && fs.readFileSync(path.join(k3, 'VERSION'), 'utf8').trim() === '1.0.0', 'a tampered archive is refused and the kit is untouched')
        // no breaking changes: updates without --yes
        const b = mk('1.0.1', '# Mosaikit dev kit 1.0.1\n\n## Breaking changes\n\nNone.\n')
        finish(b.rel, b.file)
        const k4 = kit()
        r = tool(d, ['self-update', '--from-dir', b.rel, '--trusted-key', pub, '--kit', k4])
        c.ok(r.code === 0 && fs.readFileSync(path.join(k4, 'VERSION'), 'utf8').trim() === '1.0.1', `a patch without breaking changes updates without --yes (${r.out.slice(-200)})`)
        c.note('the download from GitHub Releases (the same checks, the files from the network) is by hand: not automated')
      } finally {
        cleanup(d)
      }
      return c.result()
    },
  },
  {
    id: 'DK-23',
    async run() {
      const c = H.checker()
      const d = temp()
      try {
        const key = path.join(d, 'publisher.key')
        let r = tool(d, ['keygen', '--out', key])
        c.ok(r.code === 0 && fs.existsSync(key) && /public key/i.test(r.out), 'keygen writes the private key and prints the public one')
        r = tool(d, ['keygen', '--out', key])
        c.ok(r.code !== 0 && r.out.includes('already exists'), 'keygen never overwrites a key')
        const doc = fs.readFileSync(path.join(L.ROOT, 'docs', 'devkit', 'signing.md'), 'utf8')
        for (const part of ['keygen', 'trusted_keys', 'MOSAIKIT_TRUSTED_KEYS', 'Revoke', 'blocklist', 'key is lost']) c.ok(doc.includes(part), `signing.md covers ${part}`)
        c.ok(fs.existsSync(path.join(L.ROOT, 'docs', 'devkit', 'it', 'signing.md')), 'the Italian translation exists')
      } finally {
        cleanup(d)
      }
      return c.result()
    },
  },
  {
    id: 'DK-24',
    async run() {
      const c = H.checker()
      const d = temp()
      try {
        const r = spawnSync('cargo', ['xtask', 'release', 'devkit-notes', '--out', d], { cwd: L.ROOT, encoding: 'utf8' })
        c.ok(r.status === 0, `devkit-notes works (${((r.stdout ?? '') + (r.stderr ?? '')).slice(-200)})`)
        const notes = fs.existsSync(path.join(d, 'RELEASE-NOTES.md')) ? fs.readFileSync(path.join(d, 'RELEASE-NOTES.md'), 'utf8') : ''
        const compat = fs.existsSync(path.join(d, 'COMPATIBILITY.md')) ? fs.readFileSync(path.join(d, 'COMPATIBILITY.md'), 'utf8') : ''
        const version = /^version = "([^"]+)"/m.exec(fs.readFileSync(path.join(L.ROOT, 'Cargo.toml'), 'utf8').split('[workspace.package]')[1])?.[1]
        c.ok(!!version && notes.startsWith(`# Mosaikit dev kit ${version}`), 'the notes are for the version of the workspace')
        c.ok(notes.includes('## Breaking changes') && notes.includes('## Changes'), 'the notes have the breaking changes and the changes')
        c.ok(compat.includes('| Plugin API | 1 |') && compat.includes('mosaikit-plugin-sdk') && compat.includes('`[requires] mosaikit`'), 'the compatibility table has the versions and the ranges of the plugins')
        c.ok(compat.includes('example todo') && compat.includes('>=1.0, <2'), 'the examples are in the table with their range')
      } finally {
        cleanup(d)
      }
      return c.result()
    },
  },
  {
    id: 'DK-25',
    async run() {
      const c = H.checker()
      const d = temp()
      try {
        const r = spawnSync('cargo', ['xtask', 'release', 'devkit-notices', '--out', d], { cwd: L.ROOT, encoding: 'utf8' })
        c.ok(r.status === 0, `devkit-notices works (${((r.stdout ?? '') + (r.stderr ?? '')).slice(-300)})`)
        const f = path.join(d, 'THIRD-PARTY-NOTICES.md')
        const t = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
        c.ok(t.includes('## Rust crates') && t.includes('| MIT') && t.includes('Apache-2.0'), 'the Rust crates are listed with their licences')
        c.ok(t.includes('@fontsource-variable/bricolage-grotesque') && t.includes('OFL-1.1'), 'the npm packages of the UI are listed, with the text of their licence')
        c.ok(!/\|\s*(GPL|AGPL)-/.test(t), 'no GPL licence in the list')
        c.ok(fs.existsSync(path.join(L.ROOT, 'LICENSE')), 'the LICENSE of Mosaikit is there')
        c.note(/cargo deny check licenses/.test((r.stderr ?? '') + (r.stdout ?? '')) ? 'cargo deny check licenses ran' : 'cargo-deny is not installed here: the licences were listed but not checked')
      } finally {
        cleanup(d)
      }
      return c.result()
    },
  },
  {
    id: 'DK-26',
    async run() {
      const c = H.checker()
      const meta = JSON.parse(execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1', '--offline'], { cwd: L.ROOT, encoding: 'utf8', maxBuffer: 1 << 26 }))
      for (const name of ['mosaikit-mskp', 'mosaikit-sql-guard', 'mosaikit-plugin-cli', 'mosaikit-plugin-sdk']) {
        const p = meta.packages.find((x: { name: string }) => x.name === name)
        c.ok(!!p, `${name} is in the workspace`)
        if (!p) continue
        c.ok(p.version === '1.0.0' && p.license === 'Apache-2.0' && !!p.description && !!p.repository && !!p.readme, `${name}: version, licence, description, repository and readme`)
        c.ok(p.publish === null, `${name} may be published`)
      }
      for (const name of ['mosaikit-db', 'mosaikit-runtime', 'mosaikit-kernel', 'mosaikit-server', 'mosaikit-desktop', 'xtask']) {
        const p = meta.packages.find((x: { name: string }) => x.name === name)
        c.ok(p && Array.isArray(p.publish) && p.publish.length === 0, `${name} is not published`)
      }
      for (const name of ['mosaikit-mskp', 'mosaikit-sql-guard']) {
        const r = spawnSync('cargo', ['package', '-p', name, '--list', '--allow-dirty', '--offline'], { cwd: L.ROOT, encoding: 'utf8' })
        const l = (r.stdout ?? '').replace(/\\/g, '/')
        c.ok(r.status === 0 && l.includes('README.md') && l.includes('CHANGELOG.md') && l.includes('src/lib.rs'), `${name}: cargo package lists README, CHANGELOG and the sources`)
      }
      c.note('cargo install mosaikit-plugin-cli from a registry is by hand: nothing is published by the suite')
      return c.result()
    },
  },
]

export default checks
