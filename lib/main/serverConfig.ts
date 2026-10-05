import { safeStorage } from 'electron'
import { KeyValueStore } from './sqlite/repo'
import type {
  ServerConnectionInput,
  ServerConnectionSettings,
} from '../types/serverConnection'

interface ServerConfig {
  baseUrl: string
  apiKey: string
}

// Separate from the general settings store: credentials must not be broadcast
// to other windows, included in settings analytics, or synced to a server.
const STORAGE_KEY = 'serverConnection'
let savedConfig: ServerConfig | undefined

export function getServerConfig(): ServerConfig {
  return (
    savedConfig ?? {
      baseUrl: import.meta.env.VITE_ITO_API_BASE_URL?.trim() ?? '',
      apiKey: import.meta.env.VITE_ITO_API_KEY?.trim() ?? '',
    }
  )
}

export function getServerConnectionSettings(): ServerConnectionSettings {
  const config = getServerConfig()
  return {
    baseUrl: config.baseUrl,
    hasApiKey: Boolean(config.apiKey),
    usingDefaults: savedConfig === undefined,
  }
}

function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Enter a server URL.')
  }
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('Enter a valid server URL, including http:// or https://.')
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    throw new Error('The server URL must start with http:// or https://.')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      'Use a server URL without credentials, query parameters, or a fragment.',
    )
  }
  return url.href.replace(/\/+$/, '')
}

export function resolveServerConnection(
  input: ServerConnectionInput,
): ServerConfig {
  const baseUrl = normalizeBaseUrl(input?.baseUrl)
  if (input.apiKey !== undefined && typeof input.apiKey !== 'string') {
    throw new Error('Enter a valid API key.')
  }
  const current = getServerConfig()
  // Never reuse the previous server's credential at a different URL.
  let sameServer = false
  try {
    sameServer = baseUrl === normalizeBaseUrl(current.baseUrl)
  } catch {
    // No valid current endpoint means there is no credential to retain.
  }
  const apiKey = input.apiKey?.trim() || (sameServer ? current.apiKey : '')
  if (!apiKey) {
    throw new Error(
      sameServer
        ? 'Enter an API key.'
        : 'Enter an API key for this server URL.',
    )
  }
  if (/[^\x20-\x7e]/.test(apiKey)) {
    throw new Error(
      'The API key must contain only printable characters on one line.',
    )
  }
  return { baseUrl, apiKey }
}

export function requireServerConfig(): ServerConfig {
  const config = getServerConfig()
  if (!config.baseUrl || !config.apiKey) {
    throw new Error('Set your server URL and API key in Settings → Server.')
  }
  return resolveServerConnection(config)
}

export function isServerConfigured(): boolean {
  try {
    requireServerConfig()
    return true
  } catch {
    return false
  }
}

export async function initializeServerConfig(): Promise<void> {
  savedConfig = undefined
  const stored = await KeyValueStore.get(STORAGE_KEY)
  if (!stored) return
  try {
    const parsed = JSON.parse(stored)
    const baseUrl = normalizeBaseUrl(parsed.baseUrl)
    // Retain the selected server if its key cannot be decrypted.
    savedConfig = { baseUrl, apiKey: '' }
    savedConfig.apiKey = safeStorage.decryptString(
      Buffer.from(parsed.encryptedApiKey, 'base64'),
    )
  } catch {
    console.warn(
      'Unable to read saved server settings. Configure the connection in Settings → Server.',
    )
  }
}

export async function saveServerConnection(
  input: ServerConnectionInput,
): Promise<ServerConnectionSettings> {
  const config = resolveServerConnection(input)
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'Secure credential storage is unavailable. Restart Ito and try again.',
    )
  }
  const encryptedApiKey = safeStorage
    .encryptString(config.apiKey)
    .toString('base64')
  await KeyValueStore.set(
    STORAGE_KEY,
    JSON.stringify({ baseUrl: config.baseUrl, encryptedApiKey }),
  )
  savedConfig = config
  return getServerConnectionSettings()
}

export async function resetServerConnection(): Promise<ServerConnectionSettings> {
  // An empty record removes the override without changing environment defaults.
  await KeyValueStore.set(STORAGE_KEY, '')
  savedConfig = undefined
  return getServerConnectionSettings()
}
