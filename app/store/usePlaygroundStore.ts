import { create } from 'zustand'
import { DEFAULT_ADVANCED_SETTINGS } from '../../lib/constants/generated-defaults'
import { useAdvancedSettingsStore } from './useAdvancedSettingsStore'

// Default model mappings per provider (matching server-side constants)
const LLM_PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  groq: 'moonshotai/kimi-k2-instruct-0905',
  cerebras: 'qwen-3-235b-a22b-instruct-2507',
  openai: 'gpt-5-mini',
}

const ASR_PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  groq: 'whisper-large-v3-turbo',
  aliyun: 'qwen3-asr-flash',
  openai: 'whisper-1',
}

interface PlaygroundRunResult {
  asrOutput: string
  polishedOutput: string
  asrError?: {
    code: string
    message: string
  }
  polishError?: {
    code: string
    message: string
  }
}

interface PlaygroundPolishResult {
  polishedOutput: string
  error?: {
    code: string
    message: string
  }
}

interface PlaygroundStore {
  // Audio source
  audioFile: File | null
  audioBuffer: ArrayBuffer | null
  sampleRate: number
  audioFileName: string
  audioDuration: number // in seconds
  interactionId: string | null // When loaded from Recent Activity

  // ASR Configuration
  asrProvider: string
  asrModel: string

  // Polish Configuration
  customVocabulary: string
  polishLlmProvider: string
  polishLlmModel: string
  polishLlmTemperature: number
  transcriptionPrompt: string // Editable prompt for polishing

  // Results
  asrOutput: string
  originalAsrOutput: string // Original ASR output before user edits
  polishedOutput: string
  asrError: string | null
  polishError: string | null

  // UI State
  isTranscribing: boolean
  isPolishing: boolean

  // Actions
  setAudioFile: (file: File) => Promise<void>
  setAudioFromInteraction: (
    interactionId: string,
    audioBuffer: ArrayBuffer,
    sampleRate: number,
    fileName?: string,
  ) => void
  setAsrProvider: (provider: string) => void
  setAsrModel: (model: string) => void
  setCustomVocabulary: (vocab: string) => void
  setPolishLlmProvider: (provider: string) => void
  setPolishLlmModel: (model: string) => void
  setPolishLlmTemperature: (temp: number) => void
  setTranscriptionPrompt: (prompt: string) => void
  resetTranscriptionPrompt: () => void
  setAsrOutput: (text: string) => void
  restoreOriginalAsrOutput: () => void
  runTranscribeOnly: () => Promise<PlaygroundRunResult | null>
  runTranscribeAndPolish: () => Promise<PlaygroundRunResult | null>
  runPolishOnly: () => Promise<PlaygroundPolishResult | null>
  clearAudio: () => void
  clearResults: () => void
  reset: () => void
}

const DEFAULT_ASR_PROVIDER = 'groq'
const DEFAULT_ASR_MODEL = ASR_PROVIDER_DEFAULT_MODELS[DEFAULT_ASR_PROVIDER]
const DEFAULT_POLISH_PROVIDER = 'cerebras'
const DEFAULT_POLISH_MODEL =
  LLM_PROVIDER_DEFAULT_MODELS[DEFAULT_POLISH_PROVIDER]
const DEFAULT_POLISH_TEMPERATURE = 1.0

