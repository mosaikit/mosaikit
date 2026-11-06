// Host side of the bridge with the UIs of the plugins.
//
// Every request of the plugin is translated into a REST call **limited to the
// plugin of the iframe** (the plugin cannot name another one) and to the active
// tenant. Unknown operations or invalid arguments are refused.

import { api, ApiError, enc, errText } from './api.ts'

export interface RestCall {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url: string
  json?: unknown
  raw?: Blob
  blob?: boolean
}

export class OpError extends Error {
  constructor(
    message: string,
    /** stable code the plugin may react to (`incompatible_api`) */
    readonly code?: string,
  ) {
    super(message)
  }
}

/** The plugin API the shell speaks: the `API_VERSION` of `@mosaikit/plugin-api` (a test keeps them equal). */
export const SHELL_API = 1

/**
 * The handshake, host side: `hello` carries the plugin API the plugin UI was built for. A plugin that
 * announces nothing predates the handshake and speaks API 1. One built for a newer API than this shell
 * speaks is refused with `incompatible_api`; the shell speaks every API up to its own.
 */
export function checkPluginApi(args: unknown): void {
  const a = args && typeof args === 'object' ? (args as { api?: unknown }).api : undefined
  if (a === undefined) return
  if (typeof a !== 'number' || !Number.isInteger(a) || a < 1) throw new OpError('invalid plugin API', 'incompatible_api')
  if (a > SHELL_API) throw new OpError(`this plugin needs plugin API ${a}, this Mosaikit speaks API ${SHELL_API}`, 'incompatible_api')
}

/** The answer to a request that failed: the text in the language of the host and, for the errors of the
 *  server, the stable code, the HTTP status and the untranslated message (the plugin may translate the
 *  code itself, or react to it). */
export function errorReply(e: unknown): { err: string; code?: string; status?: number; message?: string } {
  // an error the logic of the plugin gave a code of its own reaches the plugin UI with that code
  if (e instanceof ApiError) return { err: errText(e), code: e.pluginCode ?? e.code, status: e.status, message: e.message }
  if (e instanceof OpError && e.code) return { err: errText(e), code: e.code }
  return { err: errText(e) }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IDENT = /^[a-z][a-z0-9_]{0,47}$/
const COMMAND = /^[A-Za-z0-9_.-]{1,64}$/
const PLUGIN_ID = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/

type Args = Record<string, unknown>

function obj(a: unknown): Args {
  if (a === undefined || a === null) return {}
  if (typeof a !== 'object' || Array.isArray(a)) throw new OpError('invalid arguments')
  return a as Args
}

export function uuid(v: unknown, what = 'id'): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw new OpError(`invalid ${what}`)
  return v
}

function optUuid(v: unknown, what = 'parent'): string | null {
  return v === undefined || v === null || v === '' ? null : uuid(v, what)
}

function ident(v: unknown, what: string): string {
  if (typeof v !== 'string' || !IDENT.test(v)) throw new OpError(`invalid ${what}`)
  return v
}

function pluginId(v: unknown): string {
  if (typeof v !== 'string' || v.length > 64 || !PLUGIN_ID.test(v)) throw new OpError('invalid extension')
  return v
}

function str(v: unknown, what: string, max = 255): string {
  if (typeof v !== 'string' || !v.length || v.length > max) throw new OpError(`invalid ${what}`)
  return v
}

function blob(v: unknown): Blob {
  if (!(v instanceof Blob)) throw new OpError('invalid file')
  return v
}

function values(v: unknown): Args {
  const o = obj(v)
  for (const val of Object.values(o)) {
    if (val !== null && !['string', 'number', 'boolean'].includes(typeof val)) throw new OpError('invalid values')
  }
  return o
}

const PAGE = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*\.html$/

/** The page of a tab of an extension is an .html file of its UI (no `..`, no absolute path). */
export function safePage(page: string): string {
  if (!PAGE.test(page) || page.split('/').some((s) => s === '.' || s === '..')) throw new OpError('invalid page of the tab')
  return page
}

