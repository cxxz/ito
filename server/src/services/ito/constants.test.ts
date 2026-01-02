import { describe, expect, test } from 'bun:test'
import { DEFAULT_ADVANCED_SETTINGS } from '../../constants/generated-defaults.js'
import {
  getDefaultAdvancedSettingsStruct,
  getDefaultAsrModel,
  getDefaultLlmModel,
  getProviderDefaultAsrModels,
  getProviderDefaultLlmModels,
} from './constants.js'

describe('getDefaultAdvancedSettingsStruct', () => {
  test('uses ASR_PROVIDER to override defaults and selects provider default model', () => {
    const originalProvider = process.env.ASR_PROVIDER

    try {
      process.env.ASR_PROVIDER = 'aliyun'

      const defaults = getDefaultAdvancedSettingsStruct()
      expect(defaults.asrProvider).toBe('aliyun')
      expect(defaults.asrModel).toBe('qwen3-asr-flash')
    } finally {
      if (originalProvider === undefined) delete process.env.ASR_PROVIDER
      else process.env.ASR_PROVIDER = originalProvider
    }
  })

  test('uses ALIYUN_DEFAULT_ASR_MODEL to override aliyun provider default model', () => {
    const originalProvider = process.env.ASR_PROVIDER
    const originalModel = process.env.ALIYUN_DEFAULT_ASR_MODEL

    try {
      process.env.ASR_PROVIDER = 'aliyun'
      process.env.ALIYUN_DEFAULT_ASR_MODEL = 'custom-aliyun-asr-model'

      const defaults = getDefaultAdvancedSettingsStruct()
      expect(defaults.asrProvider).toBe('aliyun')
      expect(defaults.asrModel).toBe('custom-aliyun-asr-model')
    } finally {
      if (originalProvider === undefined) delete process.env.ASR_PROVIDER
      else process.env.ASR_PROVIDER = originalProvider

      if (originalModel === undefined) delete process.env.ALIYUN_DEFAULT_ASR_MODEL
      else process.env.ALIYUN_DEFAULT_ASR_MODEL = originalModel
    }
  })

  test('falls back to generated defaults when ASR_PROVIDER is empty', () => {
    const originalProvider = process.env.ASR_PROVIDER

    try {
      process.env.ASR_PROVIDER = '   '

      const defaults = getDefaultAdvancedSettingsStruct()
      expect(defaults.asrProvider).toBe(DEFAULT_ADVANCED_SETTINGS.asrProvider)
      expect(defaults.asrModel).toBe(DEFAULT_ADVANCED_SETTINGS.asrModel)
    } finally {
      if (originalProvider === undefined) delete process.env.ASR_PROVIDER
      else process.env.ASR_PROVIDER = originalProvider
    }
  })

  test('uses CEREBRAS_DEFAULT_LLM for default LLM model when set', () => {
    const originalDefault = process.env.CEREBRAS_DEFAULT_LLM
    try {
      process.env.CEREBRAS_DEFAULT_LLM = 'custom-cerebras-model'
      const defaults = getDefaultAdvancedSettingsStruct()
      expect(defaults.llmProvider).toBe(DEFAULT_ADVANCED_SETTINGS.llmProvider)
      expect(defaults.llmModel).toBe('custom-cerebras-model')
    } finally {
      if (originalDefault === undefined) delete process.env.CEREBRAS_DEFAULT_LLM
      else process.env.CEREBRAS_DEFAULT_LLM = originalDefault
    }
  })
})

