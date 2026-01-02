# Playground Feature Implementation

This document describes the implementation of the Playground feature, which allows users to experiment with transcription and polish settings on uploaded audio files.

## Overview

The Playground provides a sandbox environment where users can:
- Upload an audio file (or send one from Recent Activity)
- Enter custom vocabulary words
- Configure ASR settings (provider: groq/aliyun, model)
- **Transcribe only** - Get raw ASR output without polish
- **Transcribe & Polish** - Combined transcription and polish in one step
- **Edit raw ASR output** - Modify the transcript before polishing
- **Polish separately** - Polish raw ASR output with an editable prompt
- Configure Polish LLM settings (provider, model, temperature)
- See both raw ASR output and polished transcription side-by-side

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              UI Layer                                    │
│  PlaygroundContent.tsx ←→ usePlaygroundStore.ts                         │
│                                                                          │
│  HomeContent.tsx ("Send to Playground" button)                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ window.api.playground.run()
                                    │ window.api.playground.polish()
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           Preload API                                    │
│  lib/preload/api.ts                                                     │
│  → ipcRenderer.invoke('playground:run', request)                        │
│  → ipcRenderer.invoke('playground:polish', request)                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ IPC
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          Main Process                                    │
│  lib/window/ipcEvents.ts → lib/main/playground/playgroundRunner.ts      │
│                                                                          │
│  runPlayground():                                                        │
│  - Fetches system dictionary words                                       │
│  - Combines with custom vocabulary                                       │
│  - Calls grpcClient.playgroundRun()                                     │
│                                                                          │
│  runPlaygroundPolish():                                                  │
│  - Calls grpcClient.playgroundPolish() with custom prompt               │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ gRPC
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                             Server                                       │
│  server/src/services/playground/playgroundHandler.ts                    │
│                                                                          │
│  handlePlaygroundRun():                                                  │
│  1. Calls ASR provider (Groq/Cerebras/etc) with vocabulary              │
│  2. If skipPolish=false, calls Polish LLM with raw transcript           │
│  3. Returns both outputs in single response                             │
│                                                                          │
│  handlePlaygroundPolish():                                               │
│  1. Takes transcript text and custom prompt                             │
│  2. Calls Polish LLM with user's custom transcription prompt            │
│  3. Returns polished output                                             │
└─────────────────────────────────────────────────────────────────────────┘
```

## Key Files

### UI Layer

| File | Purpose |
|------|---------|
| `app/components/home/contents/PlaygroundContent.tsx` | Main UI component with audio upload, settings inputs, and results display |
| `app/store/usePlaygroundStore.ts` | Zustand store for all playground state and actions |
| `app/components/home/contents/HomeContent.tsx` | Contains "Send to Playground" button in Recent Activity |
| `app/components/home/HomeKit.tsx` | Navigation - includes Playground nav item with Flask icon |
| `app/store/useMainStore.ts` | PageType includes 'playground' for navigation |

### Client Infrastructure

| File | Purpose |
|------|---------|
| `lib/preload/api.ts` | Exposes `playground.run()` and `playground.polish()` to renderer process |
| `lib/window/ipcEvents.ts` | IPC handlers for 'playground:run' and 'playground:polish' |
| `lib/main/playground/playgroundRunner.ts` | Main process logic - `runPlayground()` and `runPlaygroundPolish()` functions |
| `lib/clients/grpcClient.ts` | `playgroundRun()` and `playgroundPolish()` methods for gRPC calls |

### Server

| File | Purpose |
|------|---------|
| `server/src/ito.proto` | Proto definitions for `PlaygroundRun` and `PlaygroundPolish` RPCs |
| `server/src/services/playground/playgroundHandler.ts` | Server handlers - `handlePlaygroundRun()` and `handlePlaygroundPolish()` |
| `server/src/services/ito/itoService.ts` | Registers the playground handlers |

## Proto Definitions

```protobuf
// In server/src/ito.proto

