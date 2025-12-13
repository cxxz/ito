export interface Note {
  id: string
  user_id: string
  interaction_id: string | null
  content: string
  created_at: Date
  updated_at: Date
  deleted_at: Date | null
}

export interface Interaction {
  id: string
  user_id: string | null
  title: string | null
  asr_output: any
  llm_output: any
  duration_ms: number | null
  created_at: Date
  updated_at: Date
  deleted_at: Date | null
}

export interface DictionaryItem {
  id: string
  user_id: string
  word: string
  pronunciation: string | null
  created_at: Date
  updated_at: Date
  deleted_at: Date | null
}

interface LlmSettingsBase {
  asr_model: string | null
  asr_provider: string | null
  asr_prompt: string | null
  llm_provider: string | null
  llm_model: string | null
  llm_temperature: number | null
  llm_base_url: string | null
  transcription_prompt: string | null
  editing_prompt: string | null
  no_speech_threshold: number | null
  low_quality_threshold: number | null
}

export interface LlmSettings extends LlmSettingsBase {
  id: string
  created_at: Date
  updated_at: Date
  user_id: string
}

export interface AdvancedSettings {
  id: string
  user_id: string
  llm: LlmSettingsBase
  created_at: Date
  updated_at: Date
}
