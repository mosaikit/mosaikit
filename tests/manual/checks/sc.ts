// Sidecars of a distribution: validation, Compose and Kubernetes output, desktop launcher.
// No browser: the checks run `cargo xtask` on a small distribution written in the run folder.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import * as H from '../h.ts'
import * as L from '../lib.ts'

const BASE = `
[product]
id = "scdemo"
name = "Sidecar demo"
version = "0.1.0"

[plugins]
roots = []
include = []
`

/** A distribution folder with this [[sidecars]] text; returns its path. */
function dist(name: string, sidecars: string): string {
  const d = path.join(L.RUN_DIR, 'sidecar-dists', name)
  fs.rmSync(d, { recursive: true, force: true })
  fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(d, 'distribution.toml'), BASE + sidecars)
  return d
}

/** `cargo xtask --dist <d> sidecars`: [exit ok, text]. */
function xtask(d: string): [boolean, string] {
  try {
    return [true, execFileSync('cargo', ['xtask', '--dist', d, 'sidecars'], { cwd: L.ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })]
  } catch (e: any) {
    return [false, String(e.stderr ?? '') + String(e.stdout ?? '')]
  }
}

const GOOD = `
[[sidecars]]
name = "geo"
command = "bin/geo"
image = "registry.example.com/geo:1"
port = 9100
health = "/health"
env = { TOKEN = "env:GEO_TOKEN" }
volumes = ["geodata:/data"]

[[sidecars]]
name = "cache"
image = "redis:7"
port = 9200
health = "tcp"
depends_on = ["geo"]
`

const checks: L.Check[] = [
  {
    id: 'SC-01',
    async run() {
      const c = H.checker()
      const [ok, text] = xtask(dist('good', GOOD))
      c.ok(ok, 'a valid [[sidecars]] section is accepted')
      c.ok(text.includes('desktop MOSAIKIT_ALLOW_PRIVATE_FETCH_HOSTS=127.0.0.1:9100,127.0.0.1:9200'), 'the desktop addresses are 127.0.0.1:<port>')
      c.ok(text.includes('container MOSAIKIT_ALLOW_PRIVATE_FETCH_HOSTS=geo:9100,cache:9200'), 'the container addresses are <name>:<port>')
      for (const [name, body, msg] of [
        ['dup', GOOD.replace('name = "cache"', 'name = "geo"'), 'duplicate'],
        ['dep', GOOD.replace('["geo"]', '["nope"]'), 'not a sidecar'],
        ['cycle', GOOD.replace('port = 9100', 'port = 9100\ndepends_on = ["cache"]'), 'cycle'],
        ['port', GOOD.replace('port = 9200', 'port = 70000'), ''],
        ['clash', GOOD.replace('port = 9200', 'port = 9100'), 'already used'],
        ['health', GOOD.replace('health = "tcp"', 'health = "ready"'), 'health'],
        ['empty', '[[sidecars]]\nname = "x"\n', 'command'],
      ] as const) {
        const [fine, out] = xtask(dist(name, body))
        c.ok(!fine && out.includes(msg), `an invalid section is refused with a clear message (${name})`)
      }
      return c.result()
    },
  },
  {
    id: 'SC-02',
    async run() {
      const c = H.checker()
      const [, text] = xtask(dist('compose', GOOD))
      c.ok(/services:\n {2}app:\n {4}depends_on:\n {6}geo:\n {8}condition: service_healthy/.test(text), 'the app service waits for the sidecars to be healthy')
      c.ok(text.includes('MOSAIKIT_ALLOW_PRIVATE_FETCH_HOSTS: ${MOSAIKIT_ALLOW_PRIVATE_FETCH_HOSTS:-geo:9100,cache:9200}'), 'the app learns the sidecar addresses')
      c.ok(text.includes('image: registry.example.com/geo:1') && text.includes('TOKEN: "${GEO_TOKEN:-}"'), 'image and env:NAME reference are in the service')
      c.ok(text.includes('healthcheck:') && text.includes('nc -z 127.0.0.1 9200'), 'a healthcheck is generated for each health setting')
      if (c.result().status !== 'PASS') return c.result()
      return { status: 'NOT VERIFIABLE', note: 'the generated compose.sidecars.yml is as expected; `cargo xtask release docker` and a running compose were not touched' }
    },
  },
  {
    id: 'SC-03',
    async run() {
      // the unit tests of the launcher run a fake sidecar (health, restart, stop order, missing executable)
      const c = H.checker()
      let out = ''
      try {
        out = execFileSync('cargo', ['test', '-p', 'mosaikit-desktop', 'sidecar::'], { cwd: L.ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (e: any) {
        out = String(e.stdout ?? '') + String(e.stderr ?? '')
      }
      c.ok(/test result: ok\. \d+ passed; 0 failed/.test(out), 'the launcher tests with a fake sidecar pass')
      return c.result()
    },
  },
]

export default checks
