import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  findNewerNativeSource,
  resetNativeStalenessChecks,
  warnIfNativeBinaryStale,
} from './native-staleness'

const BUILT_AT = new Date('2026-02-02T00:00:00Z')
const BEFORE_BUILD = new Date('2026-01-01T00:00:00Z')
const AFTER_BUILD = new Date('2026-10-06T00:00:00Z')

let root: string
let moduleDir: string
let binaryPath: string

const writeFile = (path: string, mtime: Date) => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, '')
  utimesSync(path, mtime, mtime)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ito-native-'))
  moduleDir = join(root, 'audio-recorder')
  binaryPath = join(root, 'target', 'audio-recorder.exe')
  writeFile(binaryPath, BUILT_AT)
  writeFile(join(moduleDir, 'Cargo.toml'), BEFORE_BUILD)
  writeFile(join(moduleDir, 'src', 'main.rs'), BEFORE_BUILD)
  resetNativeStalenessChecks()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('findNewerNativeSource', () => {
  test('returns null when the binary is newer than its source', () => {
    expect(findNewerNativeSource(binaryPath, moduleDir)).toBeNull()
  })

  test('returns the newest source file changed after the build', () => {
    const changed = join(moduleDir, 'src', 'nested', 'queue.rs')
    writeFile(changed, AFTER_BUILD)
    writeFile(join(moduleDir, 'build.rs'), new Date('2026-05-01T00:00:00Z'))

    expect(findNewerNativeSource(binaryPath, moduleDir)).toEqual({
      path: changed,
      mtimeMs: AFTER_BUILD.getTime(),
    })
  })

  test('ignores files that do not trigger a rebuild', () => {
    writeFile(join(moduleDir, 'Cargo.lock'), AFTER_BUILD)
    writeFile(join(moduleDir, 'audio-recorder.manifest'), AFTER_BUILD)

    expect(findNewerNativeSource(binaryPath, moduleDir)).toBeNull()
  })

  test('returns null when the binary has not been built', () => {
    writeFile(join(moduleDir, 'src', 'main.rs'), AFTER_BUILD)
    rmSync(binaryPath)

    expect(findNewerNativeSource(binaryPath, moduleDir)).toBeNull()
  })
})

describe('warnIfNativeBinaryStale', () => {
  test('warns once per module with rebuild instructions', () => {
    const warn = mock()
    console.warn = warn
    writeFile(join(moduleDir, 'src', 'main.rs'), AFTER_BUILD)

    warnIfNativeBinaryStale('audio-recorder', binaryPath, moduleDir)
    warnIfNativeBinaryStale('audio-recorder', binaryPath, moduleDir)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain(
      'audio-recorder binary is older than its source',
    )
    expect(warn.mock.calls[0][0]).toContain('bun dev:rust')
  })

  test('stays quiet when the binary is up to date', () => {
    const warn = mock()
    console.warn = warn

    warnIfNativeBinaryStale('audio-recorder', binaryPath, moduleDir)

    expect(warn).not.toHaveBeenCalled()
  })
})
