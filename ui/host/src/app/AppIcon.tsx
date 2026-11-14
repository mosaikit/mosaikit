// The icon of an app in the shell: the set of the shell (Lucide), named by the manifest of the plugin
// (`icon = "notebook-pen"`), so the bar has a single style. Only the names below are drawn (a manifest
// cannot load anything else); an unknown name falls back to the icon of the official plugins of an
// older server, then to the puzzle piece.

import { type LucideIcon, Folder, SquareCheckBig, BookUser, Map, NotebookPen, LayoutGrid, Puzzle } from 'lucide-react'
import { ICONS } from './appicons.ts'

/** The official plugins on a server that does not send the name of the icon yet. */
const BY_APP: Record<string, LucideIcon> = {
  tasks: SquareCheckBig,
  contacts: BookUser,
  files: Folder,
  maps: Map,
  notes: NotebookPen,
  'static-site': LayoutGrid,
}

/** `fallback`: the name drawn when `name` is not one the shell knows (before the icon of the plugin). */
export default function AppIcon({ id, name, fallback, className }: { id: string; name?: string | null; fallback?: string; className?: string }) {
  const Icon = (name ? ICONS[name] : undefined) ?? (fallback ? ICONS[fallback] : undefined) ?? BY_APP[id.split('.').pop() ?? ''] ?? Puzzle
  return <Icon className={className} aria-hidden="true" />
}
