import { ItoMode, TranscribePhase } from '@/app/generated/ito_pb'
import { voiceInputService } from './voiceInputService'
import { recordingStateNotifier } from './recordingStateNotifier'
import { itoStreamController } from './itoStreamController'
import { TextInserter } from './text/TextInserter'
import { interactionManager } from './interactions/InteractionManager'
import { contextGrabber } from './context/ContextGrabber'
import { GrammarRulesService } from './grammar/GrammarRulesService'
import { getAdvancedSettings } from './store'
import log from 'electron-log'
import { timingCollector, TimingEventName } from './timing/TimingCollector'
import { Code } from '@connectrpc/connect'

export class ItoSessionManager {
  private readonly MINIMUM_AUDIO_DURATION_MS = 100
  private textInserter = new TextInserter()
  private streamResponsePromise: Promise<{
    response: any
    audioBuffer: Buffer
    sampleRate: number
  }> | null = null
  private contextFetchPromise: Promise<void> | null = null
  private grammarRulesService = new GrammarRulesService('')

  public async startSession(mode: ItoMode) {
    console.log('[itoSessionManager] Starting session with mode:', mode)

    // Reuse existing global interaction ID if present, otherwise create a new one
    let interactionId = interactionManager.getCurrentInteractionId()
    if (interactionId) {
      console.log(
        '[itoSessionManager] Reusing existing interaction ID:',
        interactionId,
      )
      interactionManager.adoptInteractionId(interactionId)
    } else {
      interactionId = interactionManager.initialize()
    }

    // Initialize all necessary components
    const started = await itoStreamController.initialize(mode)
    if (!started) {
      log.error('[itoSessionManager] Failed to initialize itoStreamController')
      return
    }

    // Begin gRPC stream immediately (note, no audio is flowing yet)
    // Pass a phase update callback to notify UI when polishing or editing starts
    this.streamResponsePromise = itoStreamController.startGrpcStream(phase => {
      if (phase === TranscribePhase.PHASE_POLISHING) {
        recordingStateNotifier.notifyPolishingStarted()
      } else if (phase === TranscribePhase.PHASE_EDITING) {
        recordingStateNotifier.notifyEditingStarted()
      }
    })
    this.streamResponsePromise.catch(error => {
      console.error(
        '[itoSessionManager] Stream failed before completion:',
        error,
      )
    })

    // Begin recording audio (audio bytes will now flow into the gRPC stream)
    voiceInputService.startAudioRecording()

    // Send initial mode to the stream
    itoStreamController.setMode(mode)

    // Update UI state
    recordingStateNotifier.notifyRecordingStarted(mode)

    // Fetch and send context in the background (non-blocking)
    this.contextFetchPromise = this.fetchAndSendContext().catch(error => {
      console.error('[itoSessionManager] Failed to fetch/send context:', error)
    })

    // Start timing the interaction
    timingCollector.startInteraction()
    timingCollector.startTiming(TimingEventName.INTERACTION_ACTIVE)

    return interactionId
  }

  private async fetchAndSendContext() {
    console.log('[itoSessionManager] Gathering context...')

    // Gather all context data (window, app, selected text, vocabulary, settings)
    const context = await contextGrabber.gatherContext(
      itoStreamController.getCurrentMode(),
    )

    // Send the gathered context to the stream controller
    await itoStreamController.scheduleConfigUpdate(context)

    this.fetchCursorContextForGrammar().catch(error => {
      console.error(
        '[itoSessionManager] Failed to fetch grammar context:',
        error,
      )
    })
  }

  private async fetchCursorContextForGrammar() {
    const { grammarServiceEnabled } = getAdvancedSettings()
    if (!grammarServiceEnabled) {
      return
    }

    const cursorContext = await timingCollector.timeAsync(
      TimingEventName.GRAMMAR_SERVICE,
      async () => await contextGrabber.getCursorContextForGrammar(),
    )
    this.grammarRulesService = new GrammarRulesService(cursorContext)
  }

  private async refreshVocabularyAtEnd() {
    try {
      const mode = itoStreamController.getCurrentMode()
      const vocabularyWords = await contextGrabber.gatherVocabularyWords(mode)

      if (vocabularyWords.length === 0) {
        console.log(
          '[itoSessionManager] No vocabulary update to send at recording end',
        )
        return
      }

      await itoStreamController.scheduleVocabularyUpdate(vocabularyWords)
    } catch (error) {
      console.error(
        '[itoSessionManager] Failed to refresh vocabulary at recording end:',
        error,
      )
    }
  }

  public setMode(mode: ItoMode) {
    // Send mode change to grpc stream (will also update windows via recordingStateNotifier)
    itoStreamController.setMode(mode)

    // Update UI to show the new mode
    recordingStateNotifier.notifyRecordingStarted(mode)
  }

  public async cancelSession() {
    // Capture the promise in a local variable immediately so new sessions can start
    const responsePromise = this.streamResponsePromise
    this.streamResponsePromise = null

    // Clear timing for the interaction on cancel
    timingCollector.clearInteraction()

    // Cancel the transcription (will not create interaction)
    itoStreamController.cancelTranscription()
    interactionManager.clearCurrentInteraction()

    // Stop audio recording
    await voiceInputService.stopAudioRecording()

    // Update UI state
    recordingStateNotifier.notifyRecordingStopped()

    this.contextFetchPromise = null

    // Wait for the stream promise to reject with cancellation error
    if (responsePromise) {
      try {
        await responsePromise
      } catch (error) {
        // Expected cancellation error, log and ignore
        console.log('[itoSessionManager] Stream cancelled as expected:', error)
      }
    }
  }

