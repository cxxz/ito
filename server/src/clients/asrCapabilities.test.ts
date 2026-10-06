import { expect, test } from 'bun:test'
import {
  getAsrCapabilities,
  getNoSpeechProbability,
} from './asrCapabilities.js'
test('capabilities distinguish Whisper, newer OpenAI models, diarization and the two Qwen APIs', () => {
  expect(getAsrCapabilities('openai', 'whisper-1')).toEqual({
    prompt: true,
    noSpeechProbability: true,
  })
  expect(getAsrCapabilities('openai', 'gpt-4o-transcribe')).toEqual({
    prompt: true,
    noSpeechProbability: false,
  })
  expect(getAsrCapabilities('openai', 'gpt-4o-transcribe-diarize')).toEqual({
    prompt: false,
    noSpeechProbability: false,
  })
  expect(getAsrCapabilities('groq', 'whisper-large-v3-turbo')).toEqual({
    prompt: true,
    noSpeechProbability: true,
  })
  expect(getAsrCapabilities('aliyun', 'qwen3-asr-flash')).toEqual({
    prompt: true,
    noSpeechProbability: false,
  })
  expect(getAsrCapabilities('aliyun', 'qwen-audio-3.1-asr-flash')).toEqual({
    prompt: false,
    noSpeechProbability: false,
  })
})
test('incomplete, invalid or mixed probabilities cannot discard genuine speech', () => {
  for (const segments of [
    undefined,
    [],
    [{ no_speech_prob: NaN }],
    [{ no_speech_prob: 1 }, {}],
    [{ no_speech_prob: 1 }, { no_speech_prob: 0.1 }],
  ])
    expect(getNoSpeechProbability(segments, 0.6)).toBeUndefined()
  expect(
    getNoSpeechProbability(
      [{ no_speech_prob: 0.8 }, { no_speech_prob: 0.9 }],
      0.6,
    ),
  ).toBe(0.8)
})
