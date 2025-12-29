import { create } from '@bufbuild/protobuf'
import { ConnectError, Code } from '@connectrpc/connect'
import type { HandlerContext } from '@connectrpc/connect'
import {
  ContextInfo,
  ItoMode,
  StreamConfig,
  StreamConfigSchema,
  TranscribeStreamRequest,
  TranscribeStreamResponse,
  TranscribeStreamResponseSchema,
  TranscribePhase,
} from '../../generated/ito_pb.js'
import { getAsrProvider, getLlmProvider } from '../../clients/providerUtils.js'
import { DEFAULT_ADVANCED_SETTINGS } from '../../constants/generated-defaults.js'
import { errorToProtobuf } from '../../clients/errors.js'
import {
  createUserPromptWithContext,
  detectItoMode,
  getPromptForMode,
} from './helpers.js'
import { getDefaultLlmModel, ITO_MODE_SYSTEM_PROMPT } from './constants.js'
import type { ItoContext } from './types.js'
import { isAbortError, createAbortError } from '../../utils/abortUtils.js'
import {
  concatenateAudioChunks,
  prepareAudioForTranscription,
} from '../../utils/audioProcessing.js'
import {
  serverTimingCollector,
  ServerTimingEventName,
} from '../timing/ServerTimingCollector.js'
import { kUser } from '../../auth/userContext.js'
import { createInteractionWithAudio } from './interactionHelpers.js'
import { v4 as uuidv4 } from 'uuid'

interface PolishError {
  message: string
  provider: string
  model: string
}

interface AdjustResult {
  transcript: string
  polishError?: PolishError
}

export class TranscribeStreamV2Handler {
  private readonly MODE_CHANGE_GRACE_PERIOD_MS = 100

