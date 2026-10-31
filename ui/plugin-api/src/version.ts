// Version of the plugin API: the contract between a plugin UI and the shell (bridge operations, events, shape
// of `Hello`) and, with the SDK crate, the logic. An integer that grows only with a breaking change; the
// manifest declares the one the plugin was built for with `[requires] api`.

import { BridgeError } from './bridge.ts'

/** The plugin API this package implements. */
export const API_VERSION = 1

/** `BridgeError.code` of the handshake: the plugin and the host do not speak the same plugin API. */
export const INCOMPATIBLE_API = 'incompatible_api'

/**
 * The plugin side of the handshake. `hostApi` is the `api` of `Hello`; a host that predates the handshake
 * sends none and speaks API 1. A host older than this package cannot serve it: the plugin declares itself
 * incompatible. A host newer than this package decides for itself (it refuses with `incompatible_api` when
 * it does not support the API the plugin announced), so a newer host is accepted here.
 */
export function checkHostApi(hostApi: number | undefined, mine: number = API_VERSION): number {
  const host = typeof hostApi === 'number' && Number.isInteger(hostApi) && hostApi >= 1 ? hostApi : 1
  if (host < mine) {
    throw new BridgeError(`this plugin needs plugin API ${mine}, this host speaks API ${host}`, INCOMPATIBLE_API)
  }
  return host
}

/** The plugin or the host declared the pair incompatible (the page may show a message of its own). */
export function isIncompatible(e: unknown): boolean {
  return e instanceof BridgeError && e.code === INCOMPATIBLE_API
}
