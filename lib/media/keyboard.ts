import { spawn } from 'child_process'
import store, { KeyboardShortcutConfig } from '../main/store'
import { STORE_KEYS } from '../constants/store-keys'
import { getNativeBinaryPath } from './native-interface'
import { BrowserWindow } from 'electron'
import { itoSessionManager } from '../main/itoSessionManager'
import { KeyName, keyNameMap, normalizeLegacyKey } from '../types/keyboard'
import { DoubleTapDetector } from './DoubleTapDetector'
import { recordingStateNotifier } from '../main/recordingStateNotifier'

interface KeyEvent {
  type: 'keydown' | 'keyup'
  key: string
  timestamp: string
  raw_code: number | null
  monotonic_ms?: number
}

interface HeartbeatEvent {
  type: 'heartbeat_ping'
  id: string
  timestamp: string
}

interface RegisteredHotkeysEvent {
  type: 'registered_hotkeys'
  hotkeys: Array<{ keys: string[] }>
}

interface BlockedKeysEvent {
  type: 'blocked_keys'
  keys: string[]
}

type ProcessEvent =
  | KeyEvent
  | HeartbeatEvent
  | RegisteredHotkeysEvent
  | BlockedKeysEvent
  | { type: 'shortcut-interrupted' }

// Global key listener process singleton
export let KeyListenerProcess: ReturnType<typeof spawn> | null = null
let activeShortcutId: string | null = null
let lastKeyEventReceived = Date.now()
let restartTimer: NodeJS.Timeout | null = null
let latchedShortcut: KeyboardShortcutConfig | null = null
let pendingSessionStart: Promise<unknown> | null = null
let sessionCompleting = false
let stopAfterStart = false
let sessionGeneration = 0
let recordingStoppedSubscribed = false
const tapDetectors = new Map<string, DoubleTapDetector>()

function resetRecordingState() {
  activeShortcutId = null
  latchedShortcut = null
  tapDetectors.clear()
  sessionGeneration++
}

function completeShortcutSession() {
  activeShortcutId = null
  latchedShortcut = null
  tapDetectors.clear()
  if (pendingSessionStart) {
    stopAfterStart = true
    return
  }
  if (sessionCompleting) return
  sessionCompleting = true
  void itoSessionManager
    .completeSession()
    .catch(error => {
      console.error('[Key listener] Failed to complete session:', error)
    })
    .finally(() => {
      sessionCompleting = false
    })
}

async function startShortcutSession(shortcut: KeyboardShortcutConfig) {
  // Do not overlap initialization or the previous transcription's completion.
  if (pendingSessionStart || sessionCompleting) return
  activeShortcutId = shortcut.id
  latchedShortcut = shortcut.triggerType === 'double-tap' ? shortcut : null
  stopAfterStart = false
  const generation = ++sessionGeneration
  let starting: Promise<unknown> | null = null
  try {
    starting = itoSessionManager.startSession(shortcut.mode)
    pendingSessionStart = starting
    const interactionId = await starting
    if (generation !== sessionGeneration) return
    if (!interactionId) {
      resetRecordingState()
      return
    }
    pendingSessionStart = null
    if (stopAfterStart) {
      completeShortcutSession()
    } else if (activeShortcutId !== shortcut.id) {
      const active = store
        .get(STORE_KEYS.SETTINGS)
        .keyboardShortcuts.find(candidate => candidate.id === activeShortcutId)
      if (active) itoSessionManager.setMode(active.mode)
    }
  } catch (error) {
    if (generation === sessionGeneration) resetRecordingState()
    console.error('[Key listener] Failed to start session:', error)
  } finally {
    if (pendingSessionStart === starting) pendingSessionStart = null
  }
}

// Heartbeat monitoring state
let lastHeartbeatReceived = Date.now()
let lastHeartbeatCheck = Date.now()
let heartbeatCheckTimer: NodeJS.Timeout | null = null
const HEARTBEAT_CHECK_INTERVAL_MS = 5000 // Check every 5 seconds
const HEARTBEAT_TIMEOUT_MS = 15000 // 15 seconds without heartbeat triggers restart

