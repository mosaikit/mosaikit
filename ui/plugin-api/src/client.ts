import { Bridge, BridgeError } from './bridge.ts'
import type { FileEntry, Hello, ListResult, Listing, PublicResource, Row, SiteInfo, UiContext, Values } from './protocol.ts'

export interface CrudClient {
  list(opts?: { filter?: string; parent?: string }): Promise<ListResult>
  get(id: string): Promise<Row>
  create(values: Values, parent?: string): Promise<Row>
  update(id: string, values: Values): Promise<Row>
  remove(id: string): Promise<void>
}

/** API di una UI di plugin. Tutte le chiamate passano dall'host, che le limita al plugin. */
export class Msk {
  readonly isPublic: boolean
  readonly user: Hello['user']
  readonly tenant: Hello['tenant']
  readonly plugin: Hello['plugin']
  readonly publicResource: PublicResource | undefined
  /** lingua, tema e modo correnti dell'host (aggiornati a ogni evento `context`) */
  context: UiContext | undefined

  constructor(
    readonly bridge: Bridge,
    hello: Hello,
  ) {
    this.isPublic = !!hello.public
    this.user = hello.user
    this.tenant = hello.tenant
    this.plugin = hello.plugin
    this.publicResource = hello.resource
    this.context = hello.context
  }

  /** Avvisa quando l'host cambia lingua, tema o modo (gia' applicati a `<html>`). */
  onContext(fn: (ctx: UiContext) => void) {
    return this.bridge.onEvent((event, data) => {
      if (event === 'context') fn(data as UiContext)
    })
  }

  crud(resource: string): CrudClient {
    const b = this.bridge
    return {
      list: (opts) => b.call('crud.list', { resource, ...opts }),
      get: (id) => b.call('crud.get', { resource, id }),
      create: (values, parent) => b.call('crud.create', { resource, values, parent }),
      update: (id, values) => b.call('crud.update', { resource, id, values }),
      remove: async (id) => {
        await b.call('crud.delete', { resource, id })
      },
    }
  }

  /** Comando della logica WASM del plugin. */
  async call<T = unknown>(name: string, args?: unknown): Promise<T> {
    const r = await this.bridge.call<{ result: T }>('call', { name, args })
    return r.result
  }

  readonly files = {
    list: (parent?: string | null) => this.bridge.call<Listing>('files.list', { parent: parent ?? null }),
    mkdir: (name: string, parent?: string | null) => this.bridge.call<FileEntry>('files.mkdir', { name, parent: parent ?? null }),
    upload: (file: Blob, name: string, parent?: string | null, replace = false) =>
      this.bridge.call<FileEntry>('files.upload', { file, name, parent: parent ?? null, replace }),
    rename: (id: string, name: string) => this.bridge.call<FileEntry>('files.rename', { id, name }),
    move: (id: string, parent: string | null) => this.bridge.call<FileEntry>('files.move', { id, parent }),
    copy: (id: string, parent: string | null) => this.bridge.call<FileEntry>('files.copy', { id, parent }),
    remove: async (id: string) => {
      await this.bridge.call('files.delete', { id })
    },
    /** contenuto del file (anteprime, download dal plugin) */
    blob: (id: string) => this.bridge.call<Blob>('files.blob', { id }),
    /** zip di una cartella */
    zip: (id: string) => this.bridge.call<Blob>('files.zip', { id }),
    /** URL temporaneo sull'origine dei contenuti (iframe, nuova scheda, download) */
    url: async (id: string, download = false) => (await this.bridge.call<{ url: string }>('ticket', { id, download })).url,
  }

  readonly content = {
    upload: (id: string, zip: Blob) => this.bridge.call<SiteInfo>('content.upload', { id, file: zip }),
    url: async (id: string) => (await this.bridge.call<{ url: string }>('ticket', { id })).url,
  }

  /** Metadati di una risorsa (proprietario, livello, dimensione...). */
  resource(id: string) {
    return this.bridge.call<Record<string, unknown>>('resource.meta', { id })
  }

  /** Apre la finestra di condivisione dell'host (utenti, gruppi, link pubblici). */
  async share(id: string): Promise<void> {
    await this.bridge.call('share', { id })
  }

  toast(text: string, error = false) {
    void this.bridge.call('toast', { text, error }).catch(() => {})
  }

  /** Conferma con il dialogo dell'host. */
  confirm(text: string): Promise<boolean> {
    return this.bridge.call<boolean>('confirm', { text })
  }

  /** Nei link pubblici: la risorsa condivisa con i suoi valori. */
  publicGet(): Promise<PublicResource> {
    return this.bridge.call<PublicResource>('public.get')
  }

  onEvent(fn: (event: string, data: unknown) => void) {
    return this.bridge.onEvent(fn)
  }
}

/** Applica lingua, modo e tema dell'host a `<html>`: `lang`, `data-mode`, `data-preset`, `color-scheme`. */
export function applyContext(ctx: UiContext | undefined, root: HTMLElement = document.documentElement) {
  if (!ctx) return
  if (/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(ctx.lang)) root.lang = ctx.lang
  if (ctx.mode === 'light' || ctx.mode === 'dark') {
    root.dataset.mode = ctx.mode
    root.style.colorScheme = ctx.mode
  }
  if (/^[a-z0-9-]{1,32}$/.test(ctx.preset)) root.dataset.preset = ctx.preset
  applyTheme(ctx.theme, root)
}

export function applyTheme(vars: Record<string, string> | undefined, root: HTMLElement = document.documentElement) {
  if (!vars) return
  for (const [k, v] of Object.entries(vars)) {
    if (/^--[a-z0-9-]+$/.test(k) && typeof v === 'string' && !/[;{}<>]/.test(v)) root.style.setProperty(k, v)
  }
}

/**
 * Connessione all'host. L'host passa la propria origine nel parametro `host`
 * dell'URL dell'iframe: ogni messaggio viene inviato solo a quell'origine.
 */
export async function connect(win: Window = window): Promise<Msk> {
  const params = new URLSearchParams(win.location.search)
  const host = params.get('host')
  if (!host || win.parent === win) {
    throw new BridgeError("questa pagina va aperta dentro Mosaikit (manca l'host)")
  }
  const bridge = new Bridge(win.parent, host, win)
  const hello = await bridge.call<Hello>('hello')
  applyTheme(hello.theme)
  applyContext(hello.context)
  const msk = new Msk(bridge, hello)
  msk.onEvent((event, data) => {
    if (event === 'theme') applyTheme(data as Record<string, string>)
    if (event === 'context') {
      msk.context = data as UiContext
      applyContext(msk.context)
    }
  })
  return msk
}
