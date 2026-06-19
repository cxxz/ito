import { BrowserWindow } from 'electron'

/**
 * Send an IPC message to every open renderer window, skipping any window
 * (or its webContents) that has already been destroyed.
 */
export function broadcastToAllWindows(channel: string, payload?: unknown): void {
  BrowserWindow.getAllWindows().forEach(window => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  })
}
