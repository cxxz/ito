import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Exercise failure/retry behavior without accessing Apple, the Keychain, or disks.
describe.skipIf(process.platform !== 'darwin')(
  'macOS notarization script',
  () => {
    let dir: string
    let dmg: string
    const script = join(import.meta.dir, 'create_dist_dmg.sh')
    const mock = `#!/bin/bash
set -eu
command_name=$(basename "$0")
printf '%s %s\\n' "$command_name" "$*" >> "$MOCK_DIR/calls"
case "$command_name" in
  security) echo '1) 0123456789ABCDEF0123456789ABCDEF01234567 "Developer ID Application: Test (TESTTEAM)"' ;;
  codesign)
    [ "\${BAD_SIGNATURE:-0}" != 1 ] || exit 1
    echo 'Authority=Developer ID Application: Test (TESTTEAM)' >&2 ;;
  hdiutil)
    if [ "$1" = attach ]; then
      while [ "$1" != -mountpoint ]; do shift; done
      mkdir -p "$2/Ito.app"
      ln -s /Applications "$2/Applications"
    fi ;;
  spctl) exit 0 ;;
  xcrun)
    [ "$1" != --find ] || exit 0
    if [ "$1" = stapler ]; then
      case "$2" in
        validate) [ -f "$MOCK_DIR/stapled" ] ;;
        staple) touch "$MOCK_DIR/stapled" ;;
      esac
    else
      case "$2" in
        history) [ "\${PREFLIGHT_FAIL:-0}" != 1 ] ;;
        submit) echo '{"id":"test-submission"}' ;;
        wait)
          case "\${NOTARY_STATUS:-Accepted}" in
            timeout) exit 1 ;;
            Invalid) echo '{"status":"Invalid"}'; exit 1 ;;
            *) echo '{"status":"Accepted"}' ;;
          esac ;;
        log) echo '{"issues":["test rejection"]}' > "\${@: -1}" ;;
      esac
    fi ;;
esac
`

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'ito-notary-test-'))
      dmg = join(dir, 'Ito test.dmg')
      writeFileSync(dmg, 'fake signed disk image')
      for (const command of [
        'security',
        'codesign',
        'hdiutil',
        'spctl',
        'xcrun',
      ]) {
        writeFileSync(join(dir, command), mock, { mode: 0o755 })
      }
    })

    afterEach(() => rmSync(dir, { recursive: true, force: true }))

    function run(env: Record<string, string> = {}) {
      return spawnSync('bash', [script, '--notarize-dmg', dmg], {
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          APPLE_SIGNING_IDENTITY: '',
          NOTARY_PROFILE: 'test-profile',
          MOCK_DIR: dir,
          ...env,
        },
        encoding: 'utf8',
      })
    }

    const calls = () => readFileSync(join(dir, 'calls'), 'utf8')

    test('submits, staples, and assesses both the DMG and enclosed app', () => {
      const result = run()
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Signed, notarized, stapled and verified')
      expect(calls()).toContain('stapler staple')
      expect(calls()).toContain(
        '--type open --context context:primary-signature',
      )
      expect(calls()).toContain('--type execute')
    })

    test('preflight failure stops before uploading', () => {
      const result = run({ PREFLIGHT_FAIL: '1' })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('preflight failed')
      expect(calls()).not.toContain('notarytool submit')
    })

    test('invalid signature stops before uploading', () => {
      expect(run({ BAD_SIGNATURE: '1' }).status).not.toBe(0)
      expect(calls()).not.toContain('notarytool submit')
    })

    test('resumes a timed-out submission without uploading twice', () => {
      expect(run({ NOTARY_STATUS: 'timeout' }).status).not.toBe(0)
      expect(calls()).not.toContain('stapler staple')
      expect(run().status).toBe(0)
      expect(calls().match(/notarytool submit/g)).toHaveLength(1)
      expect(calls().match(/notarytool wait test-submission/g)).toHaveLength(2)
    })

    test('fetches rejection details even when wait exits unsuccessfully', () => {
      const result = run({ NOTARY_STATUS: 'Invalid' })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('Apple returned Invalid')
      expect(readFileSync(`${dmg}.notary-log.json`, 'utf8')).toContain('issues')
      expect(calls()).not.toContain('stapler staple')
    })

    test('refuses to reuse a receipt after the DMG changes', () => {
      expect(run({ NOTARY_STATUS: 'timeout' }).status).not.toBe(0)
      writeFileSync(dmg, 'changed image')
      const result = run()
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('DMG changed since submission')
      expect(calls().match(/notarytool submit/g)).toHaveLength(1)
    })

    test('does not submit again when an interrupted upload left a partial receipt', () => {
      writeFileSync(`${dmg}.notary-submission.json`, '')
      const result = run()
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('Incomplete submission receipt')
      expect(calls()).not.toContain('notarytool submit')
    })
  },
)
