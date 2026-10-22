import { isEvent, isReply, type BridgeRequest } from './protocol.ts'

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

export class BridgeError extends Error {}

/**
 * Plugin side of the bridge: it sends requests to the host (parent window) and
 * waits for the answer. It accepts only messages from the window and the origin
 * of the host.
 */
export class Bridge {
  private pending = new Map<string, Pending>()
  private seq = 0
  private listeners: ((event: string, data: unknown) => void)[] = []
  private readonly onMessage = (ev: MessageEvent) => this.handle(ev)

  constructor(
    private readonly host: Window,
    private readonly hostOrigin: string,
    private readonly self: Window = window,
    private readonly timeoutMs = 120_000,
  ) {
    if (!hostOrigin || hostOrigin === '*') throw new BridgeError('missing origin of the host')
    self.addEventListener('message', this.onMessage)
  }

  call<T = unknown>(op: string, args?: unknown): Promise<T> {
    const id = `${Date.now().toString(36)}-${++this.seq}`
    const msg: BridgeRequest = { msk: 1, id, op, args }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new BridgeError(`the host did not answer ${op}`))
      }, this.timeoutMs)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      this.host.postMessage(msg, this.hostOrigin)
    })
  }

  onEvent(fn: (event: string, data: unknown) => void): () => void {
    this.listeners.push(fn)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn)
    }
  }

  dispose() {
    this.self.removeEventListener('message', this.onMessage)
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new BridgeError('bridge closed'))
    }
    this.pending.clear()
  }

  private handle(ev: MessageEvent) {
    if (ev.source !== this.host || ev.origin !== this.hostOrigin) return
    const d = ev.data
    if (isEvent(d)) {
      for (const l of this.listeners) l(d.event, d.data)
      return
    }
    if (!isReply(d)) return
    const p = this.pending.get(d.id)
    if (!p) return
    this.pending.delete(d.id)
    clearTimeout(p.timer)
    if (d.err !== undefined) p.reject(new BridgeError(d.err))
    else p.resolve(d.ok)
  }
}
