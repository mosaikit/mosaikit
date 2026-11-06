import { describe, expect, it } from 'vitest'
import { Msk, type Bridge } from './index.ts'

/** A server of uploads in pieces: `lose` is how many answers to a piece are lost after the piece was kept. */
function server(opts: { lose?: number; failAfter?: number } = {}) {
  const calls: { op: string; args: any }[] = []
  const st = { received: 0, size: 0, lose: opts.lose ?? 0, aborted: false }
  const bridge = {
    call: async (op: string, args: any) => {
      calls.push({ op, args })
      if (op === 'files.upload.begin') {
        st.size = args.size
        return { id: 'u1', received: 0, size: args.size }
      }
      if (op === 'files.upload.chunk') {
        if (opts.failAfter !== undefined && calls.filter((c) => c.op === 'files.upload.chunk').length > opts.failAfter) throw new Error('down')
        if (args.offset !== st.received) throw new Error('offset')
        st.received += (args.file as Blob).size
        if (st.lose-- > 0) throw new Error('the answer was lost')
        return { id: 'u1', received: st.received, size: st.size }
      }
      if (op === 'files.upload.status') return { id: 'u1', received: st.received, size: st.size }
      if (op === 'files.upload.finish') return { id: 'f1', name: 'big.bin', is_dir: false, size: st.size }
      if (op === 'files.upload.abort') {
        st.aborted = true
        return {}
      }
      return {}
    },
    onEvent: () => () => {},
  } as unknown as Bridge
  return { msk: new Msk(bridge, { public: false }), calls, st }
}

describe('files.uploadLarge', () => {
  it('sends a file in pieces, in order, and finishes it', async () => {
    const { msk, calls } = server()
    const seen: number[] = []
    const e = await msk.files.uploadLarge(new Blob(['0123456789']), 'big.bin', { parent: 'p1', chunk: 4, onProgress: (n) => seen.push(n) })
    expect(e.id).toBe('f1')
    expect(calls.map((c) => c.op)).toEqual(['files.upload.begin', 'files.upload.chunk', 'files.upload.chunk', 'files.upload.chunk', 'files.upload.finish'])
    expect(calls[0].args).toMatchObject({ name: 'big.bin', parent: 'p1', size: 10, replace: false })
    expect(calls.filter((c) => c.op === 'files.upload.chunk').map((c) => [c.args.offset, c.args.file.size])).toEqual([[0, 4], [4, 4], [8, 2]])
    expect(seen).toEqual([4, 8, 10])
  })

  it('does not send again a piece whose answer was lost: it asks where the upload is', async () => {
    const { msk, calls, st } = server({ lose: 1 })
    await msk.files.uploadLarge(new Blob(['0123456789']), 'big.bin', { chunk: 4 })
    expect(st.received).toBe(10)
    expect(calls.map((c) => c.op)).toContain('files.upload.status')
    // the lost piece (offset 0) was sent once
    expect(calls.filter((c) => c.op === 'files.upload.chunk' && c.args.offset === 0)).toHaveLength(1)
  })

  it('throws the upload away when it cannot go on', async () => {
    const { msk, st } = server({ failAfter: 1 })
    await expect(msk.files.uploadLarge(new Blob(['0123456789']), 'big.bin', { chunk: 4 })).rejects.toThrow('down')
    expect(st.aborted).toBe(true)
  })

  it('passes the source of the Files area', async () => {
    const { msk, calls } = server()
    await msk.files.uploadLarge(new Blob(['ab']), 'a.bin', { source: 'com.mosaikit.files' })
    expect(calls.every((c) => c.args.source === 'com.mosaikit.files')).toBe(true)
  })
})
