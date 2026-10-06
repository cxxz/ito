import * as dotenv from 'dotenv'
import {
  ClientUnavailableError,
  ClientModelError,
  ClientApiError,
  ClientError,
  ClientAudioTooShortError,
} from './errors.js'
import { ClientProvider } from './providers.js'
import { LlmProvider } from './llmProvider.js'
import { TranscriptionOptions } from './asrConfig.js'
import { IntentTranscriptionOptions } from './intentTranscriptionConfig.js'
import { createAsrPrompt } from '../prompts/transcription.js'

// Load environment variables from .env file
dotenv.config()

const ALIYUN_API_URL =
  'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
const QWENCLOUD_API_URL =
  'https://maas.qwencloudapi.com/api/v1/services/aigc/multimodal-generation/generation'
const DEFAULT_ASR_MODEL = 'qwen-audio-3.1-asr-flash'

export const itoVocabulary = ['LLM', 'Claude']

interface ContentItem {
  text?: string
  audio?: string
  type?: 'input_audio'
  input_audio?: {
    data: string
  }
}

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: ContentItem[]
}

interface AsrOptions {
  enable_itn: boolean
  language?: string
}

interface RequestPayload {
  model: string
  input: {
    messages: Message[]
  }
  parameters:
    | { asr_options: AsrOptions }
    | {
        format: 'wav'
        sample_rate: '16000'
        vocabulary: Record<string, number>
      }
}

interface ResponseChoice {
  message: {
    role: string
    content: ContentItem[]
  }
}

interface ApiResponse {
  output?: {
    choices?: ResponseChoice[]
    output?: {
      sentence?: {
        text?: string
      }
    }
    text?: string
  }
  usage?: {
    input_tokens: number
    output_tokens: number
  }
  request_id?: string
  code?: string
  message?: string
}

/**
 * A TypeScript client for interacting with the Aliyun DashScope API for ASR.
 */
class AliyunClient implements LlmProvider {
  private readonly _apiKey: string
  private readonly _isValid: boolean

  constructor(apiKey: string) {
    this._apiKey = apiKey
    this._isValid = !!apiKey
  }

  /**
   * Checks if the client is configured correctly.
   */
  public get isAvailable(): boolean {
    return this._isValid
  }

  /**
   * Aliyun ASR does not support transcript adjustment - this is an ASR-only model.
   */
  public async adjustTranscript(
    _userPrompt: string,
    _options?: IntentTranscriptionOptions,
  ): Promise<string> {
    throw new ClientUnavailableError(ClientProvider.ALIYUN)
  }

