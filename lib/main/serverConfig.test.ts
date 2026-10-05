import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test'
import { safeStorage } from 'electron'

const records = new Map<string, string>()
const setRecord = mock(async (key: string, value: string) => {
  records.set(key, value)
})
mock.module('./sqlite/repo', () => ({
  KeyValueStore: {
    get: async (key: string) => records.get(key),
    set: setRecord,
  },
}))
const {
  getServerConfig,
  getServerConnectionSettings,
  initializeServerConfig,
  isServerConfigured,
  requireServerConfig,
  resetServerConnection,
  resolveServerConnection,
  saveServerConnection,
} = await import('./serverConfig')

beforeEach(async () => {
  records.clear()
  setRecord.mockReset()
  setRecord.mockImplementation(async (key, value) => {
    records.set(key, value)
  })
  process.env.VITE_ITO_API_BASE_URL = 'https://default.ito.test'
  process.env.VITE_ITO_API_KEY = 'default-key'
  await initializeServerConfig()
})

afterEach(() => {
  mock.restore()
})

describe('server configuration', () => {
  test('uses environment defaults without exposing the key to Settings', () => {
    expect(requireServerConfig()).toEqual({
      baseUrl: 'https://default.ito.test',
      apiKey: 'default-key',
    })
    expect(getServerConnectionSettings()).toEqual({
      baseUrl: 'https://default.ito.test',
      hasApiKey: true,
      usingDefaults: true,
    })
  })

  test('allows an unconfigured app to open Settings', () => {
    delete process.env.VITE_ITO_API_BASE_URL
    delete process.env.VITE_ITO_API_KEY
    expect(getServerConnectionSettings()).toEqual({
      baseUrl: '',
      hasApiKey: false,
      usingDefaults: true,
    })
    expect(isServerConfigured()).toBe(false)
    expect(requireServerConfig).toThrow('Settings → Server')
  })

  test('persists an encrypted override and reloads it instead of build defaults', async () => {
    const result = await saveServerConnection({
      baseUrl: ' https://saved.ito.test:8443/ ',
      apiKey: 'saved-key',
    })
    expect(result).toEqual({
      baseUrl: 'https://saved.ito.test:8443',
      hasApiKey: true,
      usingDefaults: false,
    })
    const record = records.get('serverConnection')!
    expect(record).not.toContain('saved-key')
    expect(JSON.parse(record)).not.toHaveProperty('apiKey')
    await initializeServerConfig()
    expect(getServerConfig()).toEqual({
      baseUrl: 'https://saved.ito.test:8443',
      apiKey: 'saved-key',
    })
  })

  test('retains a key for the same URL but never forwards it to a new server', async () => {
    await saveServerConnection({
      baseUrl: 'https://default.ito.test/',
      apiKey: '',
    })
    expect(getServerConfig().apiKey).toBe('default-key')
    expect(() =>
      resolveServerConnection({ baseUrl: 'https://different.ito.test' }),
    ).toThrow('Enter an API key for this server URL.')
    expect(getServerConfig().baseUrl).toBe('https://default.ito.test')
  })

  test('replaces the key without changing the URL', async () => {
    await saveServerConnection({
      baseUrl: 'https://default.ito.test',
      apiKey: 'replacement-key',
    })
    expect(getServerConfig().apiKey).toBe('replacement-key')
  })

  test.each([
    'ftp://ito.test',
    'https://user:secret@ito.test',
    'https://ito.test?key=secret',
    'https://ito.test#fragment',
    'not a URL',
  ])('rejects an invalid endpoint: %s', async baseUrl => {
    await expect(
      saveServerConnection({ baseUrl, apiKey: 'test-key' }),
    ).rejects.toThrow()
    expect(setRecord).not.toHaveBeenCalled()
  })

  test('rejects header injection in API keys', () => {
    expect(() =>
      resolveServerConnection({
        baseUrl: 'https://ito.test',
        apiKey: 'key\r\nx-other: value',
      }),
    ).toThrow('one line')
  })

  test('leaves the active configuration unchanged if persistence fails', async () => {
    setRecord.mockRejectedValueOnce(new Error('Disk write failed'))
    await expect(
      saveServerConnection({
        baseUrl: 'https://new.ito.test',
        apiKey: 'new-key',
      }),
    ).rejects.toThrow('Disk write failed')
    expect(getServerConfig().baseUrl).toBe('https://default.ito.test')
  })

  test('does not persist plaintext when secure storage is unavailable', async () => {
    spyOn(safeStorage, 'isEncryptionAvailable').mockReturnValue(false)
    await expect(
      saveServerConnection({
        baseUrl: 'https://ito.test',
        apiKey: 'secret-key',
      }),
    ).rejects.toThrow('Secure credential storage is unavailable')
    expect(setRecord).not.toHaveBeenCalled()
  })

  test('keeps the saved URL when a saved key cannot be decrypted', async () => {
    await saveServerConnection({
      baseUrl: 'https://saved.ito.test',
      apiKey: 'saved-key',
    })
    spyOn(safeStorage, 'decryptString').mockImplementation(() => {
      throw new Error('Unavailable')
    })
    await initializeServerConfig()
    expect(getServerConfig()).toEqual({
      baseUrl: 'https://saved.ito.test',
      apiKey: '',
    })
    expect(isServerConfigured()).toBe(false)
  })

  test('restores environment defaults and removes the persisted override', async () => {
    await saveServerConnection({
      baseUrl: 'https://saved.ito.test',
      apiKey: 'saved-key',
    })
    await resetServerConnection()
    await initializeServerConfig()
    expect(getServerConnectionSettings().usingDefaults).toBe(true)
    expect(getServerConfig()).toEqual({
      baseUrl: 'https://default.ito.test',
      apiKey: 'default-key',
    })
  })
})
