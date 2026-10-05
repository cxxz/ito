import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { install } from '@sinonjs/fake-timers'

let status: number
let body: string
let respond: boolean
let session: EventEmitter & {
  request: ReturnType<typeof mock>
  destroy: ReturnType<typeof mock>
}
let request: EventEmitter & {
  setEncoding: ReturnType<typeof mock>
  end: ReturnType<typeof mock>
}
const mockConnect = mock(() => session)

mock.module('node:http2', () => ({ connect: mockConnect }))
const { checkServerHealth } = await import('./serverHealth')

const originalUrl = process.env.VITE_ITO_API_BASE_URL
beforeEach(() => {
  process.env.VITE_ITO_API_BASE_URL = 'https://cloud.ito.test:8443/ito/'
  status = 200
  body = 'Welcome to the Ito Connect RPC server (self-hosted)!'
  respond = true
  mockConnect.mockClear()
  request = Object.assign(new EventEmitter(), {
    setEncoding: mock(),
    end: mock(() => {
      if (!respond) return
      queueMicrotask(() => {
        request.emit('response', { ':status': status })
        request.emit('data', body)
        request.emit('end')
      })
    }),
  })
  session = Object.assign(new EventEmitter(), {
    request: mock(() => request),
    destroy: mock(),
  })
})

afterEach(() => {
  if (originalUrl === undefined) delete process.env.VITE_ITO_API_BASE_URL
  else process.env.VITE_ITO_API_BASE_URL = originalUrl
})

describe('configured server health check', () => {
  test('uses the remote HTTPS origin, port, and base path', async () => {
    expect(await checkServerHealth()).toEqual({
      isHealthy: true,
      error: undefined,
    })
    expect(mockConnect).toHaveBeenCalledWith('https://cloud.ito.test:8443')
    expect(session.request).toHaveBeenCalledWith({
      ':method': 'GET',
      ':path': '/ito/',
    })
    expect(session.destroy).toHaveBeenCalledTimes(1)
  })

  test('supports a direct cleartext HTTP/2 server', async () => {
    process.env.VITE_ITO_API_BASE_URL = 'http://localhost:13003'
    expect((await checkServerHealth()).isHealthy).toBe(true)
    expect(mockConnect).toHaveBeenCalledWith('http://localhost:13003')
    expect(session.request).toHaveBeenCalledWith({
      ':method': 'GET',
      ':path': '/',
    })
  })

  test('does not mistake a proxy error for a healthy server', async () => {
    status = 502
    expect(await checkServerHealth()).toEqual({
      isHealthy: false,
      error: 'Server responded with status: 502',
    })
  })

  test('rejects a successful response from a different service', async () => {
    body = 'Some other application'
    expect(await checkServerHealth()).toEqual({
      isHealthy: false,
      error: 'Invalid server response',
    })
  })

  test('reports connection failures and closes the session', async () => {
    respond = false
    const result = checkServerHealth()
    session.emit('error', new Error('ECONNREFUSED'))
    expect(await result).toEqual({
      isHealthy: false,
      error: 'Unable to reach the Ito server',
    })
    expect(session.destroy).toHaveBeenCalledTimes(1)
  })

  test('times out stalled connections and closes the session', async () => {
    const clock = install({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      respond = false
      const result = checkServerHealth()
      await clock.tickAsync(5_000)
      expect(await result).toEqual({
        isHealthy: false,
        error: 'Connection timed out',
      })
      expect(session.destroy).toHaveBeenCalledTimes(1)
    } finally {
      clock.uninstall()
    }
  })

  test('requires the API URL instead of falling back to localhost', async () => {
    delete process.env.VITE_ITO_API_BASE_URL
    expect(await checkServerHealth()).toEqual({
      isHealthy: false,
      error: 'Set a server URL in Settings → Server.',
    })
    expect(mockConnect).not.toHaveBeenCalled()
  })
})