// Test utility function - only available in development
export const resetForTesting = () => {
  if (process.env.NODE_ENV !== 'production') {
    KeyListenerProcess = null
    resetRecordingState()
    pendingSessionStart = null
    sessionCompleting = false
    stopAfterStart = false
    if (restartTimer) clearTimeout(restartTimer)
    restartTimer = null
    blockedKeys.clear()
    pressedKeys.clear()
    keyPressTimestamps.clear()
    stopStuckKeyChecker()
    stopHeartbeatChecker()
    lastHeartbeatReceived = Date.now()
    lastHeartbeatCheck = lastHeartbeatReceived
    lastKeyEventReceived = lastHeartbeatReceived
  }
}

const nativeModuleName = 'global-key-listener'

// Normalizes a raw key event into a consistent string
function normalizeKey(rawKey: string): KeyName {
  return keyNameMap[rawKey] || rawKey.toLowerCase()
}

// Export the key name mapping for use in UI components
export { keyNameMap }

// Heartbeat utility functions
function handleHeartbeat(_event: HeartbeatEvent) {
  lastHeartbeatReceived = Date.now()
}

function startHeartbeatChecker() {
  if (!heartbeatCheckTimer) {
    lastHeartbeatCheck = Date.now()
    heartbeatCheckTimer = setInterval(() => {
      const now = Date.now()
      const timeSinceLastCheck = now - lastHeartbeatCheck
      lastHeartbeatCheck = now

      if (timeSinceLastCheck > HEARTBEAT_TIMEOUT_MS) {
        lastHeartbeatReceived = now
        return
      }

      const timeSinceLastHeartbeat = now - lastHeartbeatReceived
      if (timeSinceLastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
        console.error(
          `[Key listener] No heartbeat received for ${timeSinceLastHeartbeat}ms, restarting key listener...`,
        )
        restartKeyListener()
      }
    }, HEARTBEAT_CHECK_INTERVAL_MS)
  }
}

function stopHeartbeatChecker() {
  if (heartbeatCheckTimer) {
    clearInterval(heartbeatCheckTimer)
    heartbeatCheckTimer = null
  }
}

export const restartKeyListener = () => {
  console.warn('🔄 Restarting keyboard listener due to timeout...')
  stopKeyListener()
  // Wait a brief moment before restarting to ensure cleanup is complete
  restartTimer = setTimeout(() => {
    restartTimer = null
    startKeyListener()
  }, 1000)
}

export const getLastKeyEventReceived = () => lastKeyEventReceived

// This set will track the state of all currently pressed keys.
const pressedKeys = new Set<string>()
const blockedKeys = new Set<string>()

// Track when each key was first pressed to detect stuck keys
const keyPressTimestamps = new Map<KeyName, number>()

// Timer for checking stuck keys
let stuckKeyCheckTimer: NodeJS.Timeout | null = null

// Configuration for stuck key detection
const STUCK_KEY_TIMEOUT = 5000 // 5 seconds
const STUCK_KEY_CHECK_INTERVAL = 1000 // Check every 1 second

// Function to check for and remove stuck keys
function checkForStuckKeys() {
  const currentTime = Date.now()
  const stuckKeys: KeyName[] = []

  for (const [key, pressTime] of keyPressTimestamps) {
    if (currentTime - pressTime > STUCK_KEY_TIMEOUT) {
      stuckKeys.push(key)
    }
  }

  // Remove stuck keys, but be careful not to interfere with active shortcuts
  for (const stuckKey of stuckKeys) {
    // If there's an active shortcut, check if this stuck key is part of it
    let shouldRemove = true

    if (activeShortcutId !== null) {
      const { keyboardShortcuts } = store.get(STORE_KEYS.SETTINGS)
      const activeShortcut = keyboardShortcuts
        .filter(ks => ks.keys.length > 0)
        .find(shortcut => {
          const normalizedShortcutKeys = shortcut.keys.map(normalizeLegacyKey)
          const hasAllKeys = normalizedShortcutKeys.every(key =>
            pressedKeys.has(key),
          )
          const exactMatch =
            normalizedShortcutKeys.length === pressedKeys.size && hasAllKeys
          return exactMatch
        })

      // Don't remove the stuck key if it's part of the currently active shortcut
      if (
        activeShortcut &&
        activeShortcut.keys.map(normalizeLegacyKey).includes(stuckKey)
      ) {
        shouldRemove = false
      }
    }

    if (shouldRemove) {
      console.warn(
        `Removing stuck key: ${stuckKey} (held for ${(currentTime - keyPressTimestamps.get(stuckKey)!) / 1000}s)`,
      )
      pressedKeys.delete(stuckKey)
      keyPressTimestamps.delete(stuckKey)
      tapDetectors.clear()
    }
  }
}

