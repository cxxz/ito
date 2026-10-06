import { afterAll, beforeEach, expect, mock, test } from 'bun:test'
const previousKey = process.env.OPENAI_API_KEY
process.env.OPENAI_API_KEY = 'test-key'
const createTranscription = mock(async (_request: any) => ({
  text: ' Hello world ',
  segments: [] as any[],
}))
mock.module('dotenv', () => ({ config: () => ({}) }))
mock.module('openai', () => ({
  default: class {
    audio = { transcriptions: { create: createTranscription } }
  },
}))
mock.module('openai/uploads', () => ({
  toFile: async (_buffer: Buffer, name: string) => ({ name }),
}))
const { openaiClient } = await import('./openaiClient.js')
beforeEach(() => {
  createTranscription.mockClear()
  createTranscription.mockResolvedValue({ text: ' Hello world ', segments: [] })
})
afterAll(() => {
  if (previousKey === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = previousKey
})
test('sends the custom prompt and dictionary and requests Whisper silence probabilities', async () => {
  expect(
    await openaiClient!.transcribeAudio(Buffer.from('audio'), {
      asrModel: 'whisper-1',
      asrPrompt: 'Medical consultation',
      vocabulary: ['café'],
      noSpeechThreshold: 0.6,
    }),
  ).toBe('Hello world')
  const prompt = createTranscription.mock.calls[0]![0].prompt
  expect(prompt).toContain('café')
  expect(createTranscription.mock.calls[0]![0]).toMatchObject({
    prompt: expect.stringContaining(
      'Medical consultation\nDictionary entries include:',
    ),
    response_format: 'verbose_json',
  })
})
test('rejects confidently silent recordings without rejecting speech after a silent first segment', async () => {
  createTranscription.mockResolvedValueOnce({
    text: 'hallucination',
    segments: [{ no_speech_prob: 0.99 }],
  })
  await expect(
    openaiClient!.transcribeAudio(Buffer.from('audio'), {
      asrModel: 'whisper-1',
      noSpeechThreshold: 0.6,
    }),
  ).rejects.toThrow('No speech detected')
  createTranscription.mockResolvedValueOnce({
    text: 'valid speech',
    segments: [{ no_speech_prob: 0.99 }, { no_speech_prob: 0.1 }],
  })
  expect(
    await openaiClient!.transcribeAudio(Buffer.from('audio'), {
      asrModel: 'whisper-1',
      noSpeechThreshold: 0.6,
    }),
  ).toBe('valid speech')
})
test('uses JSON for newer models and omits unsupported prompts for diarization', async () => {
  await openaiClient!.transcribeAudio(Buffer.from('audio'), {
    asrModel: 'gpt-4o-transcribe',
    noSpeechThreshold: 0.6,
  })
  expect(createTranscription.mock.calls[0]![0].response_format).toBe('json')
  await openaiClient!.transcribeAudio(Buffer.from('audio'), {
    asrModel: 'gpt-4o-transcribe-diarize',
    asrPrompt: 'Unsupported',
  })
  expect(createTranscription.mock.calls[1]![0]).not.toHaveProperty('prompt')
})
test('a zero threshold disables silence rejection', async () => {
  createTranscription.mockResolvedValueOnce({
    text: 'retained',
    segments: [{ no_speech_prob: 1 }],
  })
  expect(
    await openaiClient!.transcribeAudio(Buffer.from('audio'), {
      asrModel: 'whisper-1',
      noSpeechThreshold: 0,
    }),
  ).toBe('retained')
  expect(createTranscription.mock.calls[0]![0].response_format).toBe('json')
})