// Playground Service - for experimenting with transcription and polish settings
rpc PlaygroundRun(PlaygroundRunRequest) returns (PlaygroundRunResponse);
rpc PlaygroundPolish(PlaygroundPolishRequest) returns (PlaygroundPolishResponse);

// Request to run playground transcription and polish
message PlaygroundRunRequest {
  bytes audio_data = 1;                    // Audio file contents (WAV/PCM format)
  int32 sample_rate = 2;                   // Audio sample rate (e.g., 16000)
  repeated string custom_vocabulary = 3;   // User-provided vocabulary words
  string polish_llm_provider = 4;          // e.g., "groq", "cerebras", "openai"
  string polish_llm_model = 5;             // Model name for polish LLM
  float polish_llm_temperature = 6;        // Temperature for polish LLM
  bool skip_polish = 7;                    // If true, skip polish step (transcribe only)
  string asr_provider = 8;                 // ASR provider (e.g., "groq", "aliyun")
  string asr_model = 9;                    // Model name for ASR
}

// Response from playground run with both ASR and polished outputs
message PlaygroundRunResponse {
  string asr_output = 1;                   // Raw ASR transcription
  string polished_output = 2;              // Polished transcription from LLM
  ClientError asr_error = 3;               // Error during ASR (if any)
  ClientError polish_error = 4;            // Error during polish (if any)
}

// Request to polish text in playground
message PlaygroundPolishRequest {
  string transcript = 1;                   // Raw ASR text to polish
  string transcription_prompt = 2;         // Custom prompt (editable by user)
  string polish_llm_provider = 3;          // e.g., "groq", "cerebras", "openai"
  string polish_llm_model = 4;             // Model name for polish LLM
  float polish_llm_temperature = 5;        // Temperature for polish LLM
}

// Response from playground polish
message PlaygroundPolishResponse {
  string polished_output = 1;              // Polished transcription from LLM
  ClientError error = 2;                   // Error during polish (if any)
}
```

## Data Flow

### Transcribe Only

1. **User clicks "Transcribe"** in `PlaygroundContent.tsx`
2. **Store action** `runTranscribeOnly()` is called
3. **IPC call** via `window.api.playground.run({ ...request, skipPolish: true })`
4. **Main process** `runPlayground()`:
   - Fetches dictionary words from SQLite
   - Merges with user's custom vocabulary
   - Calls `grpcClient.playgroundRun()` with `skipPolish: true`, `asrProvider`, `asrModel`
5. **Server handler** `handlePlaygroundRun()`:
   - Gets ASR provider/model from request (with fallbacks to env/defaults)
   - Transcribes audio with specified provider/model
   - Skips polish step (returns empty polishedOutput)
6. **Response flows back** through the chain
7. **Store updates** `asrOutput` and `originalAsrOutput`
8. **UI re-renders** showing editable raw ASR output

### Transcribe & Polish

1. **User clicks "Transcribe & Polish"** in `PlaygroundContent.tsx`
2. **Store action** `runTranscribeAndPolish()` is called
3. **IPC call** via `window.api.playground.run({ ...request, skipPolish: false })`
4. **Main process** `runPlayground()`:
   - Fetches dictionary words, merges with custom vocabulary
   - Calls `grpcClient.playgroundRun()` with `skipPolish: false`, `asrProvider`, `asrModel`
5. **Server handler** `handlePlaygroundRun()`:
   - Transcribes audio with specified ASR provider/model
   - Polishes transcript with default prompt
   - Returns both outputs
6. **Store updates** `asrOutput`, `originalAsrOutput`, and `polishedOutput`
7. **UI re-renders** showing both results

### Polish Only (Separate Step)

1. **User clicks "Polish"** button (in Polish Settings section header)
2. **Store action** `runPolishOnly()` is called
   - Uses current `asrOutput` value (which may have been edited by user)
3. **IPC call** via `window.api.playground.polish(request)`
4. **Main process** `runPlaygroundPolish()`:
   - Calls `grpcClient.playgroundPolish()` with user's custom prompt
5. **Server handler** `handlePlaygroundPolish()`:
   - Uses user's custom `transcriptionPrompt`
   - Polishes the transcript text with specified provider/model/temperature
   - Returns polished output
6. **Store updates** `polishedOutput`
7. **UI re-renders** showing new polished result

### Send to Playground (from Recent Activity)

1. **User clicks Flask button** on an interaction in `HomeContent.tsx`
2. **Handler** `handleSendToPlayground()`:
   - Gets `interaction.raw_audio` buffer and `sample_rate`
   - Calls `setAudioFromInteraction()` on playground store
   - Navigates to playground via `setCurrentPage('playground')`
3. **Store action** `setAudioFromInteraction()`:
   - Loads audio data and calculates duration
   - Pre-populates ASR settings from `useAdvancedSettingsStore` (provider, model)
   - Pre-populates Polish settings from `useAdvancedSettingsStore` (provider, model, temperature)
   - Clears previous results
4. **Playground loads** with audio and settings pre-populated

## Store State (`usePlaygroundStore`)

```typescript
interface PlaygroundStore {
  // Audio source
  audioFile: File | null           // From file upload
  audioBuffer: ArrayBuffer | null  // Raw audio data
  sampleRate: number               // Audio sample rate
  audioFileName: string            // Display name
  audioDuration: number            // Duration in seconds
  interactionId: string | null     // Set when loaded from Recent Activity