// Start the stuck key checking timer
function startStuckKeyChecker() {
  if (!stuckKeyCheckTimer) {
    stuckKeyCheckTimer = setInterval(
      checkForStuckKeys,
      STUCK_KEY_CHECK_INTERVAL,
    )
  }
}

// Stop the stuck key checking timer
function stopStuckKeyChecker() {
  if (stuckKeyCheckTimer) {
    clearInterval(stuckKeyCheckTimer)
    stuckKeyCheckTimer = null
  }
}

async function handleKeyEventInMain(event: KeyEvent) {
  const { isShortcutGloballyEnabled, keyboardShortcuts } = store.get(
    STORE_KEYS.SETTINGS,
  )

  if (!isShortcutGloballyEnabled) {
    if (activeShortcutId !== null) {
      console.info('Shortcut DEACTIVATED, stopping recording...')
      completeShortcutSession()
    }
    pressedKeys.clear()
    keyPressTimestamps.clear()
    tapDetectors.clear()
    return
  }

  const normalizedKey = normalizeKey(event.key)

  if (event.type === 'keydown') {
    if (pressedKeys.has(normalizedKey)) return // Ignore OS key repeat.
    pressedKeys.add(normalizedKey)
    // Track when this key was first pressed (only if not already tracked)
    if (!keyPressTimestamps.has(normalizedKey)) {
      keyPressTimestamps.set(normalizedKey, Date.now())
    }
  } else {
    pressedKeys.delete(normalizedKey)
    keyPressTimestamps.delete(normalizedKey)
  }

  // Capture time, rather than pipe delivery time, keeps buffered events honest.
  const eventTime = event.monotonic_ms ?? Date.parse(event.timestamp)
  let toggledShortcut: KeyboardShortcutConfig | undefined
  for (const shortcut of keyboardShortcuts.filter(
    ks => ks.keys.length > 0 && ks.triggerType === 'double-tap',
  )) {
    let detector = tapDetectors.get(shortcut.id)
    if (!detector) {
      detector = new DoubleTapDetector(shortcut.keys.map(normalizeLegacyKey))
      tapDetectors.set(shortcut.id, detector)
    }
    if (detector.update(event.type, normalizedKey, eventTime, pressedKeys)) {
      toggledShortcut ??= shortcut
    }
  }
  if (toggledShortcut) {
    if (latchedShortcut) {
      console.info('lib Double-tap STOP, completing recording...')
      completeShortcutSession()
    } else if (activeShortcutId === null) {
      console.info('lib Double-tap START, beginning recording...')
      await startShortcutSession(toggledShortcut)
    }
    return
  }

  // Check if any hold-type shortcuts are currently held
  // Match shortcuts that have exactly the same keys as currently pressed
  const currentlyHeldShortcut = keyboardShortcuts
    .filter(ks => ks.keys.length > 0)
    .filter(ks => (ks.triggerType || 'hold') === 'hold') // Only check hold shortcuts
    .find(shortcut => {
      // Normalize legacy keys in stored shortcuts
      const normalizedShortcutKeys = shortcut.keys.map(normalizeLegacyKey)

      // Check if all shortcut keys are pressed (exact match only)
      const hasAllKeys = normalizedShortcutKeys.every(shortcutKey =>
        pressedKeys.has(shortcutKey),
      )

      const exactMatch =
        normalizedShortcutKeys.length === pressedKeys.size && hasAllKeys

      return exactMatch
    })

  // Handle shortcut activation and mode changes for hold-type shortcuts
  if (currentlyHeldShortcut) {
    if (activeShortcutId === null) {
      // Starting a new session
      console.info('lib Shortcut ACTIVATED, starting recording...')
      await startShortcutSession(currentlyHeldShortcut)
    } else if (activeShortcutId !== currentlyHeldShortcut.id) {
      // Different shortcut detected while already recording - change mode
      activeShortcutId = currentlyHeldShortcut.id
      console.info(
        `lib Shortcut mode CHANGED to ${currentlyHeldShortcut.mode}, updating session...`,
      )
      if (!pendingSessionStart)
        itoSessionManager.setMode(currentlyHeldShortcut.mode)
    }
  } else if (latchedShortcut) {
    // A held edit shortcut is temporary while transcription is latched on.
    if (activeShortcutId !== latchedShortcut.id) {
      activeShortcutId = latchedShortcut.id
      if (!pendingSessionStart) itoSessionManager.setMode(latchedShortcut.mode)
    }
  } else if (activeShortcutId !== null) {
    console.info('lib Shortcut DEACTIVATED, stopping recording...')
    completeShortcutSession()
  }
}

