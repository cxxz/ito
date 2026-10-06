import { execFile } from 'child_process'
import os from 'os'

// Serialize volume changes so a delayed mute cannot run after restoration.
let pending: Promise<unknown> = Promise.resolve()
let previous: { volume: number; muted: boolean } | null = null

function runScript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'osascript',
      ['-e', script],
      { timeout: 1000, encoding: 'utf8' },
      (error, stdout) => (error ? reject(error) : resolve(stdout.trim())),
    )
  })
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation)
  pending = result.catch(() => {})
  return result
}

export function muteSystemAudio(): Promise<boolean> {
  return serialize(async () => {
    if (os.platform() !== 'darwin') return false
    if (previous) return true
    try {
      const result = await runScript(`
        set settings to get volume settings
        set oldVolume to output volume of settings
        set oldMuted to output muted of settings
        return (oldVolume as text) & "," & (oldMuted as text)
      `)
      const [volume, muted] = result.split(',')
      if (
        !Number.isFinite(Number(volume)) ||
        !['true', 'false'].includes(muted)
      )
        throw new Error('Invalid system volume response')
      previous = { volume: Number(volume), muted: muted === 'true' }
      await runScript('set volume with output muted')
      return true
    } catch (error) {
      console.error('Failed to mute system audio:', error)
      return false
    }
  })
}

export function unmuteSystemAudio(): Promise<boolean> {
  return serialize(async () => {
    if (os.platform() !== 'darwin' || !previous) return false
    const snapshot = previous
    try {
      // Preserve changes the user made during dictation, including volume changes.
      await runScript(`
        set settings to get volume settings
        if (output muted of settings) and (output volume of settings = ${snapshot.volume}) then
          set volume ${snapshot.muted ? 'with' : 'without'} output muted
        end if
      `)
      previous = null
      return true
    } catch (error) {
      console.error('Failed to restore system audio:', error)
      return false
    }
  })
}
