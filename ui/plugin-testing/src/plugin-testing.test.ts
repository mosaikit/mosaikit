import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEV_PASSWORD,
  DEV_TENANT,
  DEV_USERS,
  attachDevServer,
  devArgs,
  formatViolations,
  freePort,
  parseDevOutput,
  pluginUrl,
  waitForHealth,
} from './index.ts'

let servers: http.Server[] = []

/** A server that answers /api/health with a body (or a status), as the development server does. */
async function health(body: unknown, status = 200): Promise<string> {
  const s = http.createServer((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    } else {
      res.writeHead(404).end()
    }
  })
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()))
  servers.push(s)
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`
}

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))))
  servers = []
})

describe('test users', () => {
  it('are the four accounts of the developer profile', () => {
    expect(Object.keys(DEV_USERS).sort()).toEqual(['admin', 'alice', 'bob', 'manager'])
    expect(DEV_USERS.manager.role).toBe('Tenant Manager')
    expect(DEV_PASSWORD).toBe('mosaikit-dev')
    expect(DEV_TENANT).toBe('dev')
  })
})

describe('the development server', () => {
  it('prints the address the helper reads', () => {
    const out = `
Mosaikit developer profile for com.test.demo (C:\\x)
  app      http://127.0.0.1:8080/
  plugins  http://*.localhost:8081 (one origin per plugin)
`
    expect(parseDevOutput(out)).toEqual({ app: 'http://127.0.0.1:8080/' })
    expect(parseDevOutput('http://nothing here')).toEqual({})
    expect(parseDevOutput('  app      http://127.0.0.1:9000').app).toBe('http://127.0.0.1:9000/')
  })

  it('is started with no browser and no rebuild on change', () => {
    expect(devArgs({})).toEqual(['dev', '.', '--no-open', '--no-watch', '--no-build'])
    expect(devArgs({ plugin: 'p', build: true, port: 9000, data: 'd', fresh: true, server: 's' })).toEqual([
      'dev', 'p', '--no-open', '--no-watch', '--server', 's', '--port', '9000', '--data', 'd', '--fresh',
    ])
  })

  it('has the address of a plugin in the shell', () => {
    expect(pluginUrl('http://localhost:8080', 'com.test.demo')).toBe('http://localhost:8080/#/t/dev/p/com.test.demo')
    expect(pluginUrl('http://localhost:8080/', 'a.b.c', 'acme')).toBe('http://localhost:8080/#/t/acme/p/a.b.c')
  })

  it('is attached only when it is in the developer profile', async () => {
    const dev = await attachDevServer(await health({ developer: true }))
    expect(dev.url.endsWith('/')).toBe(true)
    await dev.stop()
    await expect(attachDevServer(await health({ developer: false }))).rejects.toThrow(/not in the developer profile/)
    await expect(waitForHealth(await health({}, 503), 700)).rejects.toThrow(/HTTP 503/)
    await expect(waitForHealth(`http://127.0.0.1:${await freePort()}`, 600)).rejects.toThrow(/does not answer/)
  })
})

describe('accessibility report', () => {
  it('lists the worst violations first', () => {
    const text = formatViolations([
      { id: 'region', impact: 'moderate', help: 'Content should be in landmarks', nodes: [{ target: ['body'] }] },
      { id: 'label', impact: 'critical', help: 'Inputs need labels', nodes: [{ target: ['input', '#a'] }, { target: ['#b'] }] },
    ])
    const lines = text.split('\n')
    expect(lines[0]).toBe('critical: label - Inputs need labels (2 element(s), e.g. input #a)')
    expect(lines[1]).toContain('moderate: region')
    expect(formatViolations([])).toBe('')
  })
})