  async *process(
    requests: AsyncIterable<TranscribeStreamRequest>,
    context?: HandlerContext,
  ): AsyncIterable<TranscribeStreamResponse> {
    const startTime = Date.now()

    console.log(`📩 [${new Date().toISOString()}] Starting TranscribeStreamV2`)

    // Collect stream data
    const {
      audioChunks,
      mergedConfig: initialConfig,
      lastModeChangeTimestamp,
      previousMode,
    } = await this.collectStreamData(requests)

    const streamEndTime = Date.now()

    // Extract interaction ID and user ID for timing
    const interactionId = initialConfig?.interactionId
    const userId = context?.values.get(kUser)?.sub

    // Initialize timing collection
    serverTimingCollector.startInteraction(interactionId, userId)
    serverTimingCollector.startTiming(
      ServerTimingEventName.TOTAL_PROCESSING,
      interactionId,
    )

    // Check if client cancelled the stream
    if (context?.signal.aborted) {
      serverTimingCollector.clearInteraction(interactionId)

      console.log(
        `🚫 [${new Date().toISOString()}] Stream cancelled by client, aborting processing`,
      )
      throw new ConnectError('Stream cancelled by client', Code.Canceled)
    }

    // Apply mode grace period
    const mergedConfig = this.applyModeGracePeriod(
      initialConfig,
      lastModeChangeTimestamp,
      previousMode,
      streamEndTime,
    )

    console.log(
      `📊 [${new Date().toISOString()}] Processed ${audioChunks.length} audio chunks`,
    )

    // Concatenate and prepare audio
    const fullAudio = concatenateAudioChunks(audioChunks)

    try {
      // Time audio processing
      const fullAudioWAV = interactionId
        ? await serverTimingCollector.timeAsync(
            ServerTimingEventName.AUDIO_PROCESSING,
            () => prepareAudioForTranscription(fullAudio),
            interactionId,
          )
        : prepareAudioForTranscription(fullAudio)

      // Extract configuration
      const asrConfig = this.extractAsrConfig(mergedConfig)

      // Time transcription
      let transcript = await serverTimingCollector.timeAsync(
        ServerTimingEventName.ASR_TRANSCRIPTION,
        () => this.transcribeAudioData(fullAudioWAV, asrConfig, context),
        interactionId,
      )

      // Prepare context and settings
      const windowContext: ItoContext = {
        windowTitle: mergedConfig.context?.windowTitle || '',
        appName: mergedConfig.context?.appName || '',
        contextText: mergedConfig.context?.contextText || '',
      }

      const mode = mergedConfig.context?.mode ?? detectItoMode(transcript)

      const advancedSettings = this.prepareAdvancedSettings(
        mergedConfig,
        asrConfig.asrModel,
        asrConfig.asrProvider,
        asrConfig.noSpeechThreshold,
      )

      // Store original ASR transcript before adjustment
      const originalTranscript = transcript

      // Yield status before calling LLM (polish or edit)
      if (mode === ItoMode.TRANSCRIBE && advancedSettings.polishEnabled) {
        yield create(TranscribeStreamResponseSchema, {
          phase: TranscribePhase.PHASE_POLISHING,
        })
      } else if (mode === ItoMode.EDIT) {
        yield create(TranscribeStreamResponseSchema, {
          phase: TranscribePhase.PHASE_EDITING,
        })
      }

      // Time transcript adjustment (only happens in EDIT mode or TRANSCRIBE with polish)
      const adjustResult = await this.adjustTranscriptForMode(
        transcript,
        mode,
        windowContext,
        advancedSettings,
      )
      transcript = adjustResult.transcript
      const polishError = adjustResult.polishError

      const duration = Date.now() - startTime

      // Create interaction in database if we have a user ID
      if (!userId) {
        console.error(
          `❌ [${new Date().toISOString()}] Cannot create interaction: userId is missing. This should not happen - check server authentication configuration.`,
        )
      } else {
        try {
          // Generate interaction ID if not provided by client
          const finalInteractionId = interactionId || uuidv4()

          // Generate a meaningful title from the transcript
          const displayTranscript =
            mode === ItoMode.EDIT ? transcript : originalTranscript
          const title =
            displayTranscript && displayTranscript.length > 50
              ? displayTranscript.substring(0, 50) + '...'
              : displayTranscript || 'Voice interaction'

          // Create ASR output object
          const asrOutput = JSON.stringify({
            transcript: originalTranscript,
            timestamp: new Date().toISOString(),
            durationMs: duration,
          })

          // Create LLM output object
          // - For EDIT mode: store adjusted transcript if changed
          // - For TRANSCRIBE with polish error: store the error details
          const llmOutput =
            mode === ItoMode.EDIT && transcript !== originalTranscript
              ? JSON.stringify({
                  adjustedTranscript: transcript,
                  mode: 'EDIT',
                  timestamp: new Date().toISOString(),
                })
              : polishError
                ? JSON.stringify({
                    error: polishError.message,
                    errorCode: 'POLISH_LLM_FAILED',
                    provider: polishError.provider,
                    model: polishError.model,
                    mode: 'TRANSCRIBE_POLISH',
                    timestamp: new Date().toISOString(),
                  })
                : null

          // Use shared helper to create interaction
          await createInteractionWithAudio({
            id: finalInteractionId,
            userId,
            title,
            asrOutput,
            llmOutput,
            durationMs: duration,
          })
        } catch (error) {
          console.error('Failed to create interaction:', error)
          // Don't throw - we don't want to fail the transcription if interaction creation fails
        }
      }

      // Finalize timing
      serverTimingCollector.endTiming(
        ServerTimingEventName.TOTAL_PROCESSING,
        interactionId,
      )
      serverTimingCollector.finalizeInteraction(interactionId)

      console.log(
        `✅ [${new Date().toISOString()}] TranscribeStreamV2 completed in ${duration}ms`,
      )

      yield create(TranscribeStreamResponseSchema, {
        phase: TranscribePhase.PHASE_COMPLETE,
        transcript,
      })
    } catch (error: any) {
      // Clear timing on error
      if (interactionId) {
        serverTimingCollector.clearInteraction(interactionId)
      }

      if (error instanceof ConnectError) {
        throw error
      }

      console.error('Failed to process TranscribeStreamV2:', error)

      yield create(TranscribeStreamResponseSchema, {
        phase: TranscribePhase.PHASE_COMPLETE,
        transcript: '',
        error: errorToProtobuf(
          error,
          (mergedConfig.llmSettings?.asrProvider as any) ||
            (DEFAULT_ADVANCED_SETTINGS.asrProvider as any),
        ),
      })
    }
  }