  public async completeSession() {
    // Capture the promise in a local variable immediately so new sessions can start
    const responsePromise = this.streamResponsePromise
    this.streamResponsePromise = null

    // End timing for the interaction
    timingCollector.endTiming(TimingEventName.INTERACTION_ACTIVE)

    // Stop audio recording and wait for drain
    await voiceInputService.stopAudioRecording()

    // Check actual audio duration (keyboard duration can be misleading due to latency)
    const audioDurationMs = itoStreamController.getAudioDurationMs()

    if (audioDurationMs < this.MINIMUM_AUDIO_DURATION_MS) {
      console.log(
        `[itoSessionManager] Audio too short (${audioDurationMs}ms < ${this.MINIMUM_AUDIO_DURATION_MS}ms), cancelling`,
      )
      itoStreamController.cancelTranscription()
      recordingStateNotifier.notifyRecordingStopped()
      this.contextFetchPromise = null

      // Wait for the stream promise to reject with cancellation error
      if (responsePromise) {
        try {
          await responsePromise
        } catch (error) {
          // Expected cancellation error, log and ignore
          console.log(
            '[itoSessionManager] Stream cancelled as expected:',
            error,
          )
        }
      }
      return
    }

    if (this.contextFetchPromise) {
      await this.contextFetchPromise
      this.contextFetchPromise = null
    }

    await this.refreshVocabularyAtEnd()

    // End the interaction (this will complete the gRPC stream)
    itoStreamController.endInteraction()

    // Update UI state
    recordingStateNotifier.notifyRecordingStopped()

    // Notify processing started
    recordingStateNotifier.notifyProcessingStarted()

    // Wait for the stream response and handle it
    if (responsePromise) {
      console.log(
        '[itoSessionManager] Waiting for stream response from server...',
      )
      try {
        const result = await responsePromise
        console.log('[itoSessionManager] Received stream response:', {
          hasTranscript: !!result.response?.transcript,
          transcriptLength: result.response?.transcript?.length || 0,
          hasError: !!result.response?.error,
          audioBufferSize: result.audioBuffer.length,
        })
        await this.handleTranscriptionResponse(result)
      } catch (error) {
        console.error(
          '[itoSessionManager] Error waiting for stream response:',
          error,
        )
        await this.handleTranscriptionError(error)
      } finally {
        // Always notify processing, polishing, and editing stopped after handling response
        recordingStateNotifier.notifyEditingStopped()
        recordingStateNotifier.notifyPolishingStopped()
        recordingStateNotifier.notifyProcessingStopped()
      }
    } else {
      console.warn('[itoSessionManager] No stream response promise to wait for')
      recordingStateNotifier.notifyProcessingStopped()
    }

    this.contextFetchPromise = null
  }

  private async handleTranscriptionResponse(result: {
    response: any
    audioBuffer: Buffer
    sampleRate: number
  }) {
    const { response, audioBuffer, sampleRate } = result

    const errorMessage = response.error ? response.error.message : undefined

    // Handle any transcription error
    if (response.error) {
      await interactionManager.createInteraction(
        response.transcript || '',
        audioBuffer,
        sampleRate,
        errorMessage,
      )
      timingCollector.clearInteraction()
      interactionManager.clearCurrentInteraction()
    } else {
      // Handle text insertion with grammar-corrected text
      if (response.transcript && !response.error) {
        let textToInsert = response.transcript

        // Apply grammar rules only if grammar service is enabled
        const { grammarServiceEnabled } = getAdvancedSettings()
        if (grammarServiceEnabled) {
          textToInsert = this.grammarRulesService.setCaseFirstWord(textToInsert)
          textToInsert =
            this.grammarRulesService.addLeadingSpaceIfNeeded(textToInsert)
        }

        this.textInserter.insertText(textToInsert)

        // Create interaction in database
        await interactionManager.createInteraction(
          response.transcript,
          audioBuffer,
          sampleRate,
          errorMessage,
        )
      } else {
        log.warn('[itoSessionManager] Skipping text insertion:', {
          hasTranscript: !!response.transcript,
          transcriptLength: response.transcript?.length || 0,
          hasError: !!response.error,
        })
      }
      timingCollector.finalizeInteraction()
      interactionManager.clearCurrentInteraction()
      itoStreamController.clearInteractionAudio()
    }
  }

  private async handleTranscriptionError(error: any) {
    log.error(
      '[itoSessionManager] An unexpected error occurred during transcription:',
      error,
    )
    const errorDetails = this.getErrorDetails(error)
    const audioBuffer = itoStreamController.getInteractionAudioBuffer()
    const sampleRate = itoStreamController.getCurrentSampleRate()

    if (errorDetails.message) {
      await interactionManager.createInteraction(
        '',
        audioBuffer,
        sampleRate,
        errorDetails.message,
        errorDetails.code,
      )
    }
    // Clear timing for the interaction on error
    timingCollector.clearInteraction()

    // Clear current interaction on error
    interactionManager.clearCurrentInteraction()
    itoStreamController.clearInteractionAudio()
  }

  private getErrorDetails(error: unknown): { message: string; code?: string } {
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
}

export const itoSessionManager = new ItoSessionManager()
