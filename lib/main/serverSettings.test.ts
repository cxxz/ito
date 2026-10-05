import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { Code, ConnectError } from '@connectrpc/connect'

const readSettings = mock(async () => ({}))
const closeTestSession = mock()
const saved = {
  baseUrl: 'https://saved.ito.test',
  hasApiKey: true,
  usingDefaults: false,
}
const saveConfig = mock(async () => saved)
const resetConfig = mock(async () => ({ ...saved, usingDefaults: true }))
const pauseRequests = mock()
const resumeRequests = mock()
const invalidateConnection = mock()

mock.module('@connectrpc/connect', () => ({
  Code,
  ConnectError,
  createClient: () => ({ getAdvancedSettings: readSettings }),
}))
mock.module('@connectrpc/connect-node', () => ({
  createConnectTransport: mock(),
  Http2SessionManager: class {
    abort = closeTestSession
  },
}))
mock.module('../clients/grpcClient', () => ({
  grpcClient: { pauseRequests, resumeRequests, invalidateConnection },
}))
mock.module('./syncService', () => ({
  syncService: {
    withSyncPaused: async (operation: () => Promise<unknown>) => operation(),
  },
}))
mock.module('./serverConfig', () => ({
  saveServerConnection: saveConfig,
  resetServerConnection: resetConfig,
  resolveServerConnection: (input: { baseUrl: string; apiKey: string }) =>
    input,
}))

const { testServerConnection, updateServerSettings } = await import(
  './serverSettings'
)
const input = { baseUrl: 'https://saved.ito.test', apiKey: 'test-key' }

beforeEach(() => {
  for (const fn of [
    readSettings,
    closeTestSession,
    saveConfig,
    resetConfig,
    pauseRequests,
    resumeRequests,
    invalidateConnection,
  ])
    fn.mockClear()
})

describe('runtime server settings', () => {
  test('tests authentication without saving or resetting the active connection', async () => {
    expect(await testServerConnection(input)).toEqual({
      success: true,
      data: null,
    })
    expect(readSettings).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: { 'x-ito-api-key': 'test-key' },
        timeoutMs: 5_000,
      }),
    )
    expect(saveConfig).not.toHaveBeenCalled()
    expect(invalidateConnection).not.toHaveBeenCalled()
    expect(closeTestSession).toHaveBeenCalledTimes(1)
  })

  test('reports rejected credentials and closes the temporary session', async () => {
    readSettings.mockRejectedValueOnce(
      new ConnectError('unauthenticated', Code.Unauthenticated),
    )
    expect(await testServerConnection(input)).toEqual({
      success: false,
      error: 'The server rejected the API key.',
    })
    expect(saveConfig).not.toHaveBeenCalled()
    expect(closeTestSession).toHaveBeenCalledTimes(1)
  })

  test('refreshes the connection only after a successful save', async () => {
    expect(await updateServerSettings(input)).toEqual({
      success: true,
      data: saved,
    })
    expect(pauseRequests).toHaveBeenCalledTimes(1)
    expect(saveConfig).toHaveBeenCalledWith(input)
    expect(invalidateConnection).toHaveBeenCalledTimes(1)
    expect(resumeRequests).toHaveBeenCalledTimes(1)
  })

  test('does not interrupt active dictation to change credentials', async () => {
    pauseRequests.mockImplementationOnce(() => {
      throw new Error('Wait for dictation to finish.')
    })
    expect(await updateServerSettings(input)).toEqual({
      success: false,
      error: 'Wait for dictation to finish.',
    })
    expect(saveConfig).not.toHaveBeenCalled()
    expect(invalidateConnection).not.toHaveBeenCalled()
  })

  test('resumes requests using the old connection if saving fails', async () => {
    saveConfig.mockRejectedValueOnce(new Error('Storage unavailable'))
    expect(await updateServerSettings(input)).toEqual({
      success: false,
      error: 'Storage unavailable',
    })
    expect(invalidateConnection).not.toHaveBeenCalled()
    expect(resumeRequests).toHaveBeenCalledTimes(1)
  })

  test('restoring defaults refreshes the connection', async () => {
    const result = await updateServerSettings(null)
    expect(result.success).toBe(true)
    expect(resetConfig).toHaveBeenCalledTimes(1)
    expect(invalidateConnection).toHaveBeenCalledTimes(1)
  })
})
