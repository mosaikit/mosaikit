// The pictures of the empty states (docs/refactoring-ui.md, rule «Empty states»): soft rounded tiles of the colours of the
// theme, tilted and overlapping like the ones of Microsoft Teams, with a white symbol on the big one. Inline SVG only; the
// colours come from the design tokens (`--primary`, `--chart-2..4`), so they read in light and dark. Decorative: aria-hidden.

import { useId } from 'react'

export type ArtName = 'documents' | 'maps' | 'notes' | 'tasks' | 'contacts' | 'apps' | 'people' | 'plugins' | 'inbox' | 'trash' | 'shares' | 'usage' | 'generic'

/** The symbol of each picture: paths on a 24x24 grid, stroked in white by the big tile. */
const GLYPHS: Record<ArtName, string[]> = {
  documents: ['M7 3h7l5 5v13H7z', 'M14 3v5h5', 'M10 13h6', 'M10 17h4'],
  maps: ['M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z', 'M12 8.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z'],
  notes: ['M5 4h14v16H5z', 'M8 9h8', 'M8 13h8', 'M8 17h5'],
  tasks: ['M4 12.5l4.5 4.5L20 6.5'],
  contacts: ['M12 5.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z', 'M5 20c1-4 4-5.5 7-5.5s6 1.5 7 5.5'],
  apps: ['M4 4h6.5v6.5H4z', 'M13.5 4H20v6.5h-6.5z', 'M4 13.5h6.5V20H4z', 'M13.5 13.5H20V20h-6.5z'],
  people: ['M9 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M3 19c.8-3.4 3.2-5 6-5s5.200 1.600 6 5', 'M16 6.500a2.600 2.600 0 1 1 0 5', 'M17 14.200c2.200.4 3.500 2 4 4.800'],
  plugins: ['M4 8l8-4 8 4v8l-8 4-8-4z', 'M4 8l8 4 8-4', 'M12 12v8'],
  inbox: ['M4 13l2-8h12l2 8v6H4z', 'M4 13h5l1 2h4l1-2h5'],
  trash: ['M5 7h14', 'M9 7V4h6v3', 'M7 7l1 13h8l1-13'],
  shares: ['M6 9.500a2.500 2.500 0 1 0 0 5 2.500 2.500 0 0 0 0-5z', 'M18 3.500a2.500 2.500 0 1 0 0 5 2.500 2.500 0 0 0 0-5z', 'M18 15.500a2.500 2.500 0 1 0 0 5 2.500 2.500 0 0 0 0-5z', 'M8.200 10.800l7.600-4', 'M8.200 13.200l7.600 4'],
  usage: ['M5 20v-6', 'M10 20V8', 'M15 20v-9', 'M20 20V5'],
  generic: ['M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z'],
}

/** A tile: a rounded square with a soft light from the top left. */
function Tile({ x, y, s, r, rot, color, id }: { x: number; y: number; s: number; r: number; rot: number; color: string; id: string }) {
  return (
    <g transform={`rotate(${rot} ${x + s / 2} ${y + s / 2})`}>
      <rect x={x} y={y + 3} width={s} height={s} rx={r} fill="#000" opacity=".10" />
      <rect x={x} y={y} width={s} height={s} rx={r} fill={color} />
      <rect x={x} y={y} width={s} height={s} rx={r} fill={`url(#${id})`} />
    </g>
  )
}

export function EmptyArt({ name = 'generic', className }: { name?: ArtName; className?: string }) {
  const id = useId().replace(/:/g, '')
  const glyph = GLYPHS[name] ?? GLYPHS.generic
  return (
    <svg data-testid="empty-art" data-art={name} aria-hidden="true" viewBox="0 0 200 132" className={className ?? 'h-32 w-48'}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".38" />
          <stop offset=".55" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".16" />
        </linearGradient>
      </defs>
      <circle cx="30" cy="30" r="5" fill="var(--chart-3)" opacity=".55" />
      <circle cx="176" cy="102" r="6" fill="var(--chart-2)" opacity=".5" />
      <circle cx="168" cy="26" r="3.500" fill="var(--chart-4)" opacity=".6" />
      <Tile x={30} y={44} s={46} r={14} rot={-14} color="var(--chart-3)" id={id} />
      <Tile x={126} y={40} s={44} r={14} rot={12} color="var(--chart-4)" id={id} />
      <Tile x={70} y={24} s={64} r={20} rot={0} color="var(--primary)" id={id} />
      <g transform="translate(86 40) scale(1.333)" fill="none" stroke="#fff" strokeWidth="1.800" strokeLinecap="round" strokeLinejoin="round">
        {glyph.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <rect x="64" y="104" width="72" height="7" rx="3.500" fill="currentColor" opacity=".08" />
    </svg>
  )
}
