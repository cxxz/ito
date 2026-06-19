import { create } from '@bufbuild/protobuf'
import { broadcastToAllWindows } from '../../window/broadcast'
import { v4 as uuidv4 } from 'uuid'
import {
  ContextInfoSchema,
  ItoMode,
  LlmSettingsSchema,
  StreamConfigSchema,
  TranscribeStreamRequest,
  TranscribeStreamRequestSchema,
  TranscribeStreamResponse,
} from '@/app/generated/ito_pb'
import { InteractionsTable } from '../sqlite/repo'
import mainStore, { getAdvancedSettings } from '../store'
import { STORE_KEYS } from '../../constants/store-keys'
import { contextGrabber, ContextData } from '../context/ContextGrabber'
import { grpcClient } from '../../clients/grpcClient'
import { interactionManager } from './InteractionManager'
import { Code } from '@connectrpc/connect'

const AUDIO_CHUNK_SIZE_BYTES = 3200
const MINIMUM_AUDIO_DURATION_MS = 100

type RetranscribeResult = {
  interactionId: string
  error?: string
}

const getAudioDurationMs = (audioBuffer: Buffer, sampleRate: number) => {
  const totalSamples = audioBuffer.length / 2
  const durationSeconds = totalSamples / sampleRate
  return Math.floor(durationSeconds * 1000)
}

const buildStreamConfig = (
  context: ContextData,
  interactionId: string,
): TranscribeStreamRequest =>
  create(TranscribeStreamRequestSchema, {
    payload: {
      case: 'config',
      value: create(StreamConfigSchema, {
        context: create(ContextInfoSchema, {
          windowTitle: context.windowTitle,
          appName: context.appName,
          contextText: context.contextText,
          mode: ItoMode.TRANSCRIBE,
        }),
        llmSettings: create(LlmSettingsSchema, {
          asrModel: context.advancedSettings.llm.asrModel ?? undefined,
          asrProvider: context.advancedSettings.llm.asrProvider ?? undefined,
          asrPrompt: context.advancedSettings.llm.asrPrompt ?? undefined,
          noSpeechThreshold:
            context.advancedSettings.llm.noSpeechThreshold ?? undefined,
          llmProvider: context.advancedSettings.llm.llmProvider ?? undefined,
          llmModel: context.advancedSettings.llm.llmModel ?? undefined,
          llmTemperature:
            context.advancedSettings.llm.llmTemperature ?? undefined,
          transcriptionPrompt:
            context.advancedSettings.llm.transcriptionPrompt ?? undefined,
          editingPrompt:
            context.advancedSettings.llm.editingPrompt ?? undefined,
          polishEnabled:
            context.advancedSettings.llm.polishEnabled ?? undefined,
          polishLlmProvider:
            context.advancedSettings.llm.polishLlmProvider ?? undefined,
          polishLlmModel:
            context.advancedSettings.llm.polishLlmModel ?? undefined,
          polishLlmTemperature:
            context.advancedSettings.llm.polishLlmTemperature ?? undefined,
        }),
        vocabulary: context.vocabularyWords,
        interactionId,
      }),
    },
  })

async function* streamAudioWithConfig(
  configRequest: TranscribeStreamRequest,
  audioBuffer: Buffer,
): AsyncGenerator<TranscribeStreamRequest> {
  yield configRequest

  for (
    let offset = 0;
    offset < audioBuffer.length;
    offset += AUDIO_CHUNK_SIZE_BYTES
  ) {
    const chunk = audioBuffer.subarray(offset, offset + AUDIO_CHUNK_SIZE_BYTES)
    yield create(TranscribeStreamRequestSchema, {
      payload: {
        case: 'audioData',
        value: chunk,
      },
    })
  }
}

const getErrorDetails = (
  error: unknown,
): { message: string; code?: string } => {
  if (error instanceof Error) {
    const rawCode = (error as { code?: unknown }).code
    if (typeof rawCode === 'number') {
      return {
        message: error.message,
        code: Code[rawCode] ?? String(rawCode),
      }
    }
    if (typeof rawCode === 'string') {
      return { message: error.message, code: rawCode }
    }
    return { message: error.message }
  }

  return { message: String(error) }
}

