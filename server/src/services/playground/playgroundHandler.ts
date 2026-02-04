import { create } from '@bufbuild/protobuf'
import {
  PlaygroundRunRequest,
  PlaygroundRunResponse,
  PlaygroundRunResponseSchema,
  PlaygroundPolishRequest,
  PlaygroundPolishResponse,
  PlaygroundPolishResponseSchema,
  ItoMode,
} from '../../generated/ito_pb.js'
import { getAsrProvider, getLlmProvider } from '../../clients/providerUtils.js'
import { DEFAULT_ADVANCED_SETTINGS } from '../../constants/generated-defaults.js'
import { errorToProtobuf } from '../../clients/errors.js'
import { createUserPromptWithContext } from '../ito/helpers.js'
import { createPolishPrompt } from '../../prompts/polishPrompt.js'
import {
  getDefaultLlmModel,
  getDefaultAsrModel,
  ITO_MODE_SYSTEM_PROMPT,
} from '../ito/constants.js'
import { prepareAudioForTranscription } from '../../utils/audioProcessing.js'

/**
 * Handles playground transcription and polish requests.
 * This is a simplified version of transcribeStreamHandler that:
 * - Uses uploaded audio instead of streaming
 * - Optionally runs polish (controlled by skipPolish flag)
 * - Returns both ASR output and polished output
 * - Does NOT create interaction records (playground is experimental)
 */
export async function handlePlaygroundRun(
  request: PlaygroundRunRequest,
): Promise<PlaygroundRunResponse> {
  console.log(
    `[Playground] Starting run with ${request.audioData.length} bytes, ` +
      `sampleRate=${request.sampleRate}, vocabulary=${request.customVocabulary.length} words, ` +
      `skipPolish=${request.skipPolish}`,
  )

  let asrOutput = ''
  let polishedOutput = ''
  let asrError = null
  let polishError = null

  try {
    // 1. Prepare audio for transcription (convert to WAV format)
    const audioBuffer = Buffer.from(request.audioData)
    const audioWav = prepareAudioForTranscription(audioBuffer)

    // 2. Get ASR provider and transcribe
    // Priority: request > env var > default
    const asrProvider =
      request.asrProvider ||
      process.env.ASR_PROVIDER ||
      DEFAULT_ADVANCED_SETTINGS.asrProvider
    const asrModel =
      request.asrModel || getDefaultAsrModel(asrProvider)
    const asrClient = getAsrProvider(asrProvider)

    console.log(`[Playground] Transcribing with ${asrProvider}/${asrModel}`)

    try {
      asrOutput = await asrClient.transcribeAudio(audioWav, {
        fileType: 'wav',
        asrModel,
        vocabulary: request.customVocabulary,
      })
      console.log(`[Playground] ASR output: "${asrOutput}"`)
    } catch (error) {
      console.error('[Playground] ASR failed:', error)
      asrError = errorToProtobuf(error, asrProvider as any)
      // Return early with error
      return create(PlaygroundRunResponseSchema, {
        asrOutput: '',
        polishedOutput: '',
        asrError,
      })
    }

    // 3. Run polish LLM (unless skipPolish is true)
    if (request.skipPolish) {
      console.log('[Playground] Skipping polish (transcribe-only mode)')
      polishedOutput = ''
    } else {
      const polishProvider =
        request.polishLlmProvider || DEFAULT_ADVANCED_SETTINGS.polishLlmProvider
      const polishModel =
        request.polishLlmModel || getDefaultLlmModel(polishProvider)
      const polishTemperature =
        request.polishLlmTemperature ??
        DEFAULT_ADVANCED_SETTINGS.polishLlmTemperature

      console.log(
        `[Playground] Polishing with ${polishProvider}/${polishModel} temp=${polishTemperature}`,
      )

      try {
        const llmProvider = getLlmProvider(polishProvider)

        // Build the prompt similar to transcribeStreamHandler
        const basePrompt = DEFAULT_ADVANCED_SETTINGS.transcriptionPrompt
        const transcriptionPrompt = createPolishPrompt(
          basePrompt,
          request.customVocabulary,
        )
        const userPrompt = createUserPromptWithContext(asrOutput, undefined)

        polishedOutput = await llmProvider.adjustTranscript(
          transcriptionPrompt + '\n' + userPrompt,
          {
            temperature: polishTemperature,
            model: polishModel,
            prompt: ITO_MODE_SYSTEM_PROMPT[ItoMode.TRANSCRIBE],
          },
        )
        console.log(`[Playground] Polished output: "${polishedOutput}"`)
      } catch (error) {
        console.error('[Playground] Polish failed:', error)
        polishError = errorToProtobuf(error, polishProvider as any)
        // Still return ASR output even if polish fails
        polishedOutput = asrOutput
      }
    }
  } catch (error) {
    console.error('[Playground] Unexpected error:', error)
    // Return a general error
    return create(PlaygroundRunResponseSchema, {
      asrOutput: '',
      polishedOutput: '',
      asrError: errorToProtobuf(error, 'groq' as any),
    })
  }

  return create(PlaygroundRunResponseSchema, {
    asrOutput,
    polishedOutput,
    asrError: asrError ?? undefined,
    polishError: polishError ?? undefined,
  })
}

/**
 * Handles playground polish-only requests.
 * Takes raw transcript text and polishes it using the provided settings.
 * Allows user to customize the transcription prompt.
 */
export async function handlePlaygroundPolish(
  request: PlaygroundPolishRequest,
): Promise<PlaygroundPolishResponse> {
  console.log(
    `[Playground] Starting polish with transcript length=${request.transcript.length}, ` +
      `provider=${request.polishLlmProvider}, model=${request.polishLlmModel}`,
  )

  try {
    const polishProvider =
      request.polishLlmProvider || DEFAULT_ADVANCED_SETTINGS.polishLlmProvider
    const polishModel =
      request.polishLlmModel || getDefaultLlmModel(polishProvider)
    const polishTemperature =
      request.polishLlmTemperature ??
      DEFAULT_ADVANCED_SETTINGS.polishLlmTemperature

    // Use the custom transcription prompt from the request, or fall back to default
    const basePrompt =
      request.transcriptionPrompt || DEFAULT_ADVANCED_SETTINGS.transcriptionPrompt
    const transcriptionPrompt = createPolishPrompt(basePrompt, [])

    console.log(
      `[Playground] Polishing with ${polishProvider}/${polishModel} temp=${polishTemperature}`,
    )

    const llmProvider = getLlmProvider(polishProvider)
    const userPrompt = createUserPromptWithContext(request.transcript, undefined)

    const polishedOutput = await llmProvider.adjustTranscript(
      transcriptionPrompt + '\n' + userPrompt,
      {
        temperature: polishTemperature,
        model: polishModel,
        prompt: ITO_MODE_SYSTEM_PROMPT[ItoMode.TRANSCRIBE],
      },
    )

    console.log(`[Playground] Polished output: "${polishedOutput}"`)

    return create(PlaygroundPolishResponseSchema, {
      polishedOutput,
    })
  } catch (error) {
    console.error('[Playground] Polish failed:', error)
    const polishProvider =
      request.polishLlmProvider || DEFAULT_ADVANCED_SETTINGS.polishLlmProvider
    return create(PlaygroundPolishResponseSchema, {
      polishedOutput: '',
      error: errorToProtobuf(error, polishProvider as any),
    })
  }
}
