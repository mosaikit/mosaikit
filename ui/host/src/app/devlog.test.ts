import { afterEach, describe, expect, it } from 'vitest'
import { clearCalls, getCalls, setRecording, timed } from './devlog.ts'

describe('developer tools: host call log', () => {
  afterEach(() => {
    setRecording(false)
    clearCalls()
  })

  it('records nothing and runs the call as it is while the developer profile is off', async () => {
    expect(await timed('com.example.x', 'crud.list', async () => 42)).toBe(42)
    await expect(timed('com.example.x', 'crud.get', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(getCalls()).toEqual([])
  })

  it('times the calls and keeps the errors while it is on', async () => {
    setRecording(true)
    expect(await timed('com.example.x', 'crud.list', async () => 1)).toBe(1)
    await expect(timed('com.example.x', 'crud.get', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    const [err, ok] = getCalls()
    expect(ok).toMatchObject({ plugin: 'com.example.x', op: 'crud.list', ok: true })
    expect(ok.ms).toBeGreaterThanOrEqual(0)
    expect(err).toMatchObject({ op: 'crud.get', ok: false, error: 'boom' })
  })

  it('keeps the last 200 calls, the newest first', async () => {
    setRecording(true)
    for (let i = 0; i < 205; i++) await timed('p', `op${i}`, async () => i)
    expect(getCalls()).toHaveLength(200)
    expect(getCalls()[0].op).toBe('op204')
  })
})
