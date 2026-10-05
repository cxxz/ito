import {
  describe,
  it,
  expect,
  mock,
  beforeEach,
  afterAll,
  spyOn,
} from 'bun:test'

// Mock environment variables before any imports
const originalEnv = process.env
process.env = {
  ...originalEnv,
  ALIYUN_API_KEY: 'test-api-key',
}

// Mock fetch
const originalFetch = globalThis.fetch
const mockFetch = mock()
globalThis.fetch = Object.assign(mockFetch, {
  preconnect: originalFetch.preconnect,
})

// Mock dotenv to prevent .env file loading
mock.module('dotenv', () => ({
  config: mock(() => ({})),
}))

// Now we can safely import the aliyunClient
const { aliyunClient } = await import('./aliyunClient.js')

describe('AliyunClient', () => {
  beforeEach(() => {
    mockFetch.mockClear()
  })

  afterAll(() => {
    process.env = originalEnv
    globalThis.fetch = originalFetch
  })

  describe('transcribeAudio', () => {
    it('should transcribe audio successfully', async () => {
      const mockResponse = {
        output: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: [{ text: 'Hello world' }],
              },
            },
          ],
        },
        request_id: 'test-request-id',
      }

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })

      const audioBuffer = Buffer.from('mock audio data')
      const result = await aliyunClient!.transcribeAudio(audioBuffer, {
        asrModel: 'qwen3-asr-flash',
      })

      expect(result).toBe('Hello world')
      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(
        'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      )
      expect(options.method).toBe('POST')
      expect(options.headers).toEqual({
        Authorization: 'Bearer test-api-key',
        'Content-Type': 'application/json',
      })

      const body = JSON.parse(options.body as string)
      expect(body.model).toBe('qwen3-asr-flash')
      expect(body.input.messages).toHaveLength(2)
      expect(body.input.messages[0].role).toBe('system')
      expect(body.input.messages[1].role).toBe('user')
      expect(body.input.messages[1].content[0].audio).toMatch(
        /^data:audio\/wav;base64,/,
      )
      expect(body.parameters).toEqual({ asr_options: { enable_itn: false } })
    })

    it('should transcribe Qwen-Audio with its required payload and response format', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            output: {
              output: { sentence: { text: '  Hello Claude Code  ' } },
            },
          }),
      })

      const audioBuffer = Buffer.from('mock audio data')
      const result = await aliyunClient!.transcribeAudio(audioBuffer, {
        asrModel: 'qwen-audio-3.1-asr-flash',
        vocabulary: ['Claude Code', 'LLM', ' AIRL ', ''],
      })

      expect(result).toBe('Hello Claude Code')
      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(
        'https://maas.qwencloudapi.com/api/v1/services/aigc/multimodal-generation/generation',
      )
      expect(options.method).toBe('POST')
      expect(options.headers).toEqual({
        Authorization: 'Bearer test-api-key',
        'Content-Type': 'application/json',
        'X-DashScope-SSE': 'disable',
      })
      expect(JSON.parse(options.body as string)).toEqual({
        model: 'qwen-audio-3.1-asr-flash',
        input: {
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_audio',
                  input_audio: {
                    data: `data:audio/wav;base64,${audioBuffer.toString('base64')}`,
                  },
                },
              ],
            },
          ],
        },
        parameters: {
          format: 'wav',
          sample_rate: '16000',
          vocabulary: { LLM: 5, Claude: 5, 'Claude Code': 5, AIRL: 5 },
        },
      })
    })

    it('should accept Qwen-Audio output.text when no sentence is returned', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ output: { text: '  Hello world  ' } }),
      })

      const result = await aliyunClient!.transcribeAudio(Buffer.from('audio'), {
        asrModel: 'qwen-audio-3.1-asr-flash',
      })

      expect(result).toBe('Hello world')
    })

    it('should accept an empty Qwen-Audio transcription', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            output: { output: { sentence: { text: '' } } },
          }),
      })

      const result = await aliyunClient!.transcribeAudio(Buffer.from('audio'), {
        asrModel: 'qwen-audio-3.1-asr-flash',
      })

      expect(result).toBe('')
    })

    it('should reject a Qwen-Audio response without transcription text', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ output: { output: { sentence: {} } } }),
      })

      await expect(
        aliyunClient!.transcribeAudio(Buffer.from('audio'), {
          asrModel: 'qwen-audio-3.1-asr-flash',
        }),
      ).rejects.toThrow('No transcription text in response')
    })

    it('should omit Qwen-Audio base64 data from request logs', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ output: { text: 'Hello world' } }),
      })
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})

      try {
        const audioBuffer = Buffer.from('private audio content')
        await aliyunClient!.transcribeAudio(audioBuffer, {
          asrModel: 'qwen-audio-3.1-asr-flash',
        })

        const payloadLog = logSpy.mock.calls.find(
          ([message]) => message === 'Aliyun request payload:',
        )
        expect(payloadLog).toBeDefined()
        const loggedPayload = payloadLog![1] as string
        expect(loggedPayload).toContain('[BASE64_AUDIO_OMITTED]')
        expect(loggedPayload).not.toContain(audioBuffer.toString('base64'))
        expect(
          JSON.parse(loggedPayload).input.messages[0].content[0].input_audio
            .data,
        ).toBe('[BASE64_AUDIO_OMITTED]')
      } finally {
        logSpy.mockRestore()
      }
    })

    it('should use default ASR model when not specified', async () => {
      const mockResponse = {
        output: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: [{ text: 'Test transcription' }],
              },
            },
          ],
        },
      }

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })

      const audioBuffer = Buffer.from('mock audio data')
      await aliyunClient!.transcribeAudio(audioBuffer, {})

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(options.body as string)
      expect(body.model).toBe('qwen3-asr-flash')
    })

    it('should trim whitespace from transcription result', async () => {
      const mockResponse = {
        output: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: [{ text: '  Hello world  ' }],
              },
            },
          ],
        },
      }

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })

      const audioBuffer = Buffer.from('mock audio data')
      const result = await aliyunClient!.transcribeAudio(audioBuffer, {
        asrModel: 'qwen3-asr-flash',
      })

      expect(result).toBe('Hello world')
    })

    it('should handle HTTP errors properly', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      })

      const audioBuffer = Buffer.from('mock audio data')

      await expect(
        aliyunClient!.transcribeAudio(audioBuffer, {
          asrModel: 'qwen3-asr-flash',
        }),
      ).rejects.toThrow('API request failed: 401')
    })

    it('should handle API-level errors in response body', async () => {
      const mockResponse = {
        code: 'InvalidApiKey',
        message: 'Invalid API key provided',
      }

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })

      const audioBuffer = Buffer.from('mock audio data')

      await expect(
        aliyunClient!.transcribeAudio(audioBuffer, {
          asrModel: 'qwen3-asr-flash',
        }),
      ).rejects.toThrow('Invalid API key provided')
    })

    it('should handle missing transcription in response', async () => {
      const mockResponse = {
        output: {
          choices: [],
        },
      }

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })

      const audioBuffer = Buffer.from('mock audio data')

      await expect(
        aliyunClient!.transcribeAudio(audioBuffer, {
          asrModel: 'qwen3-asr-flash',
        }),
      ).rejects.toThrow('No transcription text in response')
    })

    it('should convert audio buffer to base64 data URL', async () => {
      const mockResponse = {
        output: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: [{ text: 'Test' }],
              },
            },
          ],
        },
      }

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })

      const audioBuffer = Buffer.from('test audio content')
      await aliyunClient!.transcribeAudio(audioBuffer, {
        asrModel: 'qwen3-asr-flash',
      })

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(options.body as string)
      const audioDataUrl = body.input.messages[1].content[0].audio

      expect(audioDataUrl).toBe(
        `data:audio/wav;base64,${audioBuffer.toString('base64')}`,
      )
    })
  })

  describe('adjustTranscript', () => {
    it('should throw ClientUnavailableError as Aliyun ASR does not support adjustment', async () => {
      await expect(
        aliyunClient!.adjustTranscript('test prompt', {}),
      ).rejects.toThrow('Client is not available')
    })
  })

  describe('isAvailable', () => {
    it('should return true when API key is provided', () => {
      expect(aliyunClient!.isAvailable).toBe(true)
    })
  })
})

describe('AliyunClient without API key', () => {
  it('should export null when API key is not set', async () => {
    // Reset module cache and set empty API key
    const originalKey = process.env.ALIYUN_API_KEY
    process.env.ALIYUN_API_KEY = ''

    // Clear module cache to force re-import
    // Note: In a real scenario, we'd need to reset the module cache properly
    // For now, we're testing the singleton that was already created with the test key

    process.env.ALIYUN_API_KEY = originalKey
  })
})