  private async collectStreamData(
    requests: AsyncIterable<TranscribeStreamRequest>,
  ): Promise<{
    audioChunks: Uint8Array[]
    mergedConfig: StreamConfig
    lastModeChangeTimestamp: number | null
    previousMode: ItoMode | undefined
  }> {
    const audioChunks: Uint8Array[] = []
    let mergedConfig: StreamConfig = create(StreamConfigSchema, {
      context: undefined,
      llmSettings: undefined,
      vocabulary: [],
    })
    let lastModeChangeTimestamp: number | null = null
    let previousMode: ItoMode | undefined = undefined

    try {
      for await (const request of requests) {
        if (request.payload.case === 'audioData') {
          audioChunks.push(request.payload.value)
        } else if (request.payload.case === 'config') {
          const currentMode = mergedConfig.context?.mode
          mergedConfig = this.mergeStreamConfigs(
            mergedConfig,
            request.payload.value,
          )

          console.log(
            `🔧 [${new Date().toISOString()}] Received config update:`,
            JSON.stringify(mergedConfig, null, 2),
          )

          const newMode = mergedConfig.context?.mode
          if (newMode !== undefined && newMode !== currentMode) {
            previousMode = currentMode
            lastModeChangeTimestamp = Date.now()
            console.log(
              `🔧 [${new Date().toISOString()}] Mode changed from ${currentMode} to: ${newMode}`,
            )
          }
        }
      }
    } catch (err) {
      if (isAbortError(err)) {
        console.log(
          `🚫 [${new Date().toISOString()}] Stream reading interrupted (client cancelled)`,
        )
        throw createAbortError(err, 'Stream cancelled by client')
      }

      throw err
    }

    return { audioChunks, mergedConfig, lastModeChangeTimestamp, previousMode }
  }

  private applyModeGracePeriod(
    mergedConfig: StreamConfig,
    lastModeChangeTimestamp: number | null,
    previousMode: ItoMode | undefined,
    streamEndTime: number,
  ): StreamConfig {
    // If there was a mode change and it happened within the grace period,
    // revert to the previous mode (or undefined if no previous mode)
    if (lastModeChangeTimestamp !== null) {
      const timeSinceLastChange = streamEndTime - lastModeChangeTimestamp

      if (timeSinceLastChange <= this.MODE_CHANGE_GRACE_PERIOD_MS) {
        const currentMode = mergedConfig.context?.mode
        console.log(
          `⏱️ [${new Date().toISOString()}] Last mode change (${timeSinceLastChange}ms ago) within grace period (${this.MODE_CHANGE_GRACE_PERIOD_MS}ms) - reverting from ${currentMode} to ${previousMode}`,
        )

        if (mergedConfig.context) {
          return {
            ...mergedConfig,
            context: {
              ...mergedConfig.context,
              mode: previousMode,
            },
          }
        }
      }
    }

    return mergedConfig
  }

  private extractAsrConfig(mergedConfig: StreamConfig) {
    // ASR_PROVIDER env var takes precedence over client settings
    const asrProvider =
      process.env.ASR_PROVIDER ||
      this.resolveOrDefault(
        mergedConfig.llmSettings?.asrProvider,
        DEFAULT_ADVANCED_SETTINGS.asrProvider,
      )

    // Determine the appropriate default model based on provider
    const defaultAsrModel = this.getDefaultAsrModel(asrProvider)

    // ASR_MODEL env var takes precedence, then client settings, then provider-specific default
    const asrModel =
      process.env.ASR_MODEL ||
      this.resolveOrDefault(mergedConfig.llmSettings?.asrModel, '') ||
      defaultAsrModel

    return {
      asrModel,
      asrProvider,
      noSpeechThreshold: this.resolveOrDefault(
        mergedConfig.llmSettings?.noSpeechThreshold,
        DEFAULT_ADVANCED_SETTINGS.noSpeechThreshold,
      ),
      vocabulary: mergedConfig.vocabulary,
    }
  }

  private getDefaultAsrModel(provider: string): string {
    switch (provider) {
      case 'aliyun':
        return 'qwen3-asr-flash'
      case 'groq':
      default:
        return DEFAULT_ADVANCED_SETTINGS.asrModel
    }
  }