// Starts the key listener process
export const startKeyListener = () => {
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = null
  // Subscribe at startup to avoid accessing the notifier during module cycles.
  // Cancellation, stream failure, and UI stops also release the shortcut latch.
  if (!recordingStoppedSubscribed) {
    recordingStateNotifier.onRecordingStopped(resetRecordingState)
    recordingStoppedSubscribed = true
  }
  if (KeyListenerProcess) {
    console.warn('Key listener already running.')
    return
  }

  const binaryPath = getNativeBinaryPath(nativeModuleName)
  if (!binaryPath) {
    console.error('Could not determine key listener binary path.')
    return
  }

  console.log('--- Key Listener Initialization ---')
  console.log(`Attempting to spawn key listener at: ${binaryPath}`)

  try {
    const env = {
      ...process.env,
      RUST_BACKTRACE: '1',
      OBJC_DISABLE_INITIALIZE_FORK_SAFETY: 'YES',
    }

    KeyListenerProcess = spawn(binaryPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    })

    if (!KeyListenerProcess) {
      throw new Error('Failed to spawn process')
    }

    const listenerProcess = KeyListenerProcess
    let buffer = ''
    KeyListenerProcess.stdout?.on('data', data => {
      if (KeyListenerProcess !== listenerProcess) return
      const chunk = data.toString()
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (line.trim()) {
          try {
            const event: ProcessEvent = JSON.parse(line)

            // Handle heartbeat and other system events
            if (event.type === 'heartbeat_ping') {
              handleHeartbeat(event)
              continue
            } else if (event.type === 'registered_hotkeys') {
              // Log registered hotkeys for debugging
              console.info('🔒 Registered hotkeys received:', event.hotkeys)
              continue
            } else if (event.type === 'shortcut-interrupted') {
              tapDetectors.clear()
              continue
            } else if (event.type === 'blocked_keys') {
              continue
            }

            // Handle regular key events
            if (event.type === 'keydown' || event.type === 'keyup') {
              lastKeyEventReceived = Date.now()
              // Process the event here in the main process for hotkey detection.
              void handleKeyEventInMain(event).catch(error => {
                console.error(
                  '[Key listener] Failed to handle key event:',
                  error,
                )
              })

              // Broadcast the raw event to all renderer windows for UI updates.
              BrowserWindow.getAllWindows().forEach(window => {
                if (!window.webContents.isDestroyed()) {
                  window.webContents.send('key-event', event)
                }
              })
            }
          } catch (e) {
            console.error('Failed to parse key process event:', line, e)
          }
        }
      }
    })

    KeyListenerProcess.stderr?.on('data', data => {
      console.error('[Key listener] stderr:', data.toString())
    })

    KeyListenerProcess.on('error', error => {
      console.error('[Key listener] process spawn error:', error)
      if (KeyListenerProcess === listenerProcess) stopKeyListener()
    })

    KeyListenerProcess.on('close', (code, signal) => {
      console.warn(
        `[Key listener] process closed with code: ${code}, signal: ${signal}`,
      )
      if (KeyListenerProcess === listenerProcess) stopKeyListener()
    })

    KeyListenerProcess.on('exit', (code, signal) => {
      console.warn(
        `[Key listener] process exited with code: ${code}, signal: ${signal}`,
      )
      if (KeyListenerProcess === listenerProcess) stopKeyListener()
    })

    console.log('[Key listener] started successfully.')

    // Register all configured hotkeys with the listener
    registerAllHotkeys()

    // Reapply blocked keys if any were set before listener start.
    registerBlockedKeys()

    // Start the stuck key checker
    startStuckKeyChecker()

    // Start heartbeat monitoring
    lastHeartbeatReceived = Date.now()
    lastHeartbeatCheck = lastHeartbeatReceived
    lastKeyEventReceived = lastHeartbeatReceived
    startHeartbeatChecker()
  } catch (error) {
    console.error('Failed to start key listener:', error)
    KeyListenerProcess = null
  }
}

