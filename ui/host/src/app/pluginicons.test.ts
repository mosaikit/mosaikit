// The icon an official plugin names in its manifest (`icon = "megaphone"`) must be one the shell draws: an unknown
// name falls back to the puzzle piece. Skipped when the plugins repository is not next to this one.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ICON_NAMES } from './appicons.ts'

const root = resolve(process.cwd(), '../../../mosaikit-plugins')

describe.skipIf(!existsSync(root))('icons of the official plugins', () => {
  it('are all known to the shell', () => {
    const unknown: string[] = []
    for (const dir of readdirSync(root, { withFileTypes: true })) {
      const file = resolve(root, dir.name, 'plugin.toml')
      if (!dir.isDirectory() || !existsSync(file)) continue
      for (const m of readFileSync(file, 'utf8').matchAll(/^icon\s*=\s*"([a-z0-9-]+)"/gm)) {
        if (!ICON_NAMES.includes(m[1])) unknown.push(`${dir.name}: ${m[1]}`)
      }
    }
    expect(unknown, 'add these Lucide names to AppIcon.tsx').toEqual([])
  })
})
