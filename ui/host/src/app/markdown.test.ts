import { describe, expect, it } from 'vitest'
import guideUser from '../../../../docs/guide/user.md?raw'
import guideManager from '../../../../docs/guide/tenant-manager.md?raw'
import guideAdmin from '../../../../docs/guide/administrator.md?raw'
import guideUserIt from '../../../../docs/guide/it/user.md?raw'
import guideManagerIt from '../../../../docs/guide/it/tenant-manager.md?raw'
import guideAdminIt from '../../../../docs/guide/it/administrator.md?raw'
import { parse } from './markdown.ts'

describe('markdown of the guides', () => {
  it('reads headings, paragraphs, nested lists and tables', () => {
    const b = parse('# Title\n\nSome **bold**\ntext.\n\n- one\n  - inner\n- two\n  continued\n\n1. first\n2. second\n\n| A | B |\n|---|---|\n| x | y |\n')
    expect(b.map((x) => x.kind)).toEqual(['heading', 'para', 'list', 'list', 'table'])
    expect(b[1]).toEqual({ kind: 'para', text: 'Some **bold** text.' })
    const list = b[2] as { kind: 'list'; items: { text: string; children: unknown[] }[] }
    expect(list.items.map((i) => i.text)).toEqual(['one', 'two continued'])
    expect(list.items[0].children).toHaveLength(1)
    expect((b[3] as { ordered: boolean }).ordered).toBe(true)
    expect(b[4]).toEqual({ kind: 'table', head: ['A', 'B'], rows: [['x', 'y']] })
  })

  it('has every guide in English and Italian, with the same sections', () => {
    const heads = (md: string) => parse(md).filter((x) => x.kind === 'heading').length
    for (const [en, it_] of [
      [guideUser, guideUserIt],
      [guideManager, guideManagerIt],
      [guideAdmin, guideAdminIt],
    ]) {
      expect(heads(it_)).toBe(heads(en))
      expect(heads(en)).toBeGreaterThan(5)
    }
  })
})
