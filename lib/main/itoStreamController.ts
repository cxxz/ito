import {
  ItoMode,
  TranscribeStreamRequest,
  TranscribeStreamRequestSchema,
  StreamConfigSchema,
  ContextInfoSchema,
  LlmSettingsSchema,
  TranscribeStreamResponse,
  TranscribePhase,
} from '@/app/generated/ito_pb'
import { create } from '@bufbuild/protobuf'
import { grpcClient } from '../clients/grpcClient'
import { AudioStreamManager } from './audio/AudioStreamManager'
import { ContextData } from './context/ContextGrabber'
import log from 'electron-log'
import { timingCollector, TimingEventName } from './timing/TimingCollector'
import { interactionManager } from './interactions/InteractionManager'

/**
 * ItoStreamController manages the lifecycle of a transcription stream using TranscribeStream.
 * It allows sending metadata/config, streaming audio, and updating settings during the stream.
 */
export class ItoStreamController {
  private audioStreamManager = new AudioStreamManager()

  private streamPending = false
  private responseDeadline: ReturnType<typeof setTimeout> | null = null
  private readonly responseTimeoutMs: number

  constructor(responseTimeoutMs = 120_000) {
    this.responseTimeoutMs = responseTimeoutMs
  }

  private hasStartedGrpc = false
  private currentMode: ItoMode = ItoMode.TRANSCRIBE
  private configQueue: TranscribeStreamRequest[] = []
  private abortController: AbortController | null = null

  public async initialize(mode: ItoMode): Promise<boolean> {
    // Guard against multiple concurrent transcriptions
    if (this.streamPending || this.audioStreamManager.isCurrentlyStreaming()) {
      log.warn('[ItoStreamController] Stream already in progress.')
      return false
    }

    this.audioStreamManager = new AudioStreamManager()
    this.audioStreamManager.initialize()
    this.hasStartedGrpc = false
    this.currentMode = mode
    this.configQueue = []
    this.abortController = null
    console.log('[ItoStreamController] Starting new interaction stream.')

    return true
  }

