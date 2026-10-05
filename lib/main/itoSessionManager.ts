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

type StreamResult = {
  response: any
  audioBuffer: Buffer
  sampleRate: number
}

type Session = {
  mode: ItoMode
  phase: 'starting' | 'recording' | 'finishing'
  cancelled: boolean
  contextClosed: boolean
  cancelledPromise: Promise<void>
  resolveCancelled: () => void
  startPromise?: Promise<string | undefined>
  responsePromise?: Promise<StreamResult>
  contextPromise?: Promise<void>
  finishPromise?: Promise<void>
  failurePromise?: Promise<void>
  cancelPromise?: Promise<void>
  stopPromise?: Promise<void>
  removeRecorderErrorListener?: () => void
  grammar: GrammarRulesService
}

export class ItoSessionManager {
  private readonly MINIMUM_AUDIO_DURATION_MS = 100
  private textInserter = new TextInserter()
  private session: Session | null = null

  public startSession(mode: ItoMode): Promise<string | undefined> {
    // All entry points (keyboard, pill, IPC) share this gate through cleanup.
    if (this.session) return Promise.resolve(undefined)
    let resolveCancelled!: () => void
    const cancelledPromise = new Promise<void>(resolve => {
      resolveCancelled = resolve
    })
    const session: Session = {
      mode,
      phase: 'starting',
      cancelled: false,
      contextClosed: false,
      cancelledPromise,
      resolveCancelled,
      grammar: new GrammarRulesService(''),
    }
    this.session = session
    session.removeRecorderErrorListener = voiceInputService.onRecordingError(
      error => {
        if (
          this.session !== session ||
          session.cancelled ||
          session.phase !== 'recording'
        )
          return
        session.phase = 'finishing'
        session.failurePromise = this.fail(session, error)
      },
    )
    session.startPromise = this.start(session)
    return session.startPromise
  }

  private async start(session: Session): Promise<string | undefined> {
    try {
      const started = await itoStreamController.initialize(session.mode)
      if (!started) {
        this.release(session)
        return
      }
      if (session.cancelled) return
      let interactionId = interactionManager.getCurrentInteractionId()
      if (interactionId) interactionManager.adoptInteractionId(interactionId)
      else interactionId = interactionManager.initialize()
      timingCollector.startInteraction()
      timingCollector.startTiming(TimingEventName.INTERACTION_ACTIVE)
      session.responsePromise = itoStreamController.startGrpcStream(phase => {
        if (this.session !== session || session.cancelled) return
        if (phase === TranscribePhase.PHASE_POLISHING)
          recordingStateNotifier.notifyPolishingStarted()
        else if (phase === TranscribePhase.PHASE_EDITING)
          recordingStateNotifier.notifyEditingStarted()
      })
      // Attach a rejection handler immediately, including during recorder startup.
      void session.responsePromise.catch(error => {
        if (
          this.session !== session ||
          session.cancelled ||
          session.finishPromise ||
          session.phase === 'finishing'
        )
          return
        session.phase = 'finishing'
        session.failurePromise = this.fail(session, error)
      })
      // Send user-selected provider/settings immediately, even if optional context stalls.
      await itoStreamController.scheduleConfigUpdate({
        windowTitle: '',
        appName: '',
        contextText: '',
        vocabularyWords: [],
        advancedSettings: getAdvancedSettings(),
      })
      if (
        session.cancelled ||
        session.phase === 'finishing' ||
        this.session !== session
      )
        return
      session.contextPromise = this.fetchAndSendContext(session).catch(
        error => {
          console.error('[itoSessionManager] Failed to fetch context:', error)
        },
      )
      await voiceInputService.startAudioRecording()
      if (
        session.cancelled ||
        session.failurePromise ||
        this.session !== session
      )
        return
      session.phase = 'recording'
      itoStreamController.setMode(session.mode)
      recordingStateNotifier.notifyRecordingStarted(session.mode)
      return interactionId
    } catch (error) {
      if (!session.failurePromise) {
        session.phase = 'finishing'
        session.failurePromise = this.fail(session, error)
      }
      await session.failurePromise
      return undefined
    }
  }

  private stopAudio(session: Session) {
    session.stopPromise ??= voiceInputService.stopAudioRecording()
    return session.stopPromise
  }

  private async fail(session: Session, error: unknown) {
    try {
      itoStreamController.cancelTranscription()
      await this.stopAudio(session).catch(stopError => {
        console.error('[itoSessionManager] Failed to stop recorder:', stopError)
      })
      if (!session.cancelled) await this.handleTranscriptionError(error)
    } catch (cleanupError) {
      console.error('[itoSessionManager] Session cleanup failed:', cleanupError)
    } finally {
      this.release(session)
    }
  }