/** Operations handled locally by the host (they do not become REST calls). */
export const LOCAL_OPS = new Set(['hello', 'share', 'toast', 'confirm', 'band.set', 'band.reset'])

/** Translates an operation of the plugin into a REST call. */
export function routeOp(tenant: string, plugin: string, op: string, rawArgs: unknown): RestCall {
  const base = `/api/t/${enc(tenant)}/p/${enc(plugin)}`
  const a = obj(rawArgs)
  switch (op) {
    case 'crud.list': {
      const q = new URLSearchParams()
      if (typeof a.filter === 'string' && a.filter) q.set('filter', a.filter.slice(0, 200))
      const parent = optUuid(a.parent)
      if (parent) q.set('parent', parent)
      if (typeof a.limit === 'number' && Number.isInteger(a.limit) && a.limit > 0) q.set('limit', String(Math.min(a.limit, 500)))
      if (typeof a.cursor === 'string' && a.cursor) q.set('cursor', a.cursor.slice(0, 200))
      // the sort of the whole list: a field name (the server checks it against the manifest) and a direction
      if (typeof a.sort === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(a.sort)) {
        q.set('sort', a.sort)
        if (a.dir === 'asc' || a.dir === 'desc') q.set('dir', a.dir)
      }
      const qs = q.toString()
      return { method: 'GET', url: `${base}/r/${ident(a.resource, 'resource')}${qs ? '?' + qs : ''}` }
    }
    case 'crud.get':
      return { method: 'GET', url: `${base}/r/${ident(a.resource, 'resource')}/${uuid(a.id)}` }
    case 'crud.create':
      return { method: 'POST', url: `${base}/r/${ident(a.resource, 'resource')}`, json: { values: values(a.values), parent: optUuid(a.parent) } }
    case 'crud.update':
      return { method: 'PUT', url: `${base}/r/${ident(a.resource, 'resource')}/${uuid(a.id)}`, json: { values: values(a.values) } }
    case 'crud.delete':
      return { method: 'DELETE', url: `${base}/r/${ident(a.resource, 'resource')}/${uuid(a.id)}` }
    case 'call': {
      const name = a.name
      if (typeof name !== 'string' || !COMMAND.test(name)) throw new OpError('invalid command name')
      return { method: 'POST', url: `${base}/call/${enc(name)}`, json: { args: a.args ?? null } }
    }
    // `source`: the Files area of another plugin (the kernel checks `files_read` / `files_write` of the manifest)
    case 'files.list': {
      const q = new URLSearchParams()
      const parent = optUuid(a.parent)
      if (parent) q.set('parent', parent)
      if (a.source !== undefined && a.source !== null) q.set('source', pluginId(a.source))
      const qs = q.toString()
      return { method: 'GET', url: `${base}/files${qs ? '?' + qs : ''}` }
    }
    case 'files.mkdir': {
      const q = new URLSearchParams()
      if (a.source !== undefined && a.source !== null) q.set('source', pluginId(a.source))
      const qs = q.toString()
      return { method: 'POST', url: `${base}/files/folder${qs ? '?' + qs : ''}`, json: { name: str(a.name, 'nome'), parent: optUuid(a.parent) } }
    }
    case 'files.upload': {
      const q = new URLSearchParams({ name: str(a.name, 'nome') })
      const parent = optUuid(a.parent)
      if (parent) q.set('parent', parent)
      if (a.replace === true) q.set('replace', '1')
      if (a.source !== undefined && a.source !== null) q.set('source', pluginId(a.source))
      return { method: 'POST', url: `${base}/files/upload?${q}`, raw: blob(a.file) }
    }
    // a zip unpacked into a folder (`parent`) or into a new one inside it (`folder`); `conflict`: fail, skip or replace
    case 'files.unzip': {
      const q = new URLSearchParams()
      const parent = optUuid(a.parent)
      if (parent) q.set('parent', parent)
      if (typeof a.folder === 'string' && a.folder) q.set('folder', str(a.folder, 'folder'))
      if (a.conflict === 'skip' || a.conflict === 'replace') q.set('conflict', a.conflict)
      if (a.source !== undefined && a.source !== null) q.set('source', pluginId(a.source))
      return { method: 'POST', url: `${base}/files/unzip?${q}`, raw: blob(a.file) }
    }
    case 'files.rename':
      return { method: 'POST', url: `${base}/files/${uuid(a.id)}/rename`, json: { name: str(a.name, 'nome') } }
    case 'files.move':
      return { method: 'POST', url: `${base}/files/${uuid(a.id)}/move`, json: { parent: optUuid(a.parent) } }
    case 'files.copy':
      return { method: 'POST', url: `${base}/files/${uuid(a.id)}/copy`, json: { parent: optUuid(a.parent) } }
    case 'files.delete':
      return { method: 'DELETE', url: `${base}/files/${uuid(a.id)}` }
    case 'files.blob':
      return { method: 'GET', url: `${base}/files/${uuid(a.id)}/content`, blob: true }
    case 'files.zip':
      return { method: 'GET', url: `${base}/files/${uuid(a.id)}/zip`, blob: true }
    case 'ticket': {
      const src = a.source !== undefined && a.source !== null ? `?source=${enc(pluginId(a.source))}` : ''
      return { method: 'POST', url: `${base}/ticket/${uuid(a.id)}${src}`, json: { download: a.download === true } }
    }
    case 'content.upload':
      return { method: 'POST', url: `${base}/content/${uuid(a.id)}`, raw: blob(a.file) }
    case 'web.probe':
      return { method: 'POST', url: `${base}/web/probe`, json: { url: str(a.url, 'url', 2000), image: a.image === true } }
    case 'resource.meta':
      return { method: 'GET', url: `/api/t/${enc(tenant)}/resources/${uuid(a.id)}` }
    // the people and groups of the tenant, for a plugin that declares `directory` (the kernel checks the
    // permission, the right of the person and the limits)
    case 'directory.search': {
      const kind = a.kind
      if (kind !== 'user' && kind !== 'group') throw new OpError('invalid kind')
      const body: Args = { kind, q: str(a.q, 'q', 64) }
      if (a.limit !== undefined && a.limit !== null) {
        if (typeof a.limit !== 'number' || !Number.isInteger(a.limit) || a.limit < 1) throw new OpError('invalid limit')
        body.limit = Math.min(a.limit, 50)
      }
      return { method: 'POST', url: `${base}/directory/search`, json: body }
    }
    // the page of another plugin to show in a frame (needs `embeds` in the permissions: the kernel checks it)
    case 'embed.url':
      return {
        method: 'POST',
        url: `${base}/embed/url`,
        json: { plugin: pluginId(a.plugin), name: ident(a.name, 'name'), resource: uuid(a.resource, 'resource') },
      }
    // the schedules of the plugin of the iframe: the kernel checks the right of the person, the host forces the plugin
    case 'schedules.list':
      return { method: 'GET', url: `/api/t/${enc(tenant)}/schedules?plugin=${enc(plugin)}` }
    case 'schedules.timezone':
      return { method: 'GET', url: `/api/t/${enc(tenant)}/schedules/timezone` }
    case 'schedules.create': {
      const j: Args = { plugin, name: str(a.name, 'name', 64), cron: str(a.cron, 'cron', 200) }
      if (a.time_zone !== undefined && a.time_zone !== null && a.time_zone !== '') j.time_zone = str(a.time_zone, 'time zone', 64)
      if (a.catch_up_once !== undefined) j.catch_up_once = a.catch_up_once === true
      if (a.label !== undefined && a.label !== null) j.label = str(a.label, 'label', 120)
      if (a.args !== undefined && a.args !== null) j.args = values(a.args)
      if (a.resources !== undefined && a.resources !== null) {
        if (!Array.isArray(a.resources) || a.resources.length > 64) throw new OpError('invalid resources')
        j.resources = a.resources.map((x) => uuid(x, 'resource'))
      }
      return { method: 'POST', url: `/api/t/${enc(tenant)}/schedules`, json: j }
    }
    case 'schedules.update': {
      const j: Args = {}
      if (a.label !== undefined && a.label !== null) j.label = str(a.label, 'label', 120)
      if (a.cron !== undefined && a.cron !== null) j.cron = str(a.cron, 'cron', 200)
      if (a.time_zone !== undefined && a.time_zone !== null) j.time_zone = str(a.time_zone, 'time zone', 64)
      if (typeof a.catch_up_once === 'boolean') j.catch_up_once = a.catch_up_once
      if (typeof a.enabled === 'boolean') j.enabled = a.enabled
      if (a.args !== undefined && a.args !== null) j.args = values(a.args)
      if (a.resources !== undefined && a.resources !== null) {
        if (!Array.isArray(a.resources) || a.resources.length > 64) throw new OpError('invalid resources')
        j.resources = a.resources.map((x) => uuid(x, 'resource'))
      }
      return { method: 'PATCH', url: `/api/t/${enc(tenant)}/schedules/${uuid(a.id)}?plugin=${enc(plugin)}`, json: j }
    }
    case 'schedules.pause':
    case 'schedules.resume':
    case 'schedules.run':
      return { method: 'POST', url: `/api/t/${enc(tenant)}/schedules/${uuid(a.id)}/${op.slice('schedules.'.length)}?plugin=${enc(plugin)}` }
    case 'schedules.remove':
      return { method: 'DELETE', url: `/api/t/${enc(tenant)}/schedules/${uuid(a.id)}?plugin=${enc(plugin)}` }
    case 'schedules.runs':
      return { method: 'GET', url: `/api/t/${enc(tenant)}/schedules/${uuid(a.id)}/runs?plugin=${enc(plugin)}` }
    case 'notify': {
      const n: Args = { title: str(a.title, 'title', 160) }
      if (a.body !== undefined && a.body !== null && a.body !== '') n.body = str(a.body, 'body', 600)
      if (a.at !== undefined && a.at !== null && a.at !== '') n.at = str(a.at, 'place', 200)
      const rid = optUuid(a.resource, 'resource')
      if (rid) n.resource = rid
      return { method: 'POST', url: `${base}/notify`, json: n }
    }
    // the extensions of the plugin of the iframe: fields and actions on its own items (the kernel
    // checks the permissions of each item)
    case 'ext.list':
      return { method: 'GET', url: `${base}/ext/${ident(a.resource, 'resource')}` }
    case 'ext.values': {
      if (!Array.isArray(a.ids) || a.ids.length > 1000) throw new OpError('invalid ids')
      return { method: 'POST', url: `${base}/ext/${ident(a.resource, 'resource')}/values`, json: { ids: a.ids.map((x) => uuid(x)) } }
    }
    case 'ext.set':
      return {
        method: 'PUT',
        url: `${base}/ext/${ident(a.resource, 'resource')}/${uuid(a.id)}/${pluginId(a.extension)}`,
        json: { values: values(a.values) },
      }
    case 'ext.action':
      return { method: 'POST', url: `${base}/ext/${ident(a.resource, 'resource')}/${uuid(a.id)}/${pluginId(a.extension)}/${ident(a.action, 'action')}` }
    default:
      throw new OpError(`operation not available: ${op}`)
  }
}

export async function execute(call: RestCall): Promise<unknown> {
  return api(call.method, call.url, call.json, { raw: call.raw, blob: call.blob })
}

/** Variables of the theme of the host passed to the UIs of the plugins. */
export const THEME_VARS = [
  '--bg', '--panel', '--panel2', '--line', '--fg', '--dim', '--acc', '--acc-soft', '--acc-line', '--ok', '--err', '--on-acc', '--on-err', '--err-fill',
]

export function themeVars(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement)
  const out: Record<string, string> = {}
  for (const v of THEME_VARS) {
    const val = cs.getPropertyValue(v).trim()
    if (val) out[v] = val
  }
  // the type of the pages of the host, for the header of the pages of the plugins
  const font = document.body ? getComputedStyle(document.body).fontFamily : ''
  if (font) out['--msk-font'] = font
  return out
}
