import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// Inputs that make cargo/swift rebuild a module's binary when they change.
const SOURCE_ENTRIES = [
  'src',
  'build.rs',
  'Cargo.toml',
  'Sources',
  'Package.swift',
]

type SourceFile = { path: string; mtimeMs: number }

const checkedModules = new Set<string>()

const newestFile = (paths: string[]): SourceFile | null =>
  paths.reduce<SourceFile | null>((newest, path) => {
    if (!existsSync(path)) return newest
    const stat = statSync(path)
    const file = stat.isDirectory()
      ? newestFile(readdirSync(path).map(entry => join(path, entry)))
      : { path, mtimeMs: stat.mtimeMs }
    return file && (!newest || file.mtimeMs > newest.mtimeMs) ? file : newest
  }, null)

/**
 * Returns the newest source file of a native module that was modified after
 * its binary was built, or null if the binary is up to date (or missing).
 */
export const findNewerNativeSource = (
  binaryPath: string,
  moduleDir: string,
): SourceFile | null => {
  if (!existsSync(binaryPath)) return null
  const newest = newestFile(SOURCE_ENTRIES.map(entry => join(moduleDir, entry)))
  const builtAt = statSync(binaryPath).mtimeMs
  return newest && newest.mtimeMs > builtAt ? newest : null
}

/**
 * Dev-only guard: a binary built from older source can speak an outdated
 * protocol and fail in confusing ways (e.g. recorder readiness timeouts).
 */
export const warnIfNativeBinaryStale = (
  moduleName: string,
  binaryPath: string,
  moduleDir: string,
): void => {
  if (checkedModules.has(moduleName)) return
  checkedModules.add(moduleName)
  try {
    const source = findNewerNativeSource(binaryPath, moduleDir)
    if (!source) return
    const rebuild =
      process.platform === 'win32' ? 'bun dev:rust:win' : 'bun dev:rust'
    console.warn(
      `[native] ${moduleName} binary is older than its source ` +
        `(${source.path} changed ${new Date(source.mtimeMs).toISOString()}, ` +
        `binary built ${statSync(binaryPath).mtime.toISOString()}). ` +
        `It may not match the app and can fail in confusing ways. ` +
        `Rebuild native binaries with \`${rebuild}\`.`,
    )
  } catch (error) {
    console.warn(
      `[native] Could not check whether ${moduleName} binary is up to date:`,
      error,
    )
  }
}

export const resetNativeStalenessChecks = (): void => {
  checkedModules.clear()
}