const createInteractionRecord = async ({
  transcript,
  audioBuffer,
  sampleRate,
  durationMs,
  errorMessage,
  errorCode,
  interactionId,
}: {
  transcript: string
  audioBuffer: Buffer
  sampleRate: number
  durationMs: number
  errorMessage?: string
  errorCode?: string
  interactionId: string
}) => {
  const userProfile = mainStore.get(STORE_KEYS.USER_PROFILE) as any
  const userId = userProfile?.id || 'self-hosted'
  const now = new Date().toISOString()

  const asrOutput = {
    transcript,
    totalAudioBytes: audioBuffer.length,
    error: errorMessage || null,
    errorCode: errorCode || null,
    timestamp: now,
    durationMs,
  }

  const title =
    transcript && transcript.length > 50
      ? `${transcript.substring(0, 50)}...`
      : transcript || 'Voice interaction'

  await InteractionsTable.upsert({
    id: interactionId,
    user_id: userId,
    title,
    asr_output: asrOutput,
    llm_output: errorMessage ? { error: errorMessage } : {},
    raw_audio: audioBuffer.length > 0 ? audioBuffer : null,
    raw_audio_id: null,
    duration_ms: durationMs,
    sample_rate: sampleRate,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  })

  broadcastToAllWindows('interaction-created', {
    id: interactionId,
    transcript,
    timestamp: now,
    durationMs,
  })
}

export const retranscribeInteraction = async (
  originalInteractionId: string,
): Promise<RetranscribeResult> => {
  const interaction = await InteractionsTable.findById(originalInteractionId)
  if (!interaction) {
    throw new Error('Interaction not found')
  }

  if (!interaction.raw_audio || interaction.raw_audio.length === 0) {
    throw new Error('No audio available for retranscription')
  }

  const sampleRate = interaction.sample_rate || 16000
  const durationMs = getAudioDurationMs(interaction.raw_audio, sampleRate)

  const interactionId = uuidv4()

  if (durationMs < MINIMUM_AUDIO_DURATION_MS) {
    const errorMessage = `Audio too short (${durationMs}ms < ${MINIMUM_AUDIO_DURATION_MS}ms)`
    await createInteractionRecord({
      transcript: '',
      audioBuffer: interaction.raw_audio,
      sampleRate,
      durationMs,
      errorMessage,
      errorCode: 'AUDIO_TOO_SHORT',
      interactionId,
    })
    return { interactionId, error: errorMessage }
  }

  let context: ContextData
  try {
    context = await contextGrabber.gatherContext(ItoMode.TRANSCRIBE)
  } catch (error) {
    console.warn(
      '[Retranscribe] Failed to gather context, using defaults:',
      error,
    )
    context = {
      vocabularyWords: [],
      windowTitle: '',
      appName: '',
      contextText: '',
      advancedSettings: getAdvancedSettings(),
    }
  }

  let response: TranscribeStreamResponse
  try {
    response = await grpcClient.transcribeStream(
      streamAudioWithConfig(
        buildStreamConfig(context, interactionId),
        interaction.raw_audio,
      ),
    )
  } catch (error) {
    const { message, code } = getErrorDetails(error)
    await createInteractionRecord({
      transcript: '',
      audioBuffer: interaction.raw_audio,
      sampleRate,
      durationMs,
      errorMessage: message,
      errorCode: code,
      interactionId,
    })
    return { interactionId, error: message }
  }

  if (response.error) {
    await createInteractionRecord({
      transcript: response.transcript || '',
      audioBuffer: interaction.raw_audio,
      sampleRate,
      durationMs,
      errorMessage: response.error.message,
      errorCode: response.error.code,
      interactionId,
    })
    return { interactionId, error: response.error.message }
  }

  await interactionManager.upsertInteractionFromServer({
    interactionId,
    responseTranscript: response.transcript || '',
    audioBuffer: interaction.raw_audio,
    sampleRate,
    durationMs,
    mode: ItoMode.TRANSCRIBE,
  })

  return {
    interactionId,
    error: response.error?.message,
  }
}
