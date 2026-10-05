import { create } from '@bufbuild/protobuf'
import { Code, ConnectError, createClient } from '@connectrpc/connect'
import {
  createConnectTransport,
  Http2SessionManager,
} from '@connectrpc/connect-node'
import {
  ItoService,
  GetAdvancedSettingsRequestSchema,
} from '@/app/generated/ito_pb'
import { grpcClient } from '../clients/grpcClient'
import { syncService } from './syncService'
import {
  resetServerConnection,
  resolveServerConnection,
  saveServerConnection,
} from './serverConfig'
import type {
  ServerConnectionInput,
  ServerConnectionSettings,
} from '../types/serverConnection'
import type { IpcResult } from '../types/ipc'

export async function updateServerSettings(
  input: ServerConnectionInput | null,
): Promise<IpcResult<ServerConnectionSettings>> {
  try {
    return await syncService.withSyncPaused(async () => {
      grpcClient.pauseRequests()
      try {
        const data =
          input === null
            ? await resetServerConnection()
            : await saveServerConnection(input)
        grpcClient.invalidateConnection()
        return { success: true, data }
      } finally {
        grpcClient.resumeRequests()
      }
    })
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Unable to save server settings.',
    }
  }
}

// A separate, read-only RPC verifies both the URL and key without saving them
// or disturbing dictation and background sync on the active connection.
export async function testServerConnection(
  input: ServerConnectionInput,
): Promise<IpcResult<null>> {
  let sessionManager: Http2SessionManager | undefined
  try {
    const { baseUrl, apiKey } = resolveServerConnection(input)
    sessionManager = new Http2SessionManager(baseUrl)
    const transport = createConnectTransport({
      baseUrl,
      httpVersion: '2',
      sessionManager,
    })
    const client = createClient(ItoService, transport)
    await client.getAdvancedSettings(create(GetAdvancedSettingsRequestSchema), {
      headers: { 'x-ito-api-key': apiKey },
      timeoutMs: 5_000,
    })
    return { success: true, data: null }
  } catch (error) {
    if (error instanceof ConnectError) {
      const message =
        error.code === Code.Unauthenticated ||
        error.code === Code.PermissionDenied
          ? 'The server rejected the API key.'
          : error.code === Code.DeadlineExceeded
            ? 'Connection timed out. Check the server URL and try again.'
            : 'Could not connect to the Ito server. Check the URL, certificate, and network connection.'
      return { success: false, error: message }
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Unable to test the connection.',
    }
  } finally {
    sessionManager?.abort()
  }
}
