import { Bridge, BridgeError } from './bridge.ts'
import { API_VERSION, checkHostApi } from './version.ts'
import type { ExtensionView, FileEntry, Hello, HostEventName, ListResult, Listing, Notify, PublicResource, Rect, ResourceMeta, Row, SiteInfo, TabInfo, UiContext, Values, WebProbe } from './protocol.ts'

/** The extensions of the plugin on a resource (fields and actions other plugins add to its items). */
export interface ExtensionsClient {
  /** the extensions on in the tenant that the person may use (empty with an older host) */
  list(): Promise<ExtensionView[]>
  /** item id -> extension id -> values, for the items the person can see */
  values(ids: string[]): Promise<Record<string, Record<string, Values>>>
  /** changes the values of an extension on an item (the person must be able to edit it) */
  set(id: string, extension: string, values: Values): Promise<Values>
  /** runs an action of an extension on an item; returns the new values of the extension */
  action(id: string, extension: string, action: string): Promise<Values>
  /** Shows the tab `tab` of `extension` for the item `id` over `el`: the host draws the page of the
   *  extension in a frame of its own, placed and sized on `el` (which this keeps in step). Returns the
   *  function that closes it. */
  mountTab(el: HTMLElement, id: string, extension: string, tab: string): () => void
}

/** In a page of an extension opened as a tab: the item it is shown for, and its values. */
export interface TabClient {
  /** the item of the extended plugin, as the person sees it */
  item(): Promise<Row>
  /** the values of this extension on the item */
  values(): Promise<Values>
  /** changes some values of this extension on the item (the person must be able to edit it) */
  set(values: Values): Promise<Values>
  /** runs an action of this extension on the item */
  action(action: string): Promise<Values>
  /** asks the host for this height (the tab grows with its content: see `autoResize`) */
  resize(height: number): Promise<void>
  /** keeps the height of the tab equal to the height of `el` (default: the body); returns the stop */
  autoResize(el?: HTMLElement): () => void
}

function rectOf(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect()
  return { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) }
}

/** Base side of a tab: asks the host to open it and keeps its frame on `el` (position, size, visibility). */
function mountTab(b: Bridge, el: HTMLElement, resource: string, id: string, extension: string, tab: string): () => void {
  let closed = false
  let handle: string | null = null
  let last = ''
  let frame = 0
  const place = () => {
    if (closed) return
    frame = requestAnimationFrame(place)
    if (!handle) return
    const rect = rectOf(el)
    const visible = el.isConnected && el.getClientRects().length > 0
    const key = `${rect.top},${rect.left},${rect.width},${rect.height},${visible}`
    if (key === last) return
    last = key
    void b.call('ext.tab.place', { handle, rect, visible }).catch(() => {})
  }
  const off = b.onEvent((event, data) => {
    const d = data as { handle?: string; height?: number }
    if (event === 'ext.tab.height' && d?.handle === handle && typeof d.height === 'number') {
      el.style.height = `${Math.min(Math.max(Math.round(d.height), 80), 4000)}px`
    }
  })
  void b
    .call<{ handle: string }>('ext.tab.open', { resource, id, extension, tab, rect: rectOf(el) })
    .then((r) => {
      if (closed) {
        void b.call('ext.tab.close', { handle: r.handle }).catch(() => {})
        return
      }
      handle = r.handle
    })
    .catch((e) => {
      el.textContent = e instanceof Error ? e.message : String(e)
    })
  frame = requestAnimationFrame(place)
  return () => {
    closed = true
    cancelAnimationFrame(frame)
    off()
    if (handle) void b.call('ext.tab.close', { handle }).catch(() => {})
  }
}

export interface CrudClient {
  /** the rows, the latest changed first: all of them (up to 5,000), or a page with `limit` (the next with
   *  `cursor`, the `next` of the previous page). `sort` (a declared field that is not hidden, or `created_at`,
   *  `updated_at`, `owner_name`) and `dir` (`asc` by default, or `desc`) sort the WHOLE list, not the page: with `limit`
   *  the pages follow that order. A field that cannot be sorted is a 400 (`sort_unknown`). */
  list(opts?: { filter?: string; parent?: string; limit?: number; cursor?: string; sort?: string; dir?: 'asc' | 'desc' }): Promise<ListResult>
  get(id: string): Promise<Row>
  create(values: Values, parent?: string): Promise<Row>
  update(id: string, values: Values): Promise<Row>
  remove(id: string): Promise<void>
}