  /**
   * Resolves a value to its default if it's undefined, null, or empty.
   * This provides a defensive fallback for optional protobuf fields.
   */
  private resolveOrDefault<T extends string | number>(
    value: T | undefined,
    defaultValue: T,
  ): T {
    if (value === undefined || value === '' || value === null) {
      return defaultValue
    }
    return value
  }

  private prepareAdvancedSettings(
    mergedConfig: StreamConfig,
    asrModel: string,
    asrProvider: string,
    noSpeechThreshold: number,
  ) {
    const llmProvider = this.resolveOrDefault(
      mergedConfig.llmSettings?.llmProvider,
      DEFAULT_ADVANCED_SETTINGS.llmProvider,
    )
    const defaultLlmModel = getDefaultLlmModel(llmProvider)

    // Polish mode settings
    const polishEnabled =
      mergedConfig.llmSettings?.polishEnabled ??
      DEFAULT_ADVANCED_SETTINGS.polishEnabled
    const polishLlmProvider = this.resolveOrDefault(
      mergedConfig.llmSettings?.polishLlmProvider,
      DEFAULT_ADVANCED_SETTINGS.polishLlmProvider,
    )
    const defaultPolishLlmModel = getDefaultLlmModel(polishLlmProvider)

    return {
      asrModel: this.resolveOrDefault(
        asrModel,
        DEFAULT_ADVANCED_SETTINGS.asrModel,
      ),
      asrProvider: this.resolveOrDefault(
        asrProvider,
        DEFAULT_ADVANCED_SETTINGS.asrProvider,
      ),
      asrPrompt: this.resolveOrDefault(
        mergedConfig.llmSettings?.asrPrompt,
        DEFAULT_ADVANCED_SETTINGS.asrPrompt,
      ),
      llmProvider,
      llmModel: this.resolveOrDefault(
        mergedConfig.llmSettings?.llmModel,
        defaultLlmModel,
      ),
      llmTemperature: this.resolveOrDefault(
        mergedConfig.llmSettings?.llmTemperature,
        DEFAULT_ADVANCED_SETTINGS.llmTemperature,
      ),
      transcriptionPrompt: this.resolveOrDefault(
        mergedConfig.llmSettings?.transcriptionPrompt,
        DEFAULT_ADVANCED_SETTINGS.transcriptionPrompt,
      ),
      editingPrompt: this.resolveOrDefault(
        mergedConfig.llmSettings?.editingPrompt,
        DEFAULT_ADVANCED_SETTINGS.editingPrompt,
      ),
      noSpeechThreshold: this.resolveOrDefault(
        noSpeechThreshold,
        DEFAULT_ADVANCED_SETTINGS.noSpeechThreshold,
      ),
      // Polish mode settings
      polishEnabled,
      polishLlmProvider,
      polishLlmModel: this.resolveOrDefault(
        mergedConfig.llmSettings?.polishLlmModel,
        defaultPolishLlmModel,
      ),
      polishLlmTemperature: this.resolveOrDefault(
        mergedConfig.llmSettings?.polishLlmTemperature,
        DEFAULT_ADVANCED_SETTINGS.polishLlmTemperature,
      ),
    }
  }

  private async transcribeAudioData(
    audioWav: Buffer,
    asrConfig: ReturnType<typeof this.extractAsrConfig>,
    context?: HandlerContext,
  ): Promise<string> {
    if (context?.signal.aborted) {
      console.log(
        `🚫 [${new Date().toISOString()}] Stream cancelled before ASR call, skipping transcription`,
      )
      throw new ConnectError('Stream cancelled by client', Code.Canceled)
    }

    const asrClient = getAsrProvider(asrConfig.asrProvider)
    const transcript = await asrClient.transcribeAudio(audioWav, {
      fileType: 'wav',
      asrModel: asrConfig.asrModel,
      noSpeechThreshold: asrConfig.noSpeechThreshold,
      vocabulary: asrConfig.vocabulary,
    })

    console.log(
      `📝 [${new Date().toISOString()}] Received transcript: "${transcript}"`,
    )

    return transcript
  }