export const usePlaygroundStore = create<PlaygroundStore>((set, get) => ({
  // Initial state
  audioFile: null,
  audioBuffer: null,
  sampleRate: 16000,
  audioFileName: '',
  audioDuration: 0,
  interactionId: null,
  asrProvider: DEFAULT_ASR_PROVIDER,
  asrModel: DEFAULT_ASR_MODEL,
  customVocabulary: '',
  polishLlmProvider: DEFAULT_POLISH_PROVIDER,
  polishLlmModel: DEFAULT_POLISH_MODEL,
  polishLlmTemperature: DEFAULT_POLISH_TEMPERATURE,
  transcriptionPrompt: DEFAULT_ADVANCED_SETTINGS.transcriptionPrompt,
  asrOutput: '',
  originalAsrOutput: '',
  polishedOutput: '',
  asrError: null,
  polishError: null,
  isTranscribing: false,
  isPolishing: false,

  setAudioFile: async (file: File) => {
    try {
      const arrayBuffer = await file.arrayBuffer()

      // Try to detect sample rate from WAV header or default to 16000
      let sampleRate = 16000
      if (file.type === 'audio/wav' || file.name.endsWith('.wav')) {
        const dataView = new DataView(arrayBuffer)
        // Sample rate is at byte 24 in WAV header
        if (arrayBuffer.byteLength > 28) {
          sampleRate = dataView.getUint32(24, true)
        }
      }

      // Calculate duration
      // For PCM audio: duration = samples / sampleRate
      // Assuming 16-bit mono PCM
      const bytesPerSample = 2
      const channels = 1
      // Skip 44-byte WAV header for PCM data
      const dataSize =
        file.type === 'audio/wav' || file.name.endsWith('.wav')
          ? arrayBuffer.byteLength - 44
          : arrayBuffer.byteLength
      const duration = dataSize / (sampleRate * bytesPerSample * channels)

      set({
        audioFile: file,
        audioBuffer: arrayBuffer,
        sampleRate,
        audioFileName: file.name,
        audioDuration: duration,
        interactionId: null,
        // Clear previous results when new audio is loaded
        asrOutput: '',
        polishedOutput: '',
        asrError: null,
        polishError: null,
      })
    } catch (error) {
      console.error('[PlaygroundStore] Error reading audio file:', error)
    }
  },

  setAudioFromInteraction: (
    interactionId: string,
    audioBuffer: ArrayBuffer,
    sampleRate: number,
    fileName?: string,
  ) => {
    // Calculate duration
    const bytesPerSample = 2
    const channels = 1
    const duration =
      audioBuffer.byteLength / (sampleRate * bytesPerSample * channels)

    // Get app settings to pre-populate ASR and Polish providers/models
    const appState = useAdvancedSettingsStore.getState()
    const llmSettings = appState.llm
    const defaults = appState.defaults

    // ASR provider is stored in defaults (llm.asrProvider is always null per syncService)
    const asrProvider = defaults?.asrProvider || DEFAULT_ASR_PROVIDER
    const asrModel =
      llmSettings?.asrModel ||
      defaults?.asrModel ||
      ASR_PROVIDER_DEFAULT_MODELS[asrProvider] ||
      ''

    // Polish settings are user-configurable and stored in llm
    const polishLlmProvider =
      llmSettings?.polishLlmProvider || DEFAULT_POLISH_PROVIDER
    const polishLlmModel =
      llmSettings?.polishLlmModel ||
      LLM_PROVIDER_DEFAULT_MODELS[polishLlmProvider] ||
      ''
    const polishLlmTemperature =
      llmSettings?.polishLlmTemperature ?? DEFAULT_POLISH_TEMPERATURE

    set({
      audioFile: null,
      audioBuffer,
      sampleRate,
      audioFileName: fileName || `Recording ${interactionId.slice(0, 8)}`,
      audioDuration: duration,
      interactionId,
      // Apply app settings for ASR and Polish
      asrProvider,
      asrModel,
      polishLlmProvider,
      polishLlmModel,
      polishLlmTemperature,
      // Clear previous results
      asrOutput: '',
      originalAsrOutput: '',
      polishedOutput: '',
      asrError: null,
      polishError: null,
    })
  },

  setAsrProvider: (provider: string) => {
    set({
      asrProvider: provider,
      // Set model to the default for the new provider
      asrModel: ASR_PROVIDER_DEFAULT_MODELS[provider] || '',
    })
  },

  setAsrModel: (model: string) => {
    set({ asrModel: model })
  },

  setCustomVocabulary: (vocab: string) => {
    set({ customVocabulary: vocab })
  },

  setPolishLlmProvider: (provider: string) => {
    set({
      polishLlmProvider: provider,
      // Set model to the default for the new provider
      polishLlmModel: LLM_PROVIDER_DEFAULT_MODELS[provider] || '',
    })
  },

  setPolishLlmModel: (model: string) => {
    set({ polishLlmModel: model })
  },

  setPolishLlmTemperature: (temp: number) => {
    set({ polishLlmTemperature: temp })
  },

  setTranscriptionPrompt: (prompt: string) => {
    set({ transcriptionPrompt: prompt })
  },

  resetTranscriptionPrompt: () => {
    set({ transcriptionPrompt: DEFAULT_ADVANCED_SETTINGS.transcriptionPrompt })
  },

  setAsrOutput: (text: string) => {
    set({ asrOutput: text })
  },

  restoreOriginalAsrOutput: () => {
    set(state => ({ asrOutput: state.originalAsrOutput }))
  },

  runTranscribeOnly: async () => {
    const state = get()

    if (!state.audioBuffer) {
      console.error('[PlaygroundStore] No audio to process')
      return null
    }

    set({ isTranscribing: true, asrError: null })

    try {
      // Parse custom vocabulary (split on whitespace, commas, or newlines)
      const customVocabulary = state.customVocabulary
        .split(/[\s,]+/)
        .map(word => word.trim())
        .filter(word => word.length > 0)

      const result = await window.api.playground.run({
        audioBuffer: state.audioBuffer,
        sampleRate: state.sampleRate,
        customVocabulary,
        asrProvider: state.asrProvider,
        asrModel: state.asrModel,
        polishLlmProvider: state.polishLlmProvider,
        polishLlmModel: state.polishLlmModel,
        polishLlmTemperature: state.polishLlmTemperature,
        skipPolish: true,
      })

      const asrOutputValue = result.asrOutput || ''
      set({
        asrOutput: asrOutputValue,
        originalAsrOutput: asrOutputValue,
        asrError: result.asrError?.message || null,
        isTranscribing: false,
      })

      return result
    } catch (error) {
      console.error('[PlaygroundStore] Error running transcribe:', error)
      set({
        asrError: error instanceof Error ? error.message : 'Unknown error',
        isTranscribing: false,
      })
      return null
    }
  },

  runTranscribeAndPolish: async () => {
    const state = get()

    if (!state.audioBuffer) {
      console.error('[PlaygroundStore] No audio to process')
      return null
    }

    set({ isTranscribing: true, asrError: null, polishError: null })

    try {
      // Parse custom vocabulary (split on whitespace, commas, or newlines)
      const customVocabulary = state.customVocabulary
        .split(/[\s,]+/)
        .map(word => word.trim())
        .filter(word => word.length > 0)

      const result = await window.api.playground.run({
        audioBuffer: state.audioBuffer,
        sampleRate: state.sampleRate,
        customVocabulary,
        asrProvider: state.asrProvider,
        asrModel: state.asrModel,
        polishLlmProvider: state.polishLlmProvider,
        polishLlmModel: state.polishLlmModel,
        polishLlmTemperature: state.polishLlmTemperature,
        skipPolish: false,
      })

      const asrOutputValue = result.asrOutput || ''
      set({
        asrOutput: asrOutputValue,
        originalAsrOutput: asrOutputValue,
        polishedOutput: result.polishedOutput || '',
        asrError: result.asrError?.message || null,
        polishError: result.polishError?.message || null,
        isTranscribing: false,
      })

      return result
    } catch (error) {
      console.error('[PlaygroundStore] Error running playground:', error)
      set({
        asrError: error instanceof Error ? error.message : 'Unknown error',
        isTranscribing: false,
      })
      return null
    }
  },

  runPolishOnly: async () => {
    const state = get()

    if (!state.asrOutput) {
      console.error('[PlaygroundStore] No ASR output to polish')
      return null
    }

    set({ isPolishing: true, polishError: null })

    try {
      const result = await window.api.playground.polish({
        transcript: state.asrOutput,
        transcriptionPrompt: state.transcriptionPrompt,
        polishLlmProvider: state.polishLlmProvider,
        polishLlmModel: state.polishLlmModel,
        polishLlmTemperature: state.polishLlmTemperature,
      })

      set({
        polishedOutput: result.polishedOutput || '',
        polishError: result.error?.message || null,
        isPolishing: false,
      })

      return result
    } catch (error) {
      console.error('[PlaygroundStore] Error running polish:', error)
      set({
        polishError: error instanceof Error ? error.message : 'Unknown error',
        isPolishing: false,
      })
      return null
    }
  },

  clearAudio: () => {
    set({
      audioFile: null,
      audioBuffer: null,
      audioFileName: '',
      audioDuration: 0,
      interactionId: null,
      asrOutput: '',
      originalAsrOutput: '',
      polishedOutput: '',
      asrError: null,
      polishError: null,
    })
  },

  clearResults: () => {
    set({
      asrOutput: '',
      originalAsrOutput: '',
      polishedOutput: '',
      asrError: null,
      polishError: null,
    })
  },

  reset: () => {
    set({
      audioFile: null,
      audioBuffer: null,
      sampleRate: 16000,
      audioFileName: '',
      audioDuration: 0,
      interactionId: null,
      asrProvider: DEFAULT_ASR_PROVIDER,
      asrModel: DEFAULT_ASR_MODEL,
      customVocabulary: '',
      polishLlmProvider: DEFAULT_POLISH_PROVIDER,
      polishLlmModel: DEFAULT_POLISH_MODEL,
      polishLlmTemperature: DEFAULT_POLISH_TEMPERATURE,
      transcriptionPrompt: DEFAULT_ADVANCED_SETTINGS.transcriptionPrompt,
      asrOutput: '',
      originalAsrOutput: '',
      polishedOutput: '',
      asrError: null,
      polishError: null,
      isTranscribing: false,
      isPolishing: false,
    })
  },
}))
