// Store of the developer tools: the host calls of the plugins (with the time they took and their errors) and
// the last error of a reload. It records only while the developer profile is on (the shell asks `recording`),
// so a normal installation keeps nothing and pays nothing.

import { useSyncExternalStore } from 'react'

export interface HostCall {
  /** growing number, the key of the row */
  n: number
  at: number
  plugin: string
  op: string
  ms: number
  ok: boolean
  error?: string
}

/** The last reload that failed, for the panel (`migration_changed`: the migrations can be run again). */
export interface ReloadError {
  plugin: string
  error: string
  migrationChanged: boolean
}

const MAX = 200
let calls: HostCall[] = []
let lastError: ReloadError | null = null
let counter = 0
let recording = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** The shell turns the recording on when the server says it runs the developer profile. */
export function setRecording(on: boolean) {
  recording = on
}

export function recordCall(c: Omit<HostCall, 'n' | 'at'>) {
  if (!recording) return
  // a new array each time: `useSyncExternalStore` compares snapshots by identity
  calls = [{ ...c, n: ++counter, at: Date.now() }, ...calls].slice(0, MAX)
  emit()
}

export function clearCalls() {
  calls = []
  emit()
}

export function setReloadError(e: ReloadError | null) {
  lastError = e
  emit()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export const getCalls = () => calls
export const useCalls = () => useSyncExternalStore(subscribe, getCalls)
export const useReloadError = () => useSyncExternalStore(subscribe, () => lastError)

/** Runs `fn` and records it as a host call of `plugin`. */
export async function timed<T>(plugin: string, op: string, fn: () => Promise<T>): Promise<T> {
  if (!recording) return fn()
  const start = performance.now()
  try {
    const r = await fn()
    recordCall({ plugin, op, ms: performance.now() - start, ok: true })
    return r
  } catch (e) {
    recordCall({ plugin, op, ms: performance.now() - start, ok: false, error: e instanceof Error ? e.message : String(e) })
    throw e
  }
}
