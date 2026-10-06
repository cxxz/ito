import os from 'os'
import { join } from 'path'
import { warnIfNativeBinaryStale } from './native-staleness'

const platform = os.platform()

// Lazy-load electron to avoid module load timing issues
const getIsDev = (): boolean => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron')
  return !app.isPackaged
}

export const getNativeBinaryPath = (
  nativeModuleName: string,
): string | null => {
  const targetDir = getTargetDir()
  const binaryName =
    platform === 'win32' ? `${nativeModuleName}.exe` : `${nativeModuleName}`

  if (!targetDir) {
    console.error(
      `Cannot determine ${nativeModuleName} binary path for platform ${platform}`,
    )
    return null
  }
  const binaryPath = join(targetDir, binaryName)
  if (getIsDev()) {
    warnIfNativeBinaryStale(
      nativeModuleName,
      binaryPath,
      join(getDevNativeDir(), nativeModuleName),
    )
  }
  return binaryPath
}

const getDevNativeDir = (): string => join(__dirname, '../../native')

const getTargetDir = (): string | null => {
  if (getIsDev()) {
    const targetBase = join(getDevNativeDir(), 'target')

    if (platform === 'darwin') {
      // Detect current architecture
      const arch = os.arch() // 'arm64' or 'x64'
      const cargoArch = arch === 'arm64' ? 'aarch64' : 'x86_64'
      const targetDir = join(targetBase, `${cargoArch}-apple-darwin/release`)
      return targetDir
    } else if (platform === 'win32') {
      return join(targetBase, 'x86_64-pc-windows-msvc/release')
    }
    // Fallback for unsupported dev platforms
    return null
  }
  return join(process.resourcesPath, 'binaries')
}