describe('getProviderDefaultAsrModels', () => {
  test('uses GROQ_DEFAULT_ASR_MODEL when set', () => {
    const originalDefault = process.env.GROQ_DEFAULT_ASR_MODEL
    try {
      process.env.GROQ_DEFAULT_ASR_MODEL = 'whisper-custom'
      const defaults = getProviderDefaultAsrModels()
      expect(defaults.groq).toBe('whisper-custom')
    } finally {
      if (originalDefault === undefined) delete process.env.GROQ_DEFAULT_ASR_MODEL
      else process.env.GROQ_DEFAULT_ASR_MODEL = originalDefault
    }
  })

  test('falls back to whisper-large-v3-turbo when GROQ_DEFAULT_ASR_MODEL is empty', () => {
    const originalDefault = process.env.GROQ_DEFAULT_ASR_MODEL
    try {
      process.env.GROQ_DEFAULT_ASR_MODEL = '   '
      const defaults = getProviderDefaultAsrModels()
      expect(defaults.groq).toBe('whisper-large-v3-turbo')
    } finally {
      if (originalDefault === undefined) delete process.env.GROQ_DEFAULT_ASR_MODEL
      else process.env.GROQ_DEFAULT_ASR_MODEL = originalDefault
    }
  })

  test('uses ALIYUN_DEFAULT_ASR_MODEL when set', () => {
    const originalDefault = process.env.ALIYUN_DEFAULT_ASR_MODEL
    try {
      process.env.ALIYUN_DEFAULT_ASR_MODEL = 'qwen-custom'
      const defaults = getProviderDefaultAsrModels()
      expect(defaults.aliyun).toBe('qwen-custom')
    } finally {
      if (originalDefault === undefined) delete process.env.ALIYUN_DEFAULT_ASR_MODEL
      else process.env.ALIYUN_DEFAULT_ASR_MODEL = originalDefault
    }
  })
})

describe('getDefaultAsrModel', () => {
  test('uses GROQ_DEFAULT_ASR_MODEL when set for groq provider', () => {
    const originalDefault = process.env.GROQ_DEFAULT_ASR_MODEL
    try {
      process.env.GROQ_DEFAULT_ASR_MODEL = 'whisper-custom'
      expect(getDefaultAsrModel('groq')).toBe('whisper-custom')
    } finally {
      if (originalDefault === undefined) delete process.env.GROQ_DEFAULT_ASR_MODEL
      else process.env.GROQ_DEFAULT_ASR_MODEL = originalDefault
    }
  })

  test('uses ALIYUN_DEFAULT_ASR_MODEL when set for aliyun provider', () => {
    const originalDefault = process.env.ALIYUN_DEFAULT_ASR_MODEL
    try {
      process.env.ALIYUN_DEFAULT_ASR_MODEL = 'qwen-custom'
      expect(getDefaultAsrModel('aliyun')).toBe('qwen-custom')
    } finally {
      if (originalDefault === undefined) delete process.env.ALIYUN_DEFAULT_ASR_MODEL
      else process.env.ALIYUN_DEFAULT_ASR_MODEL = originalDefault
    }
  })
})

describe('getProviderDefaultLlmModels', () => {
  test('uses OPENAI_DEFAULT_LLM when set', () => {
    const originalDefault = process.env.OPENAI_DEFAULT_LLM
    try {
      process.env.OPENAI_DEFAULT_LLM = 'gpt-5.2'
      const defaults = getProviderDefaultLlmModels()
      expect(defaults.openai).toBe('gpt-5.2')
    } finally {
      if (originalDefault === undefined) delete process.env.OPENAI_DEFAULT_LLM
      else process.env.OPENAI_DEFAULT_LLM = originalDefault
    }
  })

  test('falls back to gpt-5-mini when OPENAI_DEFAULT_LLM is empty', () => {
    const originalDefault = process.env.OPENAI_DEFAULT_LLM
    try {
      process.env.OPENAI_DEFAULT_LLM = '   '
      const defaults = getProviderDefaultLlmModels()
      expect(defaults.openai).toBe('gpt-5-mini')
    } finally {
      if (originalDefault === undefined) delete process.env.OPENAI_DEFAULT_LLM
      else process.env.OPENAI_DEFAULT_LLM = originalDefault
    }
  })
})

describe('getDefaultLlmModel', () => {
  test('uses OPENAI_DEFAULT_LLM when set', () => {
    const originalDefault = process.env.OPENAI_DEFAULT_LLM
    try {
      process.env.OPENAI_DEFAULT_LLM = 'gpt-5.2'
      expect(getDefaultLlmModel('openai')).toBe('gpt-5.2')
    } finally {
      if (originalDefault === undefined) delete process.env.OPENAI_DEFAULT_LLM
      else process.env.OPENAI_DEFAULT_LLM = originalDefault
    }
  })
})
