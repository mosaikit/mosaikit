// The icon of an app in the shell: the same set (Lucide) as the items of the shell, instead of the emoji
// of the manifest, so the bar has a single style. Unknown apps get the puzzle piece.
// In the final shell the plugin will be able to declare the name of its icon in the manifest.

import { BookUser, Folder, Globe, Map, NotebookPen, Puzzle, SquareCheckBig, type LucideIcon } from 'lucide-react'

const BY_APP: Record<string, LucideIcon> = {
  tasks: SquareCheckBig,
  contacts: BookUser,
  files: Folder,
  maps: Map,
  notes: NotebookPen,
  'static-site': Globe,
}

export default function AppIcon({ id, className }: { id: string; className?: string }) {
  const Icon = BY_APP[id.split('.').pop() ?? ''] ?? Puzzle
  return <Icon className={className} aria-hidden="true" />
}
