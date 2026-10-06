# Claude Context for ITO Project

## Project Overview

This is the ITO project - an AI assistant application with both client and server components.

## Project Structure

- `app/` - Renderer process code (React UI components, stores, styles)
- `lib/` - Shared library code (main process, preload scripts, utilities)
- `native/` - Native binaries (Rust modules and Swift modules for macOS)
- `server/` - Server-side code with gRPC services
- `server/src/ito.proto` - Protocol buffer definitions
- `server/src/clients/` - LLM/ASR client implementations (Groq, Cerebras, OpenAI, Aliyun)
- `scripts/` - Build and utility scripts

## Branch

Main development branch: `dev`

## Development Commands

- Dev: `bun dev` (starts electron-vite dev with watch; does **not** rebuild native binaries)
  - Rebuild native binaries, then start dev: `bun dev:rust` (macOS) or `bun dev:rust:win` (Windows)
- Native binaries only: `bun build:rust:mac` (macOS) or `powershell -NoProfile -ExecutionPolicy Bypass -File build-binaries.ps1 -Windows` (Windows, MSVC)
- Server (run from `server/`):
  - Local dev: `bun install` → `bun local-db-up` (starts Postgres) → `bun db:migrate` → `bun dev` (tsx watch with hot reload)
  - Full stack via Docker: `bun docker` (equivalent to `docker compose up --build`)
- Build: `bun build:mac` or `bun build:win`
- Test: `bun runAllTests` (runs lib, server, app, and native tests)
  - Lib tests: `bun runLibTests`
  - Server tests: `bun runServerTests`
  - App tests: `bun runAppTests`
  - Native tests: `bun runNativeTests` (or see "Native Binary Tests" section)
  - Single lib/app test file: `bun runTest <path/to/file.test.ts>` (preloads `lib/__tests__/setup.ts`)
  - `runLibTests`/`runServerTests`/`runAppTests` use `find`/`xargs`/`sh`; on Windows without a POSIX shell, run files individually with `bun runTest`
- Lint:
  - TypeScript: `bun lint` (check) or `bun lint:fix` (fix)
  - Rust: `bun lint:native` (check) or `bun lint:fix:native` (fix)
- Type check: `bun type-check`
- Format:
  - TypeScript: `bun format` (check) or `bun format:fix` (fix)
  - Rust: `bun format:native` (check) or `bun format:fix:native` (fix)

## Native Binaries in Development

- In dev (`!app.isPackaged`), `lib/media/native-interface.ts` loads native helpers straight from the Cargo target dir:
  - macOS: `native/target/{aarch64|x86_64}-apple-darwin/release/<module>`
  - Windows: `native/target/x86_64-pc-windows-msvc/release/<module>.exe`
  - Packaged builds load from `process.resourcesPath/binaries`
- `bun dev` never rebuilds these. After pulling or editing anything under `native/`, rebuild with `bun dev:rust` / `bun dev:rust:win` (or the "Native binaries only" commands above).
- On Windows, prefer `build-binaries.ps1 -Windows` over `bun build:rust:win`. The latter runs `build-binaries.sh` through `bash`, which may resolve to WSL and cross-compile the `x86_64-pc-windows-gnu` target that dev does not load.
- Stale binary warning: `lib/media/native-staleness.ts` runs once per module per app session (dev only). It logs `[native] <module> binary is older than its source ... Rebuild native binaries with ...` when any file under the module's `src/`, `build.rs`, `Cargo.toml`, `Sources/`, or `Package.swift` is newer than the binary. `Cargo.lock` and `.manifest` files are ignored because they don't trigger a rebuild of that binary.
- A stale binary usually still runs but speaks an outdated stdio protocol, so the symptoms are misleading (see Troubleshooting).

## Audio Recorder Protocol

`native/audio-recorder` talks to `lib/media/audio.ts` (`audioRecorderService`) over stdio. Keep both sides in sync when changing either one.

- Commands (stdin, one JSON object per line): `start` (`device_name`), `stop`, `list-devices`, `get-device-config` (`device_name`)
- Output (stdout, framed): `[1 byte type][u32 LE payload length][payload]`
  - Type `1` = JSON: `audio-config`, `recording-ready`, `recording-error` (`code`, e.g. `AUDIO_OVERLOAD`), `device-list`, `drain-complete` (`dropped_frames`, `dropped_samples`)
  - Type `2` = audio: 16-bit LE mono PCM, resampled to 16 kHz
