export interface PluginInfo {
  id: string
  name: string
  version: string
  active: boolean
  icon: string
  label: string
  view: string
  permissions: string[]
  /** "files" = file manager; altrimenti risorsa CRUD */
  kind?: string
  /** true se il plugin include ui.js trusted (modello GeoLibre) */
  has_ui?: boolean
}

export type PluginOp = 'activate' | 'deactivate' | 'uninstall'

export interface ServiceInfo {
  service: string
  version: string
  started: number
}
