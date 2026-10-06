import OpenAI from 'openai'
import { toFile } from 'openai/uploads'
import * as dotenv from 'dotenv'
import {
  ClientApiKeyError,
  ClientUnavailableError,
  ClientApiError,
  ClientModelError,
  ClientNoSpeechError,
  ClientAudioTooShortError,
  ClientError,
} from './errors.js'
import { ClientProvider } from './providers.js'
import { LlmProvider } from './llmProvider.js'
import {
  getAsrCapabilities,
  getNoSpeechProbability,
} from './asrCapabilities.js'
import { DEFAULT_ADVANCED_SETTINGS } from '../constants/generated-defaults.js'
import { TranscriptionOptions } from './asrConfig.js'
import { IntentTranscriptionOptions } from './intentTranscriptionConfig.js'
import { createAsrPrompt } from '../prompts/transcription.js'

// Load environment variables from .env file
dotenv.config()

export const itoVocabulary = ['Ito', 'Hey Ito']

const DEFAULT_OPENAI_MODEL = 'gpt-5-mini'
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'

/**
 * A TypeScript client for interacting with the OpenAI API.
 */
class OpenaiClient implements LlmProvider {
  private readonly _client: OpenAI
  private readonly _userCommandModel: string
  private readonly _isValid: boolean

  constructor(
    apiKey: string,
    baseURL: string | undefined,
    userCommandModel: string,
  ) {
    if (!apiKey) {
      throw new ClientApiKeyError(ClientProvider.OPENAI)
    }
    this._client = new OpenAI({
      apiKey,
      baseURL: baseURL || DEFAULT_OPENAI_BASE_URL,
    })
    this._userCommandModel = userCommandModel
    this._isValid = true
  }

  /**
   * Checks if the client is configured correctly.
   */
  public get isAvailable(): boolean {
    return this._isValid
  }

  /**
   * Uses a model to adjust/improve a transcript.
   * @param userPrompt The original transcript text.
   * @param options Optional configuration for the adjustment.
   * @returns The adjusted transcript.
   */
  public async adjustTranscript(
    userPrompt: string,
    options?: IntentTranscriptionOptions,
  ): Promise<string> {
    if (!this.isAvailable) {
      throw new ClientUnavailableError(ClientProvider.OPENAI)
    }

    const temperature = options?.temperature ?? 1.0
    const model = options?.model || this._userCommandModel
    const systemPrompt =
      options?.prompt ||
      'Adjust and improve this transcript for clarity and accuracy.'

    try {
      const requestBody = {
        messages: [
          {
            role: 'system' as const,
            content: systemPrompt,
          },
          {
            role: 'user' as const,
            content: userPrompt,
          },
        ],
        model,
        temperature,
      }
      console.log(
        '[OpenaiClient] LLM request body:',
        JSON.stringify(requestBody, null, 2),
      )
      const completion = await this._client.chat.completions.create(requestBody)

      return completion.choices[0]?.message?.content?.trim() || ' '
    } catch (error: any) {
      console.error('An error occurred during transcript adjustment:', error)
      throw new ClientApiError(
        error.message || 'An error occurred during transcript adjustment',
        ClientProvider.OPENAI,
        error,
        error.status || error.statusCode,
      )
    }
  }

  /**
   * Transcribes an audio buffer using the OpenAI API.
   * @param audioBuffer The audio data as a Node.js Buffer.
   * @param options Optional transcription configuration.
   * @returns The transcribed text as a string.
   */
  public async transcribeAudio(
    audioBuffer: Buffer,
    options?: TranscriptionOptions,
  ): Promise<string> {
    console.log('Transcribing audio with OpenAI, options:', options)
    const fileType = options?.fileType || 'webm'
    const asrModel = options?.asrModel
    const vocabulary = options?.vocabulary
    const noSpeechThreshold =
      options?.noSpeechThreshold ?? DEFAULT_ADVANCED_SETTINGS.noSpeechThreshold

    const file = await toFile(audioBuffer, `audio.${fileType}`)
    if (!this.isAvailable) {
      throw new ClientUnavailableError(ClientProvider.OPENAI)
    }
    if (!asrModel) {
      throw new ClientModelError(ClientProvider.OPENAI)
    }

    try {
      console.log(
        `Transcribing ${audioBuffer.length} bytes of audio using OpenAI model ${asrModel}...`,
      )

      const fullVocabulary = [...itoVocabulary, ...(vocabulary || [])]
      const transcriptionPrompt = createAsrPrompt(
        fullVocabulary,
        options?.asrPrompt,
      )

      const capabilities = getAsrCapabilities('openai', asrModel)
      const transcription = await this._client.audio.transcriptions.create({
        file,
        model: asrModel,
        ...(capabilities.prompt ? { prompt: transcriptionPrompt } : {}),
        response_format:
          capabilities.noSpeechProbability && noSpeechThreshold > 0
            ? 'verbose_json'
            : 'json',
      })

      const probability = capabilities.noSpeechProbability
        ? getNoSpeechProbability(
            (transcription as any).segments,
            noSpeechThreshold,
          )
        : undefined
      if (probability !== undefined)
        throw new ClientNoSpeechError(ClientProvider.OPENAI, probability)

      return transcription.text.trim()
    } catch (error: any) {
      console.log(
        `Failed to transcribe audio of size ${audioBuffer.length} bytes with OpenAI.`,
      )
      console.error('An error occurred during OpenAI transcription:', error)
      if (error instanceof ClientError) {
        throw error
      }

      const errorMessage = error.message || 'An unknown error occurred'

      // Check for specific audio too short error
      if (errorMessage.includes('Audio file is too short')) {
        throw new ClientAudioTooShortError(ClientProvider.OPENAI)
      }

      throw new ClientApiError(
        errorMessage,
        ClientProvider.OPENAI,
        error,
        error.status || error.statusCode,
      )
    }
  }
}

// --- Singleton Instance ---
// Create and export a single, pre-configured instance of the client for use across the server.
// Check for OPENAI_API_KEY and create client if available
const apiKey = process.env.OPENAI_API_KEY
const baseURL = process.env.OPENAI_BASE_URL
const defaultModel = process.env.OPENAI_DEFAULT_LLM || DEFAULT_OPENAI_MODEL

let openaiClient: OpenaiClient | null = null

if (apiKey) {
  try {
    openaiClient = new OpenaiClient(apiKey, baseURL, defaultModel)
    console.log('OpenAI client initialized successfully')
  } catch (error) {
    console.error('Failed to initialize OpenAI client:', error)
    openaiClient = null
  }
} else {
  console.log('OPENAI_API_KEY not set - OpenAI client will not be available')
  openaiClient = null
}

export { openaiClient }
