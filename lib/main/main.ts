// Import env first to set up app paths and name before app.whenReady()
import { ITO_ENV } from './env'

import { app, protocol, BrowserWindow, powerMonitor } from 'electron'

// Inline replacement for @electron-toolkit/utils to avoid module load timing issues
const setAppUserModelId = (id: string): void => {
  if (process.platform === 'win32') {
    app.setAppUserModelId(!app.isPackaged ? process.execPath : id)
  }
}

const watchWindowShortcuts = (window: BrowserWindow): void => {
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      // Allow F12 for dev tools
      return
    }
    // Allow refresh shortcuts
    if (
      input.type === 'keyDown' &&
      input.key === 'r' &&
      (input.control || input.meta)
    ) {
      return
    }
  })
}
import {
  createAppWindow,
  createPillWindow,
  mainWindow,
  registerResourcesProtocol,
  startPillPositioner,
} from './app'
import { initializeLogging } from './logger'
import { registerIPC } from '../window/ipcEvents'
import { registerDevIPC } from '../window/ipcDev'
import { initializeDatabase } from './sqlite/db'
import { setupProtocolHandling, processStartupProtocolUrl } from '../protocol'
import {
  startKeyListener,
  restartKeyListener,
  getLastKeyEventReceived,
} from '../media/keyboard'
// Import the grpcClient singleton
import { grpcClient } from '../clients/grpcClient'
import { preventAppNap } from './appNap'
import { syncService } from './syncService'
import { checkAccessibilityPermission } from '../utils/crossPlatform'
import { initializeStore } from './store'
import { selectedTextReaderService } from '../media/selected-text-reader'
import { macOSAccessibilityContextProvider } from '../media/macOSAccessibilityContextProvider'
import { voiceInputService } from './voiceInputService'
import { initializeMicrophoneSelection } from '../media/microphoneSetUp'
import { createAppTray } from './tray'
import { initializeAutoUpdater } from './autoUpdaterWrapper'
import { teardown } from './teardown'

// Handle HTTP/2 session errors gracefully without showing pop-up
// These errors can occur when the gRPC connection to the server dies unexpectedly
process.on('uncaughtException', (error: Error) => {
  const errorCode = (error as NodeJS.ErrnoException).code
  // Check if this is an HTTP/2 frame error
  if (
    errorCode === 'ERR_HTTP2_TOO_MANY_INVALID_FRAMES' ||
    error.message?.includes('ERR_HTTP2_TOO_MANY_INVALID_FRAMES') ||
    error.message?.includes('Too many invalid HTTP/2 frames')
  ) {
    console.log('[Main] HTTP/2 session error caught, resetting gRPC connection')
    grpcClient.abortSession(error.message)
    return // Don't re-throw, prevents pop-up
  }

  // For other uncaught exceptions, log and re-throw to preserve default behavior
  console.error('[Main] Uncaught exception:', error)
  throw error
})

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'res',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
])

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Initialize the database BEFORE logging so KV writes have a schema
  try {
    await initializeDatabase()
  } catch (error) {
    console.error('Failed to initialize database, quitting app.', error)
    return
  }

  // Initialize KV-backed store and run migrations before anything reads/writes
  try {
    await initializeStore()
  } catch (err) {
    console.error('Failed to initialize main store, quitting app.', err)
    return
  }

  // Initialize logging after DB + store so batched log persistence can write
  initializeLogging()

  // Self-hosted mode: no authentication required
  console.log('Running in self-hosted mode (no authentication)')

  // Start sync service
  syncService.start()

  // Setup protocol handling for deep links
  setupProtocolHandling()

  // Prevent app nap
  preventAppNap()

  // Register the handler for the 'res' protocol now that the app is ready.
  const appId = ITO_ENV === 'prod' ? 'ai.ito.ito' : `ai.ito.ito-${ITO_ENV}`
  registerResourcesProtocol()
  setAppUserModelId(appId)

  // IMPORTANT: Register IPC handlers BEFORE creating windows
  // This prevents the renderer from making IPC calls before handlers are ready
  registerIPC()

  if (!app.isPackaged) {
    registerDevIPC()
  }

  // Create windows
  createAppWindow()
  createPillWindow()
  startPillPositioner()

  // Handle protocol URL if the app was started by a deep link (Windows first instance)
  processStartupProtocolUrl()

  // --- ADDED: Give the gRPC client a reference to the main window ---
  // This allows it to send transcription results back to the renderer.
  if (mainWindow) {
    grpcClient.setMainWindow(mainWindow)
  }

  if (checkAccessibilityPermission(false)) {
    console.log('Accessibility permissions found, starting key listener.')
    startKeyListener()
  }

  const restartKeyListenerIfAllowed = (reason: string) => {
    if (!checkAccessibilityPermission(false)) {
      console.warn(
        `[Key listener] Skipping restart (${reason}): accessibility permission missing.`,
      )
      return
    }
    console.warn(`[Key listener] Restarting due to ${reason}...`)
    restartKeyListener()
  }

  const maybeRestartOnUserActive = () => {
    const idleMs = Date.now() - getLastKeyEventReceived()
    const IDLE_RESTART_THRESHOLD_MS = 60 * 60 * 1000
    if (idleMs >= IDLE_RESTART_THRESHOLD_MS) {
      restartKeyListenerIfAllowed('user idle')
    }
  }

  powerMonitor.on('resume', () => restartKeyListenerIfAllowed('system resume'))
  powerMonitor.on('unlock-screen', () =>
    restartKeyListenerIfAllowed('screen unlock'),
  )
  powerMonitor.on('user-did-become-active', maybeRestartOnUserActive)

  console.log('Microphone access granted, starting audio recorder.')
  voiceInputService.setUpAudioRecorderListeners()

  console.log('Starting selected text reader service.')
  selectedTextReaderService.initialize()

  // Initialize cursor context provider (macOS only for now)
  if (process.platform === 'darwin') {
    console.log('Starting cursor context provider.')
    macOSAccessibilityContextProvider.initialize()
  }

  // Initialize microphone selection to prefer built-in microphone
  await initializeMicrophoneSelection()

  // Create system tray after audio recorder is initialized and devices are available
  await createAppTray()

  app.on('activate', function () {
    if (mainWindow === null) {
      createAppWindow()
      // Update the gRPC client with the new main window reference
      if (mainWindow) {
        grpcClient.setMainWindow(mainWindow)
      }
    }
  })

  app.on('before-quit', () => {
    console.log('App is quitting, cleaning up resources...')
    teardown()
  })

  app.on('browser-window-created', (_, window) => {
    watchWindowShortcuts(window)
  })

  // Initialize auto-updater
  initializeAutoUpdater()
})

app.on('window-all-closed', () => {
  // We want the app to stay alive
})
