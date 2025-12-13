import { DEFAULT_ADVANCED_SETTINGS } from '../../constants/generated-defaults.js'
import { ItoMode } from '../../generated/ito_pb.js'

export const ITO_MODE_PROMPT: { [key in ItoMode]: string } = {
  [ItoMode.TRANSCRIBE]: DEFAULT_ADVANCED_SETTINGS.transcriptionPrompt,
  [ItoMode.EDIT]: DEFAULT_ADVANCED_SETTINGS.editingPrompt,
}

export const ITO_MODE_SYSTEM_PROMPT: { [key in ItoMode]: string } = {
  [ItoMode.TRANSCRIBE]: 'You are a helpful AI transcription assistant.',
  [ItoMode.EDIT]: 'You are an AI assistant helping to edit documents.',
}

// Default OpenAI base URL
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'

function getNonEmptyEnv(name: string): string | undefined {
  const value = process.env[name]
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function getDefaultAsrProvider(): string {
  return getNonEmptyEnv('ASR_PROVIDER') ?? DEFAULT_ADVANCED_SETTINGS.asrProvider
}

export function getDefaultAsrModel(asrProvider: string): string {
  const envModel = getNonEmptyEnv('ASR_MODEL')
  if (envModel) return envModel

  switch (asrProvider) {
    case 'aliyun':
      return 'qwen3-asr-flash'
    case 'groq':
    default:
      return DEFAULT_ADVANCED_SETTINGS.asrModel
  }
}

export function getDefaultAdvancedSettingsStruct() {
  const asrProvider = getDefaultAsrProvider()
  const asrModel = getDefaultAsrModel(asrProvider)
  const llmProvider = DEFAULT_ADVANCED_SETTINGS.llmProvider
  const llmModel = getDefaultLlmModel(llmProvider)

  return {
    asrModel,
    asrPrompt: DEFAULT_ADVANCED_SETTINGS.asrPrompt,
    asrProvider,
    llmProvider,
    llmTemperature: DEFAULT_ADVANCED_SETTINGS.llmTemperature,
    llmModel,
    llmBaseUrl: getNonEmptyEnv('OPENAI_BASE_URL') ?? DEFAULT_OPENAI_BASE_URL,
    transcriptionPrompt: DEFAULT_ADVANCED_SETTINGS.transcriptionPrompt,
    editingPrompt: DEFAULT_ADVANCED_SETTINGS.editingPrompt,
    noSpeechThreshold: DEFAULT_ADVANCED_SETTINGS.noSpeechThreshold,
  }
}

export function getProviderDefaultLlmModels(): Record<string, string> {
  return {
    openai: getNonEmptyEnv('OPENAI_DEFAULT_LLM') ?? 'gpt-5-mini',
    groq:
      getNonEmptyEnv('GROQ_DEFAULT_LLM') ?? 'moonshotai/kimi-k2-instruct-0905',
    cerebras:
      getNonEmptyEnv('CEREBRAS_DEFAULT_LLM') ??
      'qwen-3-235b-a22b-instruct-2507',
  }
}

export function getDefaultLlmModel(llmProvider: string): string {
  const defaults = getProviderDefaultLlmModels()
  return defaults[llmProvider] ?? DEFAULT_ADVANCED_SETTINGS.llmModel
}