  /**
   * Transcribes an audio buffer using the Aliyun DashScope API.
   * @param audioBuffer The audio data as a Node.js Buffer (WAV format expected).
   * @param options Optional transcription configuration.
   * @returns The transcribed text as a string.
   */
  public async transcribeAudio(
    audioBuffer: Buffer,
    options?: TranscriptionOptions,
  ): Promise<string> {
    console.log('Transcribing audio with Aliyun, options:', options)

    if (!this.isAvailable) {
      throw new ClientUnavailableError(ClientProvider.ALIYUN)
    }

    const asrModel = options?.asrModel || DEFAULT_ASR_MODEL
    if (!asrModel) {
      throw new ClientModelError(ClientProvider.ALIYUN)
    }

    try {
      console.log(
        `Transcribing ${audioBuffer.length} bytes of audio using Aliyun model ${asrModel}...`,
      )

      // Convert audio buffer to base64 data URL
      const base64Audio = audioBuffer.toString('base64')
      const dataUrl = `data:audio/wav;base64,${base64Audio}`

      // Qwen-Audio uses a different request and response format from Qwen3-ASR.
      const isQwenAudioAsr = asrModel === 'qwen-audio-3.1-asr-flash'
      const vocabulary = options?.vocabulary
      const fullVocabulary = [...itoVocabulary, ...(vocabulary || [])]

      const payload: RequestPayload = isQwenAudioAsr
        ? {
            model: asrModel,
            input: {
              messages: [
                {
                  role: 'user',
                  content: [
                    { type: 'input_audio', input_audio: { data: dataUrl } },
                  ],
                },
              ],
            },
            parameters: {
              format: 'wav',
              sample_rate: '16000',
              vocabulary: Object.fromEntries(
                fullVocabulary
                  .map(word => word.trim())
                  .filter(Boolean)
                  .map(word => [word, 5]),
              ),
            },
          }
        : {
            model: asrModel,
            input: {
              messages: [
                {
                  role: 'system',
                  content: [
                    {
                      text: createAsrPrompt(fullVocabulary, options?.asrPrompt),
                    },
                  ],
                },
                {
                  role: 'user',
                  content: [{ audio: dataUrl }],
                },
              ],
            },
            parameters: {
              asr_options: {
                enable_itn: false,
              },
            },
          }

      console.log(
        'Aliyun request payload:',
        JSON.stringify(
          {
            ...payload,
            input: {
              messages: payload.input.messages.map(m => ({
                ...m,
                content: m.content.map(c => {
                  if (c.audio) {
                    return { ...c, audio: '[BASE64_AUDIO_OMITTED]' }
                  }
                  if (c.input_audio) {
                    return {
                      ...c,
                      input_audio: { data: '[BASE64_AUDIO_OMITTED]' },
                    }
                  }
                  return c
                }),
              })),
            },
          },
          null,
          2,
        ),
      )

      const response = await fetch(
        isQwenAudioAsr ? QWENCLOUD_API_URL : ALIYUN_API_URL,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this._apiKey}`,
            'Content-Type': 'application/json',
            ...(isQwenAudioAsr ? { 'X-DashScope-SSE': 'disable' } : {}),
          },
          body: JSON.stringify(payload),
        },
      )

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`API request failed: ${response.status} - ${errorText}`)
      }

      const result: ApiResponse = await response.json()

      // Check for API-level errors in the response body
      if (result.code && result.message) {
        const errorMessage = result.message || 'An unknown error occurred'

        // Check for specific audio too short error
        if (
          errorMessage.toLowerCase().includes('audio') &&
          errorMessage.toLowerCase().includes('short')
        ) {
          throw new ClientAudioTooShortError(ClientProvider.ALIYUN)
        }

        throw new ClientApiError(
          errorMessage,
          ClientProvider.ALIYUN,
          new Error(errorMessage),
        )
      }

      const transcription = isQwenAudioAsr
        ? (result?.output?.output?.sentence?.text ?? result?.output?.text)
        : result?.output?.choices?.[0]?.message?.content?.[0]?.text

      if (transcription === undefined || transcription === null) {
        console.log('Aliyun API response:', JSON.stringify(result, null, 2))
        throw new ClientApiError(
          'No transcription text in response',
          ClientProvider.ALIYUN,
        )
      }

      return transcription.trim()
    } catch (error: any) {
      console.log(
        `Failed to transcribe audio of size ${audioBuffer.length} bytes with Aliyun.`,
      )
      console.error('An error occurred during Aliyun transcription:', error)

      if (error instanceof ClientError) {
        throw error
      }

      const errorMessage = error.message || 'An unknown error occurred'

      // Check for specific audio too short error
      if (
        errorMessage.toLowerCase().includes('audio') &&
        errorMessage.toLowerCase().includes('short')
      ) {
        throw new ClientAudioTooShortError(ClientProvider.ALIYUN)
      }

      // Re-throw the error to be handled by the caller
      throw new ClientApiError(
        errorMessage,
        ClientProvider.ALIYUN,
        error,
        error.status || error.statusCode,
      )
    }
  }
}

// --- Singleton Instance ---
// Create and export a single, pre-configured instance of the client for use across the server.
// Unlike Groq, we don't crash if the API key is missing - just mark as unavailable.
const apiKey = process.env.ALIYUN_API_KEY || ''

export const aliyunClient = apiKey ? new AliyunClient(apiKey) : null