- Start: `startRecording` resolves only after **both** `recording-ready` and the first audio frame arrive. Otherwise it fails after 5s with "Microphone did not become ready and produce audio".
- Stop: `VoiceInputService.stopAudioRecording` sends `stop` and waits 500ms for `drain-complete`. Otherwise it fails with "Audio recorder drain timed out". A `drain-complete` with `dropped_frames > 0` is reported as `AUDIO_OVERLOAD`.
- On either timeout the helper process is killed, so late audio can't leak into the next session. The next `startRecording` spawns a fresh one.
- Backpressure:
  - Rust: the capture-to-writer queue (`capture_queue.rs`) holds at most ~2s of input samples. Once a frame is dropped, the recorder stops and emits `recording-error` `AUDIO_OVERLOAD`.
  - TypeScript: `AudioStreamManager` fails with `AUDIO_BACKLOG_LIMIT` (>5s queued for upload) or `RECORDING_LIMIT` (10 minutes / 20 MB).

## Native Binary Tests

The `native/` directory contains native binaries that power the app's core functionality:
- **Rust modules**: Organized as a Cargo workspace, allowing you to test and build all modules with a single command
- **Swift modules**: macOS-only modules for accessibility features (`cursor-context`, `macos-text`)

### Running Tests

Test all native modules:

```bash
cd native
cargo test --workspace
```

Or use the npm script:

```bash
bun runNativeTests
```

Test a single module:

```bash
cd native/global-key-listener
cargo test
```

### Native Modules

**Rust modules (cross-platform):**
- `global-key-listener` - Keyboard event capture and hotkey management
- `audio-recorder` - Audio recording with sample rate conversion
- `text-writer` - Cross-platform text input simulation
- `active-application` - Active window detection
- `selected-text-reader` - Selected text extraction

**Swift modules (macOS-only):**
- `cursor-context` - Cursor position and context extraction
- `macos-text` - macOS text accessibility utilities

### Linting and Formatting

Rust code follows standard formatting and linting rules defined in `native/`:

- **rustfmt.toml** - Code formatting configuration (100 char width, Unix line endings)
- **clippy.toml** - Linter configuration (cognitive complexity threshold)
- **Cargo.toml** - Workspace-level lint rules (all warnings, dbg_macro denied, todo warned)

Run checks locally:

```bash
# Check formatting
bun format:native

# Auto-fix formatting
bun format:fix:native

# Check lints
bun lint:native

# Auto-fix lints (where possible)
bun lint:fix:native
```

### CI/CD

Native tests and builds are integrated into the existing CI workflows:

**Tests** (`.github/workflows/test-runner.yml`):

- Unit tests run on macOS runner (OS-agnostic tests)
- Runs automatically via `bun runAllTests` on all pushes and PRs
- Executed as part of the main CI controller workflow

**Compilation Checks** (`.github/workflows/native-build-check.yml`):

- macOS: Verifies compilation for x86_64 and aarch64 architectures
- Windows: Verifies cross-compilation for x86_64-pc-windows-gnu (from Ubuntu with mingw-w64)
- Runs automatically on all pushes and PRs via the CI controller
- Ensures binaries compile correctly for both platforms before merging

**Release Builds** (`.github/workflows/build.yml`):

- Full release compilation happens during tagged releases
- Windows release binaries are built natively with the MSVC target (`x86_64-pc-windows-msvc`), the same target local dev loads
- Also includes compilation verification before packaging

## Troubleshooting

- **"Transcription failed" after ~5s; log shows "Microphone did not become ready and produce audio", then "Cannot send command, process not running" and "Audio recorder drain timed out"**: almost always a stale `audio-recorder` binary that predates `recording-ready` / `drain-complete`. Look for the `[native] ... older than its source` warning, then rebuild native binaries.
- **Windows build fails with `failed to remove file ...\audio-recorder.exe` / "Access is denied (os error 5)"**: orphaned helper processes from earlier dev sessions are locking the exe. Check with `tasklist /FI "IMAGENAME eq audio-recorder.exe"` and stop them with `taskkill /F /IM audio-recorder.exe`, then rebuild.
- **`[Main] HTTP/2 session error caught (ERR_HTTP2_...)`**: `lib/main/main.ts` handles every `ERR_HTTP2_*` `uncaughtException` by resetting the gRPC session instead of crashing. These can surface late from sessions connect-node already dropped (e.g. a TLS-inspecting proxy answering the HTTP/2 preface with HTTP/1.1). It's not fatal, but repeated occurrences point at the network path to the server.

## Code Style Preferences

- Keep code as simple as possible
- Don't create overly long files
- Group related code into useful, well-named functions
- Prefer clean, readable code over complex solutions
- Follow existing patterns and conventions in the codebase
- Always prefer console commands over log commands. E.g. use `console.log` instead of `log.info`.

## Tech Stack

- TypeScript
- Electron (desktop app framework)
- React (UI components)
- Bun (package manager and runtime)
- gRPC with Protocol Buffers (client-server communication)
- Zustand (state management)
- Tailwind CSS + MUI + Radix UI (styling and components)
- Rust + Swift (native binaries)
- Auth0 (authentication)
- Sentry (error monitoring)
- LLM providers: Groq, Cerebras, OpenAI, Aliyun
