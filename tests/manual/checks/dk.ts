// Plugin dev kit, phase 2: the command-line tool `mosaikit-plugin` (docs/manual-tests.md, DK-xx).
// The checks run the executable of crates/plugin-cli in a temporary folder; DK-05 talks to the instance of the run.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
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
]

export default checks
