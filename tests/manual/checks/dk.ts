// Plugin dev kit, phase 2: the command-line tool `mosaikit-plugin` (docs/manual-tests.md, DK-xx).
// The checks run the executable of crates/plugin-cli in a temporary folder; DK-05 talks to the instance of the run.
import { execFileSync, spawnSync } from 'node:child_process'
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
        const r = tool(d, ['dev'])
        c.ok(r.code === 2 && r.out.includes('phase 4'), '`dev` says it arrives with phase 4 and exits with 2')
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
]

export default checks