  private release(session: Session) {
    session.contextClosed = true
    session.removeRecorderErrorListener?.()
    if (this.session !== session) return
    recordingStateNotifier.notifyRecordingStopped()
    recordingStateNotifier.notifyEditingStopped()
    recordingStateNotifier.notifyPolishingStopped()
    recordingStateNotifier.notifyProcessingStopped()
    timingCollector.clearInteraction()
    interactionManager.clearCurrentInteraction()
    itoStreamController.clearInteractionAudio()
    this.session = null
  }

  private async fetchAndSendContext(session: Session) {
    const context = await contextGrabber.gatherContext(session.mode)
    if (this.session !== session || session.cancelled || session.contextClosed)
      return
    await itoStreamController.scheduleConfigUpdate(context)
    void this.fetchCursorContextForGrammar(session).catch(error => {
      console.error(
        '[itoSessionManager] Failed to fetch grammar context:',
        error,
      )
    })
  }

  private async fetchCursorContextForGrammar(session: Session) {
    if (!getAdvancedSettings().grammarServiceEnabled) return
    const context = await timingCollector.timeAsync(
      TimingEventName.GRAMMAR_SERVICE,
      () => contextGrabber.getCursorContextForGrammar(),
    )
    if (
      this.session === session &&
      !session.cancelled &&
      !session.contextClosed
    ) {
      session.grammar = new GrammarRulesService(context)
    }
  }

  public setMode(mode: ItoMode) {
    const session = this.session
    if (!session || session.cancelled || session.phase === 'finishing') return
    session.mode = mode
    if (session.phase === 'recording') {
      itoStreamController.setMode(mode)
      recordingStateNotifier.notifyRecordingStarted(mode)
    }
  }

  public cancelSession(): Promise<void> {
    const session = this.session
    if (!session) return Promise.resolve()
    if (session.cancelPromise) return session.cancelPromise
    session.cancelled = true
    session.resolveCancelled()
    itoStreamController.cancelTranscription()
    session.cancelPromise = this.cancel(session)
    return session.cancelPromise
  }

  private async cancel(session: Session) {
    try {
      await session.startPromise
      itoStreamController.cancelTranscription()
      await this.stopAudio(session)
      await session.responsePromise?.catch(() => {})
      await session.finishPromise
      await session.failurePromise
    } finally {
      this.release(session)
    }
  }

  public completeSession(): Promise<void> {
    const session = this.session
    if (!session) return Promise.resolve()
    if (session.cancelPromise) return session.cancelPromise
    if (session.failurePromise) return session.failurePromise
    if (session.finishPromise) return session.finishPromise
    session.finishPromise = this.complete(session)
    return session.finishPromise
  }

  private async complete(session: Session) {
    try {
      await session.startPromise
      if (session.cancelled || this.session !== session) return
      session.phase = 'finishing'
      timingCollector.endTiming(TimingEventName.INTERACTION_ACTIVE)
      await this.stopAudio(session)
      if (session.cancelled) return
      if (
        itoStreamController.getAudioDurationMs() <
        this.MINIMUM_AUDIO_DURATION_MS
      ) {
        session.cancelled = true
        itoStreamController.cancelTranscription()
        await session.responsePromise?.catch(() => {})
        return
      }
      recordingStateNotifier.notifyRecordingStopped()
      recordingStateNotifier.notifyProcessingStarted()
      // Optional context gets a small stop-time budget. No second clipboard read.
      let deadline: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          session.contextPromise,
          session.cancelledPromise,
          new Promise<void>(resolve => {
            deadline = setTimeout(
              resolve,
              session.mode === ItoMode.EDIT ? 1000 : 250,
            )
          }),
        ])
      } finally {
        if (deadline) clearTimeout(deadline)
        session.contextClosed = true
      }
      if (session.cancelled) return
      itoStreamController.endInteraction()
      const result = await session.responsePromise
      if (result && !session.cancelled)
        await this.handleTranscriptionResponse(result, session)
    } catch (error) {
      itoStreamController.cancelTranscription()
      if (!session.cancelled) await this.handleTranscriptionError(error)
    } finally {
      this.release(session)
    }
  }

  private async handleTranscriptionResponse(
    result: {
      response: any
      audioBuffer: Buffer
      sampleRate: number
    },
    session: Session,
  ) {
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
          textToInsert = session.grammar.setCaseFirstWord(textToInsert)
          textToInsert = session.grammar.addLeadingSpaceIfNeeded(textToInsert)
        }

        await this.textInserter.insertText(textToInsert)

        // Create interaction in database
        await interactionManager.upsertInteractionFromServer({
          responseTranscript: response.transcript,
          audioBuffer,
          sampleRate,
          mode: session.mode,
        })
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
