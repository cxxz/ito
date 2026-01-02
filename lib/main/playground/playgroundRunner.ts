import { grpcClient } from '../../clients/grpcClient'
import { DictionaryTable } from '../sqlite/repo'
import { getCurrentUserId } from '../store'

export interface PlaygroundRunRequest {
  audioBuffer: Buffer
  sampleRate: number
  customVocabulary: string[]
  asrProvider: string
  asrModel: string
  polishLlmProvider: string
  polishLlmModel: string
  polishLlmTemperature: number
  skipPolish?: boolean
}

export interface PlaygroundRunResult {
  asrOutput: string
  polishedOutput: string
  asrError?: {
    code: string
    message: string
  }
  polishError?: {
    code: string
    message: string
  }
}

export interface PlaygroundPolishRequest {
  transcript: string
  transcriptionPrompt: string
  polishLlmProvider: string
  polishLlmModel: string
  polishLlmTemperature: number
}

export interface PlaygroundPolishResult {
  polishedOutput: string
  error?: {
    code: string
    message: string
  }
}

/**
 * Runs the playground transcription and polish pipeline.
 * This fetches dictionary vocabulary and combines it with custom vocabulary,
 * then calls the server to transcribe and polish the audio.
 */
export async function runPlayground(
  request: PlaygroundRunRequest,
): Promise<PlaygroundRunResult> {
  console.log(
    `[PlaygroundRunner] Starting with ${request.audioBuffer.length} bytes, ` +
      `sampleRate=${request.sampleRate}, customVocab=${request.customVocabulary.length} words`,
  )

  // Fetch dictionary vocabulary
  let dictionaryVocabulary: string[] = []
  try {
    const userId = getCurrentUserId()
    const dictionaryItems = await DictionaryTable.findAll(userId)
    dictionaryVocabulary = dictionaryItems
      .filter(item => item.deleted_at === null)
      .map(item => item.word)
    console.log(
      `[PlaygroundRunner] Loaded ${dictionaryVocabulary.length} dictionary words`,
    )
  } catch (error) {
    console.error('[PlaygroundRunner] Error loading dictionary:', error)
    // Continue without dictionary - custom vocabulary will still be used
  }

  // Combine dictionary with custom vocabulary
  const combinedVocabulary = [
    ...dictionaryVocabulary,
    ...request.customVocabulary,
  ]

  console.log(
    `[PlaygroundRunner] Combined vocabulary: ${combinedVocabulary.length} words`,
  )

  // Call the server
  const response = await grpcClient.playgroundRun({
    audioData: new Uint8Array(request.audioBuffer),
    sampleRate: request.sampleRate,
    customVocabulary: combinedVocabulary,
    asrProvider: request.asrProvider,
    asrModel: request.asrModel,
    polishLlmProvider: request.polishLlmProvider,
    polishLlmModel: request.polishLlmModel,
    polishLlmTemperature: request.polishLlmTemperature,
    skipPolish: request.skipPolish,
  })

  console.log('[PlaygroundRunner] Received response from server')

  // Convert response to result format
  const result: PlaygroundRunResult = {
    asrOutput: response.asrOutput,
    polishedOutput: response.polishedOutput,
  }

  if (response.asrError) {
    result.asrError = {
      code: response.asrError.code,
      message: response.asrError.message,
    }
  }

  if (response.polishError) {
    result.polishError = {
      code: response.polishError.code,
      message: response.polishError.message,
    }
  }

  return result
}

/**
 * Runs the playground polish-only pipeline.
 * Takes a raw transcript and polishes it using the provided settings and prompt.
 */
export async function runPlaygroundPolish(
  request: PlaygroundPolishRequest,
): Promise<PlaygroundPolishResult> {
  console.log(
    `[PlaygroundRunner] Starting polish with transcript length=${request.transcript.length}, ` +
      `provider=${request.polishLlmProvider}`,
  )

  // Call the server
  const response = await grpcClient.playgroundPolish({
    transcript: request.transcript,
    transcriptionPrompt: request.transcriptionPrompt,
    polishLlmProvider: request.polishLlmProvider,
    polishLlmModel: request.polishLlmModel,
    polishLlmTemperature: request.polishLlmTemperature,
  })

  console.log('[PlaygroundRunner] Received polish response from server')

  // Convert response to result format
  const result: PlaygroundPolishResult = {
    polishedOutput: response.polishedOutput,
  }

  if (response.error) {
    result.error = {
      code: response.error.code,
      message: response.error.message,
    }
  }

  return result
}