  /**
   * Starts the gRPC stream immediately without waiting for minimum audio duration.
   * Returns a promise that resolves with the transcription response and audio data.
   * @param onPhaseUpdate - Optional callback to receive phase updates (e.g., PHASE_POLISHING)
   */
  public async startGrpcStream(
    onPhaseUpdate?: (phase: TranscribePhase) => void,
  ): Promise<{
    response: TranscribeStreamResponse
    audioBuffer: Buffer
    sampleRate: number
  }> {
    if (this.hasStartedGrpc) {
      log.warn('[ItoStreamController] gRPC stream already started')
      throw new Error('Stream already started')
    }

    console.log('[ItoStreamController] Starting gRPC stream immediately')
    this.hasStartedGrpc = true
    this.streamPending = true
    this.abortController = new AbortController()
    const abortSignal = this.abortController.signal
    const timingEventName =
      this.currentMode === ItoMode.EDIT
        ? TimingEventName.SERVER_EDITING
        : TimingEventName.SERVER_DICTATION

    const audio = this.audioStreamManager
    const configs = this.configQueue
    let onAbort!: () => void
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () =>
        reject(abortSignal.reason ?? new Error('Transcription cancelled'))
      abortSignal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      const response = await Promise.race([
        timingCollector.timeAsync(timingEventName, () =>
          grpcClient.transcribeStream(
            this.createStreamGenerator(audio, configs, abortSignal),
            abortSignal,
            onPhaseUpdate,
          ),
        ),
        aborted,
      ])
      return {
        response,
        audioBuffer: audio.getInteractionAudioBuffer(),
        sampleRate: audio.getCurrentSampleRate(),
      }
    } finally {
      abortSignal.removeEventListener('abort', onAbort)
      if (this.responseDeadline) clearTimeout(this.responseDeadline)
      this.responseDeadline = null
      audio.stopStreaming()
      this.streamPending = false
    }
  }

  public isStreaming(): boolean {
    return this.audioStreamManager.isCurrentlyStreaming()
  }

  public getCurrentMode(): ItoMode {
    return this.currentMode
  }

  public setMode(mode: ItoMode) {
    if (!this.audioStreamManager.isCurrentlyStreaming()) {
      log.warn('[ItoStreamController] Cannot change mode - no active stream')
      return
    }

    this.currentMode = mode
    console.log(`[ItoStreamController] Mode changed to ${mode}`)

    // Send mode update to stream
    this.sendModeUpdate(mode)
  }

  public scheduleConfigUpdate(context: ContextData) {
    if (!this.audioStreamManager.isCurrentlyStreaming()) {
      log.warn('[ItoStreamController] Cannot send config - no active stream')
      return
    }

    console.log('[ItoStreamController] Queueing config update')
    const config = this.buildStreamConfig(context)
    this.configQueue.push(config)
  }

  public scheduleVocabularyUpdate(vocabularyWords: string[]) {
    if (!this.audioStreamManager.isCurrentlyStreaming()) {
      console.warn(
        '[ItoStreamController] Cannot send vocabulary update - no active stream',
      )
      return
    }

    if (vocabularyWords.length === 0) {
      console.log(
        '[ItoStreamController] Skipping vocabulary update (empty list)',
      )
      return
    }

    console.log('[ItoStreamController] Queueing vocabulary update')
    const vocabularyUpdate = create(TranscribeStreamRequestSchema, {
      payload: {
        case: 'config',
        value: create(StreamConfigSchema, {
          vocabulary: vocabularyWords,
        }),
      },
    })

    this.configQueue.push(vocabularyUpdate)
  }

  private sendModeUpdate(mode: ItoMode) {
    console.log(`[ItoStreamController] Sending mode update: ${mode}`)

    // Create a minimal config with just the mode
    // IMPORTANT: Only set the mode field, leave others undefined so server merge works correctly
    const contextInfo = create(ContextInfoSchema, {})
    contextInfo.mode = mode
    // Don't set windowTitle, appName, or contextText - let server keep existing values

    const modeUpdate = create(TranscribeStreamRequestSchema, {
      payload: {
        case: 'config',
        value: create(StreamConfigSchema, {
          context: contextInfo,
        }),
      },
    })

    this.configQueue.push(modeUpdate)
  }

  public endInteraction() {
    if (!this.audioStreamManager.isCurrentlyStreaming()) {
      log.warn('[ItoStreamController] No active stream to end')
      return
    }

    console.log('[ItoStreamController] Ending interaction stream')
    this.stopStreaming()
    if (this.streamPending && !this.responseDeadline) {
      this.responseDeadline = setTimeout(() => {
        this.abortController?.abort(
          new Error('Transcription response timed out'),
        )
      }, this.responseTimeoutMs)
      this.responseDeadline.unref?.()
    }
  }

  public cancelTranscription() {
    if (
      !this.streamPending &&
      !this.audioStreamManager.isCurrentlyStreaming()
    ) {
      log.warn('[ItoStreamController] No active stream to cancel')
      return
    }

    console.log('[ItoStreamController] Cancelling transcription')
    this.abortController?.abort(new Error('Transcription cancelled'))

    this.stopStreaming()
  }

  public getAudioDurationMs(): number {
    return this.audioStreamManager.getAudioDurationMs()
  }

  public getInteractionAudioBuffer(): Buffer {
    return this.audioStreamManager.getInteractionAudioBuffer()
  }

  public getCurrentSampleRate(): number {
    return this.audioStreamManager.getCurrentSampleRate()
  }

  private stopStreaming() {
    this.audioStreamManager.stopStreaming()
  }

  public clearInteractionAudio() {
    this.audioStreamManager.clearInteractionAudio()
  }

  private async *createStreamGenerator(
    audio: AudioStreamManager,
    configs: TranscribeStreamRequest[],
    signal: AbortSignal,
  ): AsyncGenerator<TranscribeStreamRequest> {
    console.log(
      '[ItoStreamController] Starting stream generator (audio-first mode)',
    )

    // Stream audio chunks and interleave config updates
    for await (const audioChunk of audio.streamAudioChunks()) {
      if (signal.aborted) {
        console.log(
          '[ItoStreamController] Stream cancelled, stopping generator',
        )
        break
      }

      // Send any pending config updates before this audio chunk
      while (!signal.aborted && configs.length > 0) {
        const configMessage = configs.shift()!
        console.log('[ItoStreamController] Sending config update from queue')
        yield configMessage
      }

      // Send audio chunk
      yield create(TranscribeStreamRequestSchema, {
        payload: {
          case: 'audioData',
          value: audioChunk.audioData,
        },
      })
    }

    // Send any remaining config messages at the end
    while (!signal.aborted && configs.length > 0) {
      const configMessage = configs.shift()!
      console.log(
        '[ItoStreamController] Sending final config update from queue',
      )
      yield configMessage
    }
  }

  private buildStreamConfig(context: ContextData): TranscribeStreamRequest {
    const interactionId = interactionManager.getCurrentInteractionId()
    // Build gRPC config message from the provided context data
    return create(TranscribeStreamRequestSchema, {
      payload: {
        case: 'config',
        value: create(StreamConfigSchema, {
          context: create(ContextInfoSchema, {
            windowTitle: context.windowTitle,
            appName: context.appName,
            contextText: context.contextText,
            mode: this.currentMode,
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
          interactionId: interactionId || undefined,
        }),
      },
    })
  }
}

export const itoStreamController = new ItoStreamController()
