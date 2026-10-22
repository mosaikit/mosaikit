// L'icona di un'app nella shell: lo stesso set (Lucide) delle voci della shell, al posto dell'emoji
// del manifest, cosi' la barra ha un solo stile. Le app sconosciute hanno il pezzo di puzzle.
// Nella shell definitiva il plugin potra' dichiarare il nome dell'icona nel manifest.

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