  private async adjustTranscriptForMode(
    transcript: string,
    mode: ItoMode,
    windowContext: ItoContext,
    advancedSettings: ReturnType<typeof this.prepareAdvancedSettings>,
  ): Promise<AdjustResult> {
    console.log(
      `[${new Date().toISOString()}] Detected mode: ${mode}, adjusting transcript`,
    )

    // Handle EDIT mode (existing behavior)
    if (mode === ItoMode.EDIT) {
      const userPromptPrefix = getPromptForMode(mode, advancedSettings)
      const userPrompt = createUserPromptWithContext(transcript, windowContext)
      const llmProvider = getLlmProvider(advancedSettings.llmProvider)

      try {
        const adjustedTranscript = await serverTimingCollector.timeAsync(
          ServerTimingEventName.LLM_ADJUSTMENT,
          () =>
            llmProvider.adjustTranscript(userPromptPrefix + '\n' + userPrompt, {
              temperature: advancedSettings.llmTemperature,
              model: advancedSettings.llmModel,
              prompt: ITO_MODE_SYSTEM_PROMPT[mode],
            }),
        )

        console.log(
          `📝 [${new Date().toISOString()}] Adjusted transcript (EDIT): "${adjustedTranscript}"`,
        )

        return { transcript: adjustedTranscript }
      } catch (error) {
        console.error(
          `⚠️ [${new Date().toISOString()}] LLM adjustment failed, using raw transcript:`,
          error,
        )
        return { transcript }
      }
    }

    // Handle TRANSCRIBE mode with optional polish
    if (mode === ItoMode.TRANSCRIBE && advancedSettings.polishEnabled) {
      console.log(
        `[${new Date().toISOString()}] Polish enabled for TRANSCRIBE mode`,
      )

      // Use transcriptionPrompt for polishing
      const userPromptPrefix = getPromptForMode(mode, advancedSettings)
      const userPrompt = createUserPromptWithContext(transcript, windowContext)

      // Use polish-specific LLM settings
      const llmProvider = getLlmProvider(advancedSettings.polishLlmProvider)

      try {
        const polishedTranscript = await serverTimingCollector.timeAsync(
          ServerTimingEventName.LLM_ADJUSTMENT,
          () =>
            llmProvider.adjustTranscript(userPromptPrefix + '\n' + userPrompt, {
              temperature: advancedSettings.polishLlmTemperature,
              model: advancedSettings.polishLlmModel,
              prompt: ITO_MODE_SYSTEM_PROMPT[mode],
            }),
        )

        console.log(
          `📝 [${new Date().toISOString()}] Polished transcript: "${polishedTranscript}"`,
        )

        return { transcript: polishedTranscript }
      } catch (error) {
        console.error(
          `⚠️ [${new Date().toISOString()}] Polish failed, using raw transcript:`,
          error,
        )
        return {
          transcript,
          polishError: {
            message: error instanceof Error ? error.message : String(error),
            provider: advancedSettings.polishLlmProvider,
            model: advancedSettings.polishLlmModel,
          },
        }
      }
    }

    // Default: return raw transcript (TRANSCRIBE mode without polish)
    return { transcript }
  }

  private mergeStreamConfigs(
    base: StreamConfig,
    update: StreamConfig,
  ): StreamConfig {
    const mergeContext = (
      baseCtx: ContextInfo | undefined,
      updateCtx: ContextInfo | undefined,
    ): ContextInfo | undefined => {
      if (!updateCtx) return baseCtx
      if (!baseCtx) return updateCtx

      return {
        ...baseCtx,
        mode: updateCtx.mode !== undefined ? updateCtx.mode : baseCtx.mode,
        windowTitle:
          updateCtx.windowTitle !== ''
            ? updateCtx.windowTitle
            : baseCtx.windowTitle,
        appName: updateCtx.appName !== '' ? updateCtx.appName : baseCtx.appName,
        contextText:
          updateCtx.contextText !== ''
            ? updateCtx.contextText
            : baseCtx.contextText,
      }
    }

    return {
      ...base,
      context: mergeContext(base.context, update.context),
      llmSettings: update.llmSettings
        ? { ...base.llmSettings, ...update.llmSettings }
        : base.llmSettings,
      vocabulary:
        update.vocabulary.length > 0 ? update.vocabulary : base.vocabulary,
      interactionId: update.interactionId || base.interactionId,
    }
  }
}

export const transcribeStreamV2Handler = new TranscribeStreamV2Handler()