/** API of a plugin UI. Every call goes through the host, which limits it to the plugin. */
export class Msk {
  /** the plugin API the host speaks (the handshake already checked that this plugin can use it) */
  readonly api: number
  readonly isPublic: boolean
  readonly user: Hello['user']
  readonly tenant: Hello['tenant']
  readonly plugin: Hello['plugin']
  readonly publicResource: PublicResource | undefined
  /** current language, theme and mode of the host (updated at every `context` event) */
  context: UiContext | undefined
  /** the place the page was opened at, from a notification of the plugin (see `notify`) */
  readonly at: string | undefined
  /** permissions of the person in the plugin (older hosts: undefined, everything allowed) */
  readonly perms: string[] | undefined
  /** in a page of an extension opened as a tab of an item: where (otherwise undefined) */
  readonly tab: TabInfo | undefined

  constructor(
    readonly bridge: Bridge,
    hello: Hello,
  ) {
    this.api = checkHostApi(hello.api)
    this.isPublic = !!hello.public
    this.user = hello.user
    this.tenant = hello.tenant
    this.plugin = hello.plugin
    this.publicResource = hello.resource
    this.context = hello.context
    this.at = hello.at
    this.perms = hello.perms
    this.tab = hello.tab
  }

  /** In a page opened as a tab of an item (`msk.tab`): the item and the values of the extension on it. */
  tabClient(): TabClient {
    if (!this.tab) throw new BridgeError('this page is not open as the tab of an item')
    const b = this.bridge
    const resize = async (height: number) => {
      await b.call('tab.resize', { height: Math.round(height) })
    }
    return {
      item: () => b.call<Row>('tab.item'),
      values: () => b.call<Values>('tab.values'),
      set: async (values) => (await b.call<{ values: Values }>('tab.set', { values })).values,
      action: async (action) => (await b.call<{ values: Values }>('tab.action', { action })).values,
      resize,
      autoResize: (el = document.body) => {
        let last = 0
        const send = () => {
          const h = Math.ceil(el.scrollHeight)
          if (h !== last) {
            last = h
            void resize(h).catch(() => {})
          }
        }
        const ro = new ResizeObserver(send)
        ro.observe(el)
        send()
        return () => ro.disconnect()
      },
    }
  }

  /** The person has the permission `key` in the plugin (to hide what they may not do; the kernel and the
   *  logic of the plugin enforce it anyway). With an older host, true. */
  can(key: string): boolean {
    return this.perms ? this.perms.includes(key) : true
  }

  /** Tells when the host changes language, theme or mode (already applied to `<html>`). */
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

  /** Fields and actions that the extensions of the plugin add to the items of `resource`. */
  extensions(resource: string): ExtensionsClient {
    const b = this.bridge
    return {
      list: () =>
        b
          .call<ExtensionView[]>('ext.list', { resource })
          .then((r) => (Array.isArray(r) ? r : []))
          .catch(() => []),
      values: async (ids) => (ids.length ? b.call('ext.values', { resource, ids }) : {}),
      set: async (id, extension, values) => (await b.call<{ values: Values }>('ext.set', { resource, id, extension, values })).values,
      action: async (id, extension, action) => (await b.call<{ values: Values }>('ext.action', { resource, id, extension, action })).values,
      mountTab: (el, id, extension, tab) => mountTab(b, el, resource, id, extension, tab),
    }
  }

