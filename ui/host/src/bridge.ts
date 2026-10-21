// Lato host del bridge con le UI dei plugin.
//
// Ogni richiesta del plugin viene tradotta in una chiamata REST **limitata al
// plugin dell'iframe** (il plugin non puo' indicarne un altro) e al tenant
// attivo. Le operazioni sconosciute o con argomenti non validi sono rifiutate.

import { api, enc } from './api.ts'

export interface RestCall {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  url: string
  json?: unknown
  raw?: Blob
  blob?: boolean
}

export class OpError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IDENT = /^[a-z][a-z0-9_]{0,47}$/
const COMMAND = /^[A-Za-z0-9_.-]{1,64}$/

type Args = Record<string, unknown>

function obj(a: unknown): Args {
  if (a === undefined || a === null) return {}
  if (typeof a !== 'object' || Array.isArray(a)) throw new OpError('argomenti non validi')
  return a as Args
}

export function uuid(v: unknown, what = 'id'): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw new OpError(`${what} non valido`)
  return v
}

function optUuid(v: unknown, what = 'parent'): string | null {
  return v === undefined || v === null || v === '' ? null : uuid(v, what)
}

function ident(v: unknown, what: string): string {
  if (typeof v !== 'string' || !IDENT.test(v)) throw new OpError(`${what} non valido`)
  return v
}

function str(v: unknown, what: string, max = 255): string {
  if (typeof v !== 'string' || !v.length || v.length > max) throw new OpError(`${what} non valido`)
  return v
}

function blob(v: unknown): Blob {
  if (!(v instanceof Blob)) throw new OpError('file non valido')
  return v
}

function values(v: unknown): Args {
  const o = obj(v)
  for (const val of Object.values(o)) {
    if (val !== null && !['string', 'number', 'boolean'].includes(typeof val)) throw new OpError('valori non validi')
  }
  return o
}

/** Operazioni gestite localmente dall'host (non diventano chiamate REST). */
export const LOCAL_OPS = new Set(['hello', 'share', 'toast', 'confirm'])

/** Traduce un'operazione del plugin in una chiamata REST. */
export function routeOp(tenant: string, plugin: string, op: string, rawArgs: unknown): RestCall {
  const base = `/api/t/${enc(tenant)}/p/${enc(plugin)}`
  const a = obj(rawArgs)
  switch (op) {
    case 'crud.list': {
      const q = new URLSearchParams()
      if (typeof a.filter === 'string' && a.filter) q.set('filter', a.filter.slice(0, 200))
      const parent = optUuid(a.parent)
      if (parent) q.set('parent', parent)
      const qs = q.toString()
      return { method: 'GET', url: `${base}/r/${ident(a.resource, 'risorsa')}${qs ? '?' + qs : ''}` }
    }
    case 'crud.get':
      return { method: 'GET', url: `${base}/r/${ident(a.resource, 'risorsa')}/${uuid(a.id)}` }
    case 'crud.create':
      return { method: 'POST', url: `${base}/r/${ident(a.resource, 'risorsa')}`, json: { values: values(a.values), parent: optUuid(a.parent) } }
    case 'crud.update':
      return { method: 'PUT', url: `${base}/r/${ident(a.resource, 'risorsa')}/${uuid(a.id)}`, json: { values: values(a.values) } }
    case 'crud.delete':
      return { method: 'DELETE', url: `${base}/r/${ident(a.resource, 'risorsa')}/${uuid(a.id)}` }
    case 'call': {
      const name = a.name
      if (typeof name !== 'string' || !COMMAND.test(name)) throw new OpError('nome del comando non valido')
      return { method: 'POST', url: `${base}/call/${enc(name)}`, json: { args: a.args ?? null } }
    }
    case 'files.list': {
      const parent = optUuid(a.parent)
      return { method: 'GET', url: `${base}/files${parent ? '?parent=' + parent : ''}` }
    }
    case 'files.mkdir':
      return { method: 'POST', url: `${base}/files/folder`, json: { name: str(a.name, 'nome'), parent: optUuid(a.parent) } }
    case 'files.upload': {
      const q = new URLSearchParams({ name: str(a.name, 'nome') })
      const parent = optUuid(a.parent)
      if (parent) q.set('parent', parent)
      if (a.replace === true) q.set('replace', '1')
      return { method: 'POST', url: `${base}/files/upload?${q}`, raw: blob(a.file) }
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
    case 'ticket':
      return { method: 'POST', url: `${base}/ticket/${uuid(a.id)}`, json: { download: a.download === true } }
    case 'content.upload':
      return { method: 'POST', url: `${base}/content/${uuid(a.id)}`, raw: blob(a.file) }
    case 'resource.meta':
      return { method: 'GET', url: `/api/t/${enc(tenant)}/resources/${uuid(a.id)}` }
    default:
      throw new OpError(`operazione non disponibile: ${op}`)
  }
}

export async function execute(call: RestCall): Promise<unknown> {
  return api(call.method, call.url, call.json, { raw: call.raw, blob: call.blob })
}

/** Variabili del tema dell'host passate alle UI dei plugin. */
export const THEME_VARS = [
  '--bg', '--panel', '--panel2', '--line', '--fg', '--dim', '--acc', '--acc-soft', '--acc-line', '--ok', '--err',
]

export function themeVars(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement)
  const out: Record<string, string> = {}
  for (const v of THEME_VARS) {
    const val = cs.getPropertyValue(v).trim()
    if (val) out[v] = val
  }
  return out
}
