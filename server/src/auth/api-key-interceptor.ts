import type { Interceptor } from '@connectrpc/connect'
import { ConnectError, Code } from '@connectrpc/connect'

const API_KEY_HEADER = 'x-ito-api-key'

const getRequiredApiKey = (): string => {
  const apiKey = process.env.ITO_API_KEY
  if (!apiKey) {
    throw new Error('ITO_API_KEY is required to start the server')
  }
  return apiKey
}

export const createApiKeyInterceptor = (): Interceptor => {
  const requiredApiKey = getRequiredApiKey()

  return next => async req => {
    const providedKey = req.header.get(API_KEY_HEADER)
    if (!providedKey || providedKey !== requiredApiKey) {
      throw new ConnectError('Invalid or missing API key', Code.Unauthenticated)
    }
    return await next(req)
  }
}
