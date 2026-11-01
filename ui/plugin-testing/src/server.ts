import { spawn, type ChildProcess } from 'node:child_process'
import net from 'node:net'

/** A development server the tests talk to. */
export interface DevServer {
  /** the address of the app, with the final slash (`http://127.0.0.1:8080/`) */
  url: string
  /** stops the server started by `startDevServer`; does nothing for an attached one */
  stop(): Promise<void>
}

const withSlash = (url: string) => (url.endsWith('/') ? url : `${url}/`)

/** What `mosaikit-plugin dev` prints: the address of the app. */
export function parseDevOutput(text: string): { app?: string } {
  const m = /^\s*app\s+(https?:\/\/\S+)/m.exec(text)
  return m ? { app: withSlash(m[1]) } : {}
}

/** The address of a plugin in the shell: `<app>#/t/<tenant>/p/<plugin id>`. */
export function pluginUrl(app: string, pluginId: string, tenant = 'dev'): string {
  return `${withSlash(app)}#/t/${tenant}/p/${pluginId}`
}

/** Waits until `/api/health` answers and says it is the developer profile (unless `developer` is false). */
export async function waitForHealth(app: string, timeoutMs = 90_000, developer = true): Promise<void> {
  const base = withSlash(app)
  const end = Date.now() + timeoutMs
  let last = 'no answer'
  while (Date.now() < end) {
    try {
      const res = await fetch(`${base}api/health`)
      if (res.ok) {
        const body = (await res.json()) as { developer?: boolean }
        if (!developer || body.developer === true) return
        last = 'the server answers but it is not in the developer profile'
        break
      }
      last = `HTTP ${res.status}`
    } catch (e) {
      last = String(e)
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`the development server does not answer on ${base}: ${last}`)
}

/**
 * Uses a server that is running already (`mosaikit-plugin dev` in a terminal, the Docker kit). The address comes from
 * the argument or from `MOSAIKIT_DEV_URL`. It refuses a server that is not in the developer profile: the test users
 * exist only there.
 */
export async function attachDevServer(url = process.env.MOSAIKIT_DEV_URL ?? 'http://localhost:8080/'): Promise<DevServer> {
  await waitForHealth(url, 10_000)
  return { url: withSlash(url), stop: async () => {} }
}

export interface StartOptions {
  /** the plugin folder (default: the current folder) */
  plugin?: string
  /** the `mosaikit-plugin` executable (default: `MOSAIKIT_PLUGIN_BIN`, then `mosaikit-plugin` of the PATH) */
  tool?: string
  /** the `mosaikit-server` executable, when it is not next to the tool */
  server?: string
  /** port of the app; the plugins use the next one (default: the first free pair the tool finds) */
  port?: number
  /** data folder of the server (default: the one of the tool) */
  data?: string
  /** start from an empty database */
  fresh?: boolean
  /** build the logic and the UI first (default: no, the tests run what is built) */
  build?: boolean
  timeoutMs?: number
}

/** The arguments of `mosaikit-plugin dev` for a start (no browser, no rebuild on change). */
export function devArgs(o: StartOptions): string[] {
  const a = ['dev', o.plugin ?? '.', '--no-open', '--no-watch']
  if (!o.build) a.push('--no-build')
  if (o.server) a.push('--server', o.server)
  if (o.port) a.push('--port', String(o.port))
  if (o.data) a.push('--data', o.data)
  if (o.fresh) a.push('--fresh')
  return a
}

/**
 * Starts `mosaikit-plugin dev` for the plugin folder and waits for the address it prints. `stop()` ends the tool and
 * the server it started.
 */
export async function startDevServer(o: StartOptions = {}): Promise<DevServer> {
  const tool = o.tool ?? process.env.MOSAIKIT_PLUGIN_BIN ?? 'mosaikit-plugin'
  const child: ChildProcess = spawn(tool, devArgs(o), { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  const exited = new Promise<never>((_, reject) => {
    child.once('error', (e) => reject(new Error(`cannot start ${tool}: ${e.message}`)))
    child.once('exit', (code) => reject(new Error(`${tool} stopped (exit ${code}):\n${out}`)))
  })
  exited.catch(() => {})
  child.stdout?.on('data', (d) => (out += String(d)))
  child.stderr?.on('data', (d) => (out += String(d)))
  const stop = async () => {
    if (child.exitCode !== null || !child.pid) return
    if (process.platform === 'win32') {
      await new Promise<void>((r) => spawn('taskkill', ['/PID', String(child.pid), '/T', '/F']).once('exit', () => r()))
    } else {
      child.kill('SIGINT')
    }
  }
  const timeout = o.timeoutMs ?? 120_000
  try {
    const app = await Promise.race([
      (async () => {
        const end = Date.now() + timeout
        while (Date.now() < end) {
          const found = parseDevOutput(out).app
          if (found) return found
          await new Promise((r) => setTimeout(r, 200))
        }
        throw new Error(`${tool} did not print the address of the app in ${timeout / 1000} s:\n${out}`)
      })(),
      exited,
    ])
    await waitForHealth(app, 30_000)
    return { url: app, stop }
  } catch (e) {
    await stop()
    throw e
  }
}

/** A free TCP port on the loopback (for a test that starts a server of its own). */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo
      s.close(() => resolve(port))
    })
  })
}
