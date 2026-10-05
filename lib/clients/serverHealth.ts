import { connect, ClientHttp2Session, ClientHttp2Stream } from 'node:http2'
import type { HealthCheckResult } from '../../app/utils/healthCheck'
import { getServerConfig } from '../main/serverConfig'

// Use HTTP/2 for both the direct h2c server and an HTTPS reverse proxy.
export function checkServerHealth(): Promise<HealthCheckResult> {
  return new Promise(resolve => {
    let session: ClientHttp2Session | undefined
    let request: ClientHttp2Stream | undefined
    let finished = false

    const finish = (result: HealthCheckResult) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      session?.destroy()
      resolve(result)
    }
    const timeout = setTimeout(
      () => finish({ isHealthy: false, error: 'Connection timed out' }),
      5_000,
    )

    try {
      const { baseUrl } = getServerConfig()
      if (!baseUrl) {
        finish({
          isHealthy: false,
          error: 'Set a server URL in Settings → Server.',
        })
        return
      }

      const url = new URL(baseUrl)
      session = connect(url.origin)
      session.on('error', () =>
        finish({ isHealthy: false, error: 'Unable to reach the Ito server' }),
      )
      request = session.request({
        ':method': 'GET',
        ':path': url.pathname + url.search,
      })

      let status: number | undefined
      let body = ''
      request.setEncoding('utf8')
      request.on('response', headers => {
        status = headers[':status']
      })
      request.on('data', (chunk: string) => {
        body += chunk
      })
      request.on('error', () =>
        finish({ isHealthy: false, error: 'Unable to reach the Ito server' }),
      )
      request.on('end', () => {
        if (status === undefined || status < 200 || status >= 300) {
          finish({
            isHealthy: false,
            error: `Server responded with status: ${status ?? 'unknown'}`,
          })
          return
        }
        const isHealthy = body.includes('Welcome to the Ito Connect RPC server')
        finish({
          isHealthy,
          error: isHealthy ? undefined : 'Invalid server response',
        })
      })
      request.on('close', () =>
        finish({ isHealthy: false, error: 'Server connection closed' }),
      )
      request.end()
    } catch (error) {
      finish({
        isHealthy: false,
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
      })
    }
  })
}