// Register all hotkeys from settings with the key listener
export const registerAllHotkeys = () => {
  tapDetectors.clear()
  if (!KeyListenerProcess) {
    console.warn('Key listener not running, cannot register hotkeys.')
    return
  }

  const { isShortcutGloballyEnabled, keyboardShortcuts } = store.get(
    STORE_KEYS.SETTINGS,
  )

  if (!isShortcutGloballyEnabled) {
    if (activeShortcutId !== null) completeShortcutSession()
    pressedKeys.clear()
    keyPressTimestamps.clear()
    KeyListenerProcess.stdin?.write(
      JSON.stringify({ command: 'register_hotkeys', hotkeys: [] }) + '\n',
    )
    return
  }

  // Convert shortcuts to hotkey format for the listener
  const hotkeys = keyboardShortcuts
    .filter(ks => ks.keys.length > 0)
    .map(shortcut => ({
      keys: getKeysToRegister(shortcut),
      triggerType: shortcut.triggerType ?? 'hold',
    }))

  console.info('Registering hotkeys with listener:', hotkeys)

  KeyListenerProcess.stdin?.write(
    JSON.stringify({ command: 'register_hotkeys', hotkeys }) + '\n',
  )
}

const registerBlockedKeys = () => {
  if (!KeyListenerProcess || blockedKeys.size === 0) {
    return
  }

  KeyListenerProcess.stdin?.write(
    JSON.stringify({ command: 'block', keys: [...blockedKeys] }) + '\n',
  )
}

/**
 * A reverse mapping of normalized key names to their raw `rdev` counterparts.
 * This is a one-to-many relationship (e.g., 'command' maps to ['MetaLeft', 'MetaRight']).
 */
const reverseKeyNameMap: Record<string, string[]> = Object.entries(
  keyNameMap,
).reduce(
  (acc, [rawKey, normalizedKey]) => {
    if (!acc[normalizedKey]) {
      acc[normalizedKey] = []
    }
    acc[normalizedKey].push(rawKey)
    return acc
  },
  {} as Record<string, string[]>,
)

const getKeysToRegister = (shortcut?: KeyboardShortcutConfig): string[] => {
  if (!shortcut) {
    return []
  }

  const keys: string[] = []

  for (const key of shortcut.keys) {
    // Normalize legacy keys (maps base modifiers to left variants)
    const normalizedKey = normalizeLegacyKey(key)
    const reverseMappedKeys = reverseKeyNameMap[normalizedKey]

    if (reverseMappedKeys && reverseMappedKeys.length > 0) {
      // Use the reverse mapping if available
      keys.push(...reverseMappedKeys)
    } else {
      // Fallback: use the original key name as-is
      // This works because the key names come from rdev originally
      keys.push(key)
    }
  }

  // Return a unique set of keys.
  return [...new Set(keys)]
}

export const stopKeyListener = () => {
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = null
  if (activeShortcutId !== null) completeShortcutSession()
  pressedKeys.clear()
  keyPressTimestamps.clear()
  tapDetectors.clear()
  stopStuckKeyChecker()
  stopHeartbeatChecker()
  const listenerProcess = KeyListenerProcess
  KeyListenerProcess = null
  listenerProcess?.kill('SIGTERM')
}

export const blockKeys = (keys: string[]) => {
  if (keys.length === 0) {
    return
  }

  keys.forEach(key => blockedKeys.add(key))
  registerBlockedKeys()
}

export const unblockKey = (key: string) => {
  if (!blockedKeys.has(key)) {
    return
  }

  blockedKeys.delete(key)
  if (KeyListenerProcess) {
    KeyListenerProcess.stdin?.write(
      JSON.stringify({ command: 'unblock', key }) + '\n',
    )
  }
}

export const getBlockedKeys = () => [...blockedKeys]
