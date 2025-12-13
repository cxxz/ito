import { describe, expect, test } from 'bun:test'
import { DEFAULT_ADVANCED_SETTINGS } from '../../constants/generated-defaults.js'
import {
  getDefaultAdvancedSettingsStruct,
  getDefaultLlmModel,
  getProviderDefaultLlmModels,
} from './constants.js'

describe('getDefaultAdvancedSettingsStruct', () => {
  test('uses ASR_PROVIDER to override defaults and selects provider default model', () => {
    const originalProvider = process.env.ASR_PROVIDER
    const originalModel = process.env.ASR_MODEL

    try {
      process.env.ASR_PROVIDER = 'aliyun'
      delete process.env.ASR_MODEL

      const defaults = getDefaultAdvancedSettingsStruct()
      expect(defaults.asrProvider).toBe('aliyun')
      expect(defaults.asrModel).toBe('qwen3-asr-flash')
    } finally {
      if (originalProvider === undefined) delete process.env.ASR_PROVIDER
      else process.env.ASR_PROVIDER = originalProvider

      if (originalModel === undefined) delete process.env.ASR_MODEL
      else process.env.ASR_MODEL = originalModel
    }
  })

  test('uses ASR_MODEL to override provider default model', () => {
    const originalProvider = process.env.ASR_PROVIDER
    const originalModel = process.env.ASR_MODEL

    try {
      process.env.ASR_PROVIDER = 'aliyun'
      process.env.ASR_MODEL = 'custom-asr-model'

      const defaults = getDefaultAdvancedSettingsStruct()
      expect(defaults.asrProvider).toBe('aliyun')
      expect(defaults.asrModel).toBe('custom-asr-model')
    } finally {
      if (originalProvider === undefined) delete process.env.ASR_PROVIDER
      else process.env.ASR_PROVIDER = originalProvider

      if (originalModel === undefined) delete process.env.ASR_MODEL
      else process.env.ASR_MODEL = originalModel
    }
  })

  test('falls back to generated defaults when ASR_PROVIDER is empty', () => {
    const originalProvider = process.env.ASR_PROVIDER
    const originalModel = process.env.ASR_MODEL

    try {
      process.env.ASR_PROVIDER = '   '
      delete process.env.ASR_MODEL

      const defaults = getDefaultAdvancedSettingsStruct()
      expect(defaults.asrProvider).toBe(DEFAULT_ADVANCED_SETTINGS.asrProvider)
      expect(defaults.asrModel).toBe(DEFAULT_ADVANCED_SETTINGS.asrModel)
    } finally {
      if (originalProvider === undefined) delete process.env.ASR_PROVIDER
      else process.env.ASR_PROVIDER = originalProvider

      if (originalModel === undefined) delete process.env.ASR_MODEL
      else process.env.ASR_MODEL = originalModel
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
