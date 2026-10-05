import log from 'electron-log'
import { BatchedLogQueue } from './logging/BatchedLogQueue'
import { app } from 'electron'
import os from 'os'
import store, { getCurrentUserId } from './store'
import { STORE_KEYS } from '../constants/store-keys'
import { interactionManager } from './interactions/InteractionManager'
import { getServerConfig } from './serverConfig'

const LOG_QUEUE_KEY = 'log_queue:events'

export function initializeLogging() {
  // Overriding console methods with electron-log
  Object.assign(console, log.functions)

  // Configure file transport for the packaged app
  if (app.isPackaged) {
    log.transports.file.level = 'info' // Log 'info' and higher (info, warn, error)
    log.transports.file.format =
      '[{y}-{m}-{d} {h}:{i}:{s}.{l}] [{processType}] [{level}] {text}'
  } else {
    log.transports.console.level = 'debug'
    log.transports.file.level = false
  }

  // Set up IPC transport to receive logs from the renderer process
  log.initialize()

  log.info('Logging initialized.')
  if (app.isPackaged) {
    log.info(`Log file is located at: ${log.transports.file.getFile().path}`)
  }

  // Add remote transport to batch-forward client logs to server
  type LogEvent = {
    ts: number
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'log'
    message: string
    fields?: Record<string, unknown>
    interactionId: string | null
    traceId?: string
    spanId?: string
    appVersion?: string
    platform?: string
    source?: string
    loggedAtIso: string
  }

  const initialEvents =
    (store.get(LOG_QUEUE_KEY) as LogEvent[] | undefined) ?? []
  const persistenceError = console.error.bind(console)
  const queue = new BatchedLogQueue<LogEvent>(
    initialEvents,
    events => store.set(LOG_QUEUE_KEY, events),
    error => persistenceError('Failed to persist log batch:', error),
  )
  let isSending = false
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  const flush = async () => {
    if (isSending || queue.length === 0) return
    isSending = true
    const take = Math.min(50, queue.length)
    const batch = queue.take(take)
    try {
      const { baseUrl, apiKey } = getServerConfig()
      if (!baseUrl || !apiKey) return

      const url = new URL('/logs', baseUrl)
      const body = {
        events: batch,
      }
      const token = (store.get(STORE_KEYS.ACCESS_TOKEN) as string | null) || ''
      const res = await fetch(url.toString(), {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
        headers: {
          'content-type': 'application/json',
          'x-ito-api-key': apiKey,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      })
      if (res.ok || res.status === 204) {
        // Remove sent items only on success
        queue.acknowledge(batch)
      }
    } catch {
      // Keep items in queue on failure; they remain persisted
    } finally {
      isSending = false
    }
  }

  const scheduleFlush = () => {
    if (flushTimer) return
    flushTimer = setTimeout(async () => {
      flushTimer = null
      await flush()
      if (queue.length > 0) {
        // If more remain, schedule another cycle
        scheduleFlush()
      }
    }, 2000)
  }

  const toEvent = (
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'log',
    message: string,
    fields?: Record<string, unknown>,
  ) => {
    const userId = getCurrentUserId()
    const interactionId = interactionManager.getCurrentInteractionId()
    const now = Date.now()
    const event: LogEvent = {
      ts: now,
      loggedAtIso: new Date(now).toISOString(),
      level,
      message,
      fields: {
        ...fields,
        userId,
        hostname: os.hostname(),
        platform: process.platform,
        arch: process.arch,
      },
      interactionId,
      appVersion: app.getVersion?.() ?? 'unknown',
      platform: `${process.platform}-${process.arch}`,
      source: 'client',
    }
    return event
  }

  // Wrap core log methods to enqueue events
  const originalInfo = console.info
  const originalWarn = console.warn
  const originalError = console.error
  const originalLog = console.log

  console.log = (...args: any[]) => {
    try {
      queue.append(toEvent('log', String(args[0] ?? ''), { args }))
      scheduleFlush()
    } catch (err) {
      originalError('Failed to enqueue log event (log):', err)
    }
    originalLog.apply(console, args as any)
  }
  console.info = (...args: any[]) => {
    try {
      queue.append(toEvent('info', String(args[0] ?? ''), { args }))
      scheduleFlush()
    } catch (err) {
      originalError('Failed to enqueue log event (info):', err)
    }
    originalInfo.apply(console, args as any)
  }
  console.warn = (...args: any[]) => {
    try {
      queue.append(toEvent('warn', String(args[0] ?? ''), { args }))
      scheduleFlush()
    } catch (err) {
      originalError('Failed to enqueue log event (warn):', err)
    }
    originalWarn.apply(console, args as any)
  }
  console.error = (...args: any[]) => {
    try {
      queue.append(toEvent('error', String(args[0] ?? ''), { args }))
      scheduleFlush()
    } catch (err) {
      originalError('Failed to enqueue log event (error):', err)
    }
    originalError.apply(console, args as any)
  }

  // Also wrap electron-log methods (log.info, log.warn, etc.) so direct calls are sent
  const levelMap: Record<string, 'debug' | 'info' | 'warn' | 'error'> = {
    verbose: 'debug',
    silly: 'debug',
    debug: 'debug',
    info: 'info',
    log: 'info',
    warn: 'warn',
    error: 'error',
  }
  ;(
    ['info', 'warn', 'error', 'debug', 'verbose', 'silly', 'log'] as const
  ).forEach(method => {
    const original = (log as any)[method]?.bind(log)
    if (typeof original !== 'function') return
    ;(log as any)[method] = (...args: any[]) => {
      try {
        const mapped = levelMap[method] || 'info'
        queue.append(toEvent(mapped as any, String(args[0] ?? ''), { args }))
        scheduleFlush()
      } catch (err) {
        originalError(`Failed to enqueue electron-log event (${method}):`, err)
      }
      return original(...args)
    }
  })

  // Best-effort flush when the app is quitting; durability is ensured by persistence
  app.on('before-quit', () => {
    queue.persistNow()
    void flush()
  })

  // If there are persisted events on startup, schedule an initial flush
  if (queue.length > 0) {
    scheduleFlush()
  }
}