  // ASR Configuration
  asrProvider: string              // 'groq', 'aliyun'
  asrModel: string                 // Model name for ASR

  // Polish Configuration
  customVocabulary: string         // Space/comma-separated words
  polishLlmProvider: string        // 'groq', 'cerebras', 'openai'
  polishLlmModel: string           // Model name (empty = provider default)
  polishLlmTemperature: number     // 0-2
  transcriptionPrompt: string      // Editable prompt for polishing

  // Results
  asrOutput: string                // Raw ASR transcript (editable by user)
  originalAsrOutput: string        // Original ASR output before user edits
  polishedOutput: string           // Polished transcript
  asrError: string | null          // ASR error message
  polishError: string | null       // Polish error message

  // UI State
  isTranscribing: boolean          // True during transcribe operations
  isPolishing: boolean             // True during polish-only operations

  // Actions
  setAudioFile(file: File): Promise<void>
  setAudioFromInteraction(id, buffer, sampleRate, fileName?): void
  setAsrProvider(provider: string): void
  setAsrModel(model: string): void
  setCustomVocabulary(vocab: string): void
  setPolishLlmProvider(provider: string): void
  setPolishLlmModel(model: string): void
  setPolishLlmTemperature(temp: number): void
  setTranscriptionPrompt(prompt: string): void
  resetTranscriptionPrompt(): void
  setAsrOutput(text: string): void
  restoreOriginalAsrOutput(): void
  runTranscribeOnly(): Promise<PlaygroundRunResult | null>
  runTranscribeAndPolish(): Promise<PlaygroundRunResult | null>
  runPolishOnly(): Promise<PlaygroundPolishResult | null>
  clearAudio(): void
  clearResults(): void
  reset(): void
}
```

### Default Provider/Model Mappings

The store uses default model mappings per provider (matching server-side constants):

```typescript
const LLM_PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  groq: 'moonshotai/kimi-k2-instruct-0905',
  cerebras: 'qwen-3-235b-a22b-instruct-2507',
  openai: 'gpt-5-mini',
}

