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

// Load environment variables from .env file
dotenv.config()

const ALIYUN_API_URL =
  'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
const DEFAULT_ASR_MODEL = 'qwen3-asr-flash'

interface ContentItem {
  text?: string
  audio?: string
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
  parameters: {
    asr_options: AsrOptions
  }
}

interface ResponseChoice {
  message: {
    role: string
    content: ContentItem[]
  }
}

interface ApiResponse {
  output: {
    choices: ResponseChoice[]
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

      const payload: RequestPayload = {
        model: asrModel,
        input: {
          messages: [
            {
              role: 'system',
              content: [{ text: '' }],
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

      const response = await fetch(ALIYUN_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this._apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

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

      // Extract transcription from nested response structure
      const transcription =
        result?.output?.choices?.[0]?.message?.content?.[0]?.text

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
