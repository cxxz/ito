import { InteractionsTable } from '../sqlite/repo'
import mainStore from '../store'
import { STORE_KEYS } from '../../constants/store-keys'
import log from 'electron-log'
import { v4 as uuidv4 } from 'uuid'
import { BrowserWindow } from 'electron'
import { timingCollector } from '../timing/TimingCollector'
import { grpcClient } from '../../clients/grpcClient'
import { ItoMode } from '@/app/generated/ito_pb'

const parseJsonField = (value: string | undefined) => {
  if (!value) {
    return null
  }

  try {
    let parsed = JSON.parse(value)
    if (typeof parsed === 'string') {
      parsed = JSON.parse(parsed)
    }
    return parsed
  } catch (error) {
    console.error('[InteractionManager] Failed to parse JSON field:', error)
    return null
  }
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const MAX_INTERACTION_FETCH_ATTEMPTS = 3
const INTERACTION_FETCH_RETRY_DELAY_MS = 150

export class InteractionManager {
  private currentInteractionId: string | null = null
  private interactionStartTime: number | null = null

  initialize(): string {
    this.currentInteractionId = uuidv4()
    this.interactionStartTime = Date.now()
    return this.currentInteractionId
  }

  getCurrentInteractionId(): string | null {
    return this.currentInteractionId
  }

  getInteractionStartTime(): number | null {
    return this.interactionStartTime
  }

  adoptInteractionId(id: string) {
    this.currentInteractionId = id
    this.interactionStartTime = Date.now()
  }

  async createInteraction(
    transcript: string,
    audioBuffer: Buffer,
    sampleRate: number,
    errorMessage?: string,
    errorCode?: string,
  ) {
    if (!this.currentInteractionId) {
      log.warn(
        '[InteractionManager] No current interaction ID, skipping interaction creation.',
      )
      return
    }

    try {
      const userProfile = mainStore.get(STORE_KEYS.USER_PROFILE) as any
      const userId = userProfile?.id || 'self-hosted'

      // Calculate interaction duration
      const interactionEndTime = Date.now()
      const durationMs = this.interactionStartTime
        ? interactionEndTime - this.interactionStartTime
        : 0

      // Create ASR output object with comprehensive information
      const asrOutput = {
        transcript,
        totalAudioBytes: audioBuffer.length,
        error: errorMessage || null,
        errorCode: errorCode || null,
        timestamp: new Date().toISOString(),
        durationMs,
      }

      // Generate a meaningful title from the transcript
      const title =
        transcript && transcript.length > 50
          ? transcript.substring(0, 50) + '...'
          : transcript || 'Voice interaction'

      // Create interaction using upsert to specify our own ID
      const now = new Date().toISOString()
      const interactionData = {
        id: this.currentInteractionId,
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
      }

      await InteractionsTable.upsert(interactionData)

      // Notify all windows about the new interaction
      BrowserWindow.getAllWindows().forEach(window => {
        window.webContents.send('interaction-created', {
          id: this.currentInteractionId,
          transcript,
          timestamp: now,
          durationMs,
        })
      })
    } catch (error) {
      log.error('[InteractionManager] Failed to create interaction:', error)
      // Clear timing on error
      if (this.currentInteractionId) {
        timingCollector.clearInteraction(this.currentInteractionId)
      }
    }
  }

  private async fetchInteractionFromServer(interactionId: string) {
    for (let attempt = 0; attempt < MAX_INTERACTION_FETCH_ATTEMPTS; attempt++) {
      try {
        return await grpcClient.getInteraction(interactionId)
      } catch (error) {
        const isLastAttempt = attempt === MAX_INTERACTION_FETCH_ATTEMPTS - 1
        console.warn(
          `[InteractionManager] Failed to fetch interaction ${interactionId} (attempt ${attempt + 1}/${MAX_INTERACTION_FETCH_ATTEMPTS})`,
          error,
        )
        if (isLastAttempt) {
          break
        }
        await delay(INTERACTION_FETCH_RETRY_DELAY_MS * (attempt + 1))
      }
    }

    return null
  }

  async upsertInteractionFromServer(params: {
    interactionId?: string
    responseTranscript: string
    audioBuffer: Buffer
    sampleRate: number
    durationMs?: number
    mode: ItoMode
  }) {
    const interactionId = params.interactionId ?? this.currentInteractionId
    if (!interactionId) {
      console.warn(
        '[InteractionManager] No interaction ID, skipping server sync.',
      )
      return
    }

    try {
      const userProfile = mainStore.get(STORE_KEYS.USER_PROFILE) as any
      const userId = userProfile?.id || 'self-hosted'
      const now = new Date().toISOString()
      const interactionEndTime = Date.now()
      const durationMs =
        params.durationMs ??
        (this.interactionStartTime
          ? interactionEndTime - this.interactionStartTime
          : 0)

      const serverInteraction =
        await this.fetchInteractionFromServer(interactionId)

      if (!serverInteraction) {
        console.warn(
          `[InteractionManager] Falling back to local interaction data for ${interactionId}`,
        )
        await InteractionsTable.upsert({
          id: interactionId,
          user_id: userId,
          title:
            params.responseTranscript.length > 50
              ? params.responseTranscript.substring(0, 50) + '...'
              : params.responseTranscript || 'Voice interaction',
          asr_output: {
            transcript: params.responseTranscript,
            totalAudioBytes: params.audioBuffer.length,
            error: null,
            errorCode: null,
            timestamp: now,
            durationMs,
          },
          llm_output: {},
          raw_audio: params.audioBuffer.length > 0 ? params.audioBuffer : null,
          raw_audio_id: null,
          duration_ms: durationMs,
          sample_rate: params.sampleRate,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        })

        BrowserWindow.getAllWindows().forEach(window => {
          window.webContents.send('interaction-created', {
            id: interactionId,
            transcript: params.responseTranscript,
            timestamp: now,
            durationMs,
          })
        })
        return
      }

      const parsedAsrOutput = parseJsonField(serverInteraction.asrOutput) || {}
      let parsedLlmOutput = parseJsonField(serverInteraction.llmOutput)
      let rawTranscript =
        typeof parsedAsrOutput?.transcript === 'string'
          ? parsedAsrOutput.transcript
          : ''

      if (!rawTranscript && params.responseTranscript) {
        console.warn(
          `[InteractionManager] Missing ASR transcript for ${interactionId}, falling back to response transcript.`,
        )
        rawTranscript = params.responseTranscript
        parsedAsrOutput.transcript = rawTranscript
      }

      if (params.mode === ItoMode.EDIT) {
        parsedLlmOutput = null
      } else if (params.mode === ItoMode.TRANSCRIBE) {
        const hasPolished =
          typeof parsedLlmOutput?.polishedTranscript === 'string' &&
          parsedLlmOutput.polishedTranscript.trim().length > 0
        const trimmedResponse = params.responseTranscript.trim()
        const trimmedRaw = rawTranscript.trim()

        if (!hasPolished && trimmedResponse && trimmedRaw !== trimmedResponse) {
          parsedLlmOutput = {
            ...(parsedLlmOutput || {}),
            polishedTranscript: params.responseTranscript,
            mode: 'TRANSCRIBE_POLISH',
            timestamp: now,
          }
        }
      }

      const title =
        rawTranscript && rawTranscript.length > 50
          ? rawTranscript.substring(0, 50) + '...'
          : rawTranscript || 'Voice interaction'

      await InteractionsTable.upsert({
        id: interactionId,
        user_id: serverInteraction.userId || userId,
        title,
        asr_output: {
          ...parsedAsrOutput,
          totalAudioBytes:
            parsedAsrOutput?.totalAudioBytes ?? params.audioBuffer.length,
        },
        llm_output: parsedLlmOutput ?? null,
        raw_audio: params.audioBuffer.length > 0 ? params.audioBuffer : null,
        raw_audio_id: null,
        duration_ms: durationMs,
        sample_rate: params.sampleRate,
        created_at: serverInteraction.createdAt || now,
        updated_at: serverInteraction.updatedAt || now,
        deleted_at: serverInteraction.deletedAt || null,
      })

      BrowserWindow.getAllWindows().forEach(window => {
        window.webContents.send('interaction-created', {
          id: interactionId,
          transcript: rawTranscript,
          timestamp: serverInteraction.createdAt || now,
          durationMs,
        })
      })
    } catch (error) {
      console.error(
        '[InteractionManager] Failed to upsert interaction from server:',
        error,
      )
      timingCollector.clearInteraction(interactionId)
    }
  }

  clearCurrentInteraction() {
    this.currentInteractionId = null
    this.interactionStartTime = null
  }
}

export const interactionManager = new InteractionManager()