const ASR_PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  groq: 'whisper-large-v3-turbo',
  aliyun: 'qwen3-asr-flash',
}
```

When changing a provider, the model is automatically updated to the default for that provider.

## UI Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ PLAYGROUND                                                      │
│ Experiment with transcription and polish settings               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ ┌─────────────────────────┐  ┌─────────────────────────┐        │
│ │ AUDIO SOURCE            │  │ CUSTOM VOCABULARY       │        │
│ │ [drag/drop area         │  │ (optional)              │        │
│ │  or uploaded file info] │  │ [textarea]              │        │
│ │ [Play] [X clear]        │  │                         │        │
│ └─────────────────────────┘  └─────────────────────────┘        │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ ASR SETTINGS                    [Transcribe] [Transcribe & Polish]
│ Provider: [dropdown]  Model: [input]                            │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ RAW ASR OUTPUT                         [Restore] [Copy]         │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ (editable textarea - user can modify before polishing)      │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ POLISH SETTINGS                                       [Polish]  │
│ Provider: [dropdown]  Model: [input]  Temperature: [input]      │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ TRANSCRIPTION PROMPT                        [Reset to default]  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ (editable prompt textarea - pre-filled with default)        │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ POLISHED OUTPUT                                         [Copy]  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ (polished transcription text)                               │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Key UI Features

1. **Audio Source**: Play button to preview audio, X button to clear
2. **ASR Settings**: Dedicated section with provider dropdown and model input; Transcribe buttons in header
3. **Editable ASR Output**: Users can edit the raw transcript before polishing; Restore button appears when edited
4. **Polish Settings**: Provider, model, and temperature controls; Polish button in header
5. **Transcription Prompt**: Editable textarea with "Reset to default" link

## Design Decisions

1. **Editable prompt is playground-only**: The `transcriptionPrompt` in the store is local to playground and doesn't sync to `useAdvancedSettingsStore` or app settings. This prevents experimental prompts from affecting production transcription.

2. **Separate endpoint for Polish**: A dedicated `PlaygroundPolish` RPC keeps the API clean and focused, rather than overloading the existing endpoint.

3. **Skip polish flag**: Instead of creating a third endpoint for transcribe-only, a simple `skipPolish` flag on the existing request keeps the implementation simple since the audio processing is the same.

4. **Layout efficiency**: Audio source and custom vocabulary side-by-side saves vertical space and keeps transcribe-related settings grouped together.

5. **Multiple polish runs allowed**: User can click "Polish" multiple times with different prompts on the same ASR output to experiment. Each run updates the polished output without clearing the ASR output.

6. **Default prompt initialization**: The transcription prompt is initialized from `DEFAULT_ADVANCED_SETTINGS.transcriptionPrompt` and can be reset to this default at any time.

7. **Editable ASR output**: Users can edit the raw ASR transcript before polishing, allowing manual corrections. The original output is preserved and can be restored via the "Restore original" button.

8. **ASR settings in playground**: Users can experiment with different ASR providers (groq, aliyun) and models in the playground without affecting their global settings.

9. **Settings inheritance from app**: When loading audio from Recent Activity via "Send to Playground", the ASR and Polish settings are pre-populated from the user's current app settings stored in `useAdvancedSettingsStore`.

## Extending the Playground

### Adding a new configuration option

1. Add field to `PlaygroundRunRequest` in `ito.proto`
2. Run proto generation: `cd server && bun run proto:gen:server && bun run proto:gen:client`
3. Add state and setter to `usePlaygroundStore.ts`
4. Add UI input in `PlaygroundContent.tsx`
5. Pass the value through `playgroundRunner.ts` and `grpcClient.ts`
6. Handle in `playgroundHandler.ts`

### Adding a new output field

1. Add field to `PlaygroundRunResponse` in `ito.proto`
2. Run proto generation
3. Add state field to store
4. Update `runTranscribeOnly()` / `runTranscribeAndPolish()` to set the new state
5. Add UI display in `PlaygroundContent.tsx`

### Modifying ASR/Polish behavior

The server handler in `playgroundHandler.ts` uses:
- `getAsrProvider()` from `server/src/clients/providerUtils.ts`
- `getLlmProvider()` from the same file

These return provider instances (Groq, Cerebras, OpenAI, Aliyun) based on configuration.

## Navigation

The Playground appears in the sidebar navigation between Notes and Settings:

```
Home → Dictionary → Notes → Playground → Settings → About
```

Icon: `Flask` from `@mynaui/icons-react`

