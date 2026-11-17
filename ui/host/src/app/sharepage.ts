// A page of a plugin can replace the share dialog of the shell for the resources of a plugin
// (`[ui] share_page` of its manifest, or the one the distribution sets with `[[plugin_labels]] share_page`).
// The value is `<place>` of the plugin itself, or `<plugin id>/<place>` of another plugin of the tenant.

import type { PluginView } from '../types.ts'

export interface SharePageTarget {
  plugin: string
  /** the place inside the plugin, with `resource=<id>` at the end of its query */
  at: string
}

/** Where the Share button goes for a resource of `owner`, or `null` for the dialog of the shell. */
export function resolveSharePage(plugins: PluginView[], owner: string, resourceId: string): SharePageTarget | null {
  const declared = plugins.find((p) => p.id === owner)?.share_page?.trim()
  if (!declared) return null
  let plugin = owner
  let place = declared
  const slash = declared.indexOf('/')
  if (slash > 0) {
    const head = declared.slice(0, slash)
    // an app id is reverse-DNS (it has dots); a place has none
    if (plugins.some((p) => p.id === head) || head.includes('.')) {
      plugin = head
      place = declared.slice(slash + 1)
    }
  }
  // the page of another plugin must be one the person can open: it is in the list of the tenant (`plugins`)
  if (!plugins.some((p) => p.id === plugin && p.has_ui)) return null
  const at = `${place}${place.includes('?') ? '&' : '?'}resource=${encodeURIComponent(resourceId)}`
  return { plugin, at }
}