  /** Command of the WASM logic of the plugin. */
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
    /** content of the file (previews, downloads from the plugin) */
    blob: (id: string) => this.bridge.call<Blob>('files.blob', { id }),
    /** zip of a folder */
    zip: (id: string) => this.bridge.call<Blob>('files.zip', { id }),
    /** temporary URL on the origin of the contents (iframe, new tab, download) */
    url: async (id: string, download = false) => (await this.bridge.call<{ url: string }>('ticket', { id, download })).url,
  }

  readonly content = {
    upload: (id: string, zip: Blob) => this.bridge.call<SiteInfo>('content.upload', { id, file: zip }),
    url: async (id: string) => (await this.bridge.call<{ url: string }>('ticket', { id })).url,
  }

  /** Web pages seen by the host (permission `web`): may the site be framed, its title and picture. */
  readonly web = {
    probe: (url: string, image = false) => this.bridge.call<WebProbe>('web.probe', { url, image }),
  }

  /** Metadata of a resource (owner, level, size...). */
  resource(id: string): Promise<ResourceMeta> {
    return this.bridge.call<ResourceMeta>('resource.meta', { id })
  }

  /** Sends a notification: to the person using the plugin or, with `resource`, to the people who can see
   *  that item. It arrives in the bell of the host and, if they chose so, by email. Returns how many
   *  people received it. */
  async notify(n: Notify): Promise<number> {
    const r = await this.bridge.call<{ sent: number }>('notify', { ...n })
    return r.sent
  }

  /** Opens the share dialog of the host (users, groups, public links). */
  async share(id: string): Promise<void> {
    await this.bridge.call('share', { id })
  }

  toast(text: string, error = false) {
    void this.bridge.call('toast', { text, error }).catch(() => {})
  }

  /** Confirmation with the dialog of the host. */
  confirm(text: string): Promise<boolean> {
    return this.bridge.call<boolean>('confirm', { text })
  }

  /** In public links: the shared resource with its values. */
  publicGet(): Promise<PublicResource> {
    return this.bridge.call<PublicResource>('public.get')
  }

  /** Every event of the host (see `HostEvents` for what each carries); returns the function that stops listening. */
  onEvent(fn: (event: HostEventName, data: unknown) => void) {
    return this.bridge.onEvent((event, data) => fn(event as HostEventName, data))
  }
}

/** Applies language, mode and theme of the host to `<html>`: `lang`, `data-mode`, `data-preset`, `color-scheme`. */
/** @internal */
export function applyContext(ctx: UiContext | undefined, root: HTMLElement = document.documentElement) {
  if (!ctx) return
  if (/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(ctx.lang)) root.lang = ctx.lang
  if (ctx.mode === 'light' || ctx.mode === 'dark') {
    root.dataset.mode = ctx.mode
    root.style.colorScheme = ctx.mode
  }
  if (/^[a-z0-9-]{1,32}$/.test(ctx.preset)) root.dataset.preset = ctx.preset
  if (ctx.contrast) root.dataset.contrast = 'more'
  else delete root.dataset.contrast
  applyTheme(ctx.theme, root)
}

/** @internal */
export function applyTheme(vars: Record<string, string> | undefined, root: HTMLElement = document.documentElement) {
  if (!vars) return
  for (const [k, v] of Object.entries(vars)) {
    if (/^--[a-z0-9-]+$/.test(k) && typeof v === 'string' && !/[;{}<>]/.test(v)) root.style.setProperty(k, v)
  }
}

/**
 * Connection to the host. The host passes its own origin in the `host` parameter
 * of the URL of the iframe: every message is sent only to that origin.
 */
export async function connect(win: Window = window): Promise<Msk> {
  const params = new URLSearchParams(win.location.search)
  const host = params.get('host')
  if (!host || win.parent === win) {
    throw new BridgeError('this page must be opened inside Mosaikit (the host is missing)')
  }
  const bridge = new Bridge(win.parent, host, win)
  // the handshake: the host refuses (`incompatible_api`) a plugin built for an API it does not speak
  const hello = await bridge.call<Hello>('hello', { api: API_VERSION })
  applyTheme(hello.theme)
  applyContext(hello.context)
  const msk = new Msk(bridge, hello)
  // `theme` is deprecated (API 1 still sends it for plugins that predate `context`); `context` carries the same
  // variables, so a plugin that gets both applies the same values twice
  msk.onEvent((event, data) => {
    if (event === 'theme') applyTheme(data as Record<string, string>)
    if (event === 'context') {
      msk.context = data as UiContext
      applyContext(msk.context)
    }
  })
  return msk
}
