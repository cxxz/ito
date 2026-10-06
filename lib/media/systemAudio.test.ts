import { expect, mock, test } from 'bun:test'

const calls: Array<{
  script: string
  finish: (error: Error | null, stdout: string) => void
}> = []
mock.module('os', () => ({ default: { platform: () => 'darwin' } }))
mock.module('child_process', () => ({
  execFile: (_file: string, args: string[], options: any, finish: any) => {
    expect(options.timeout).toBe(1000)
    calls.push({ script: args[1], finish })
  },
}))
const { muteSystemAudio, unmuteSystemAudio } = await import('./systemAudio')
const tick = () => new Promise(resolve => setImmediate(resolve))

test('mute and restore are asynchronous, serialized, and preserve original mute state', async () => {
  const mute = muteSystemAudio()
  const restore = unmuteSystemAudio()
  await tick()
  expect(calls).toHaveLength(1)
  calls[0].finish(null, '42,true')
  await tick()
  expect(calls[1].script).toBe('set volume with output muted')
  calls[1].finish(null, '')
  expect(await mute).toBe(true)
  await tick()
  expect(calls[2].script).toContain('output volume of settings = 42')
  expect(calls[2].script).toContain('set volume with output muted')
  calls[2].finish(null, '')
  expect(await restore).toBe(true)
})

test('a failed mute still retains the snapshot for restoration', async () => {
  calls.length = 0
  const mute = muteSystemAudio()
  await tick()
  calls[0].finish(null, '50,false')
  await tick()
  calls[1].finish(new Error('timeout'), '')
  expect(await mute).toBe(false)
  const restore = unmuteSystemAudio()
  await tick()
  expect(calls[2].script).toContain('set volume without output muted')
  calls[2].finish(null, '')
  expect(await restore).toBe(true)
})
