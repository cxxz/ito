import { AudioChunkSchema } from '@/app/generated/ito_pb'
import { create } from '@bufbuild/protobuf'
import { audioRecorderService } from '../../media/audio'

export class AudioLimitError extends Error {
  constructor(
    public readonly code: 'AUDIO_BACKLOG_LIMIT' | 'RECORDING_LIMIT',
    message: string,
  ) {
    super(message)
  }
}

type AudioLimits = {
  maxQueuedMs: number
  maxDurationMs: number
  maxRetainedBytes: number
}
const DEFAULT_LIMITS: AudioLimits = {
  maxQueuedMs: 5000,
  maxDurationMs: 10 * 60 * 1000,
  maxRetainedBytes: 20 * 1024 * 1024,
}

export class AudioStreamManager {
  private isStreaming = false
  private audioChunkQueue: Buffer[] = []
  private resolveNewChunk: ((value: void | PromiseLike<void>) => void) | null =
    null
  private audioChunksForInteraction: Buffer[] = []
  private currentSampleRate: number = 16000
  private queuedBytes = 0
  private retainedBytes = 0
  private durationTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly onError?: (error: AudioLimitError) => void,
    private readonly limits: AudioLimits = DEFAULT_LIMITS,
  ) {}

  async *streamAudioChunks() {
    // Stream audio chunks as they arrive
    while (this.isStreaming || this.audioChunkQueue.length > 0) {
      if (this.audioChunkQueue.length === 0) {
        if (this.isStreaming) {
          await new Promise<void>(resolve => {
            this.resolveNewChunk = resolve
          })
        } else {
          break
        }
      }

      while (this.audioChunkQueue.length > 0) {
        const chunk = this.audioChunkQueue.shift()
        if (chunk) {
          this.queuedBytes -= chunk.length
          yield create(AudioChunkSchema, { audioData: chunk })
        }
      }
    }
  }

  initialize() {
    this.stopStreaming()
    this.isStreaming = true
    this.audioChunkQueue = []
    this.audioChunksForInteraction = []
    this.queuedBytes = 0
    this.retainedBytes = 0
    this.setupListeners()
  }

  stopStreaming() {
    if (this.durationTimer) clearTimeout(this.durationTimer)
    this.durationTimer = null
    this.isStreaming = false
    if (this.resolveNewChunk) {
      this.resolveNewChunk()
      this.resolveNewChunk = null
    }
    this.removeListeners()
  }

  private setupListeners() {
    console.log('[AudioStreamManager] Setting up audio listeners')
    audioRecorderService.on('audio-chunk', this.handleAudioChunk)
    audioRecorderService.on('audio-config', this.handleAudioConfig)
  }

  private removeListeners() {
    console.log('[AudioStreamManager] Removing audio listeners')
    audioRecorderService.off('audio-chunk', this.handleAudioChunk)
    audioRecorderService.off('audio-config', this.handleAudioConfig)
  }

  private handleAudioChunk = (chunk: Buffer) => {
    this.addAudioChunk(chunk)
  }

  private handleAudioConfig = ({ outputSampleRate, sampleRate }: any) => {
    const effectiveRate = outputSampleRate || sampleRate || 16000
    console.log('[AudioStreamManager] Received audio config:', {
      outputSampleRate,
      sampleRate,
      effectiveRate,
    })
    this.setAudioConfig({ sampleRate: effectiveRate })
  }

  addAudioChunk(chunk: Buffer) {
    if (!this.isStreaming || chunk.length === 0) {
      return
    }

    const retainedBytes = this.retainedBytes + chunk.length
    const maxRecordingBytes = Math.min(
      this.limits.maxRetainedBytes,
      (this.currentSampleRate * 2 * this.limits.maxDurationMs) / 1000,
    )
    if (
      retainedBytes > maxRecordingBytes ||
      this.audioChunksForInteraction.length >= 60_000
    ) {
      this.fail(
        new AudioLimitError(
          'RECORDING_LIMIT',
          'Recording reached its size or duration limit. Please dictate in shorter segments (up to 10 minutes).',
        ),
      )
      return
    }
    if (
      this.audioChunkQueue.length >= 1000 ||
      this.queuedBytes + chunk.length >
        (this.currentSampleRate * 2 * this.limits.maxQueuedMs) / 1000
    ) {
      this.fail(
        new AudioLimitError(
          'AUDIO_BACKLOG_LIMIT',
          'Audio upload could not keep up. Recording stopped to avoid losing speech. Please try again.',
        ),
      )
      return
    }
    if (!this.durationTimer) {
      this.durationTimer = setTimeout(
        () =>
          this.fail(
            new AudioLimitError(
              'RECORDING_LIMIT',
              'Recording reached the 10-minute limit. Please dictate in shorter segments.',
            ),
          ),
        this.limits.maxDurationMs,
      )
      this.durationTimer.unref?.()
    }

    this.audioChunkQueue.push(chunk)
    this.audioChunksForInteraction.push(chunk)
    this.queuedBytes += chunk.length
    this.retainedBytes = retainedBytes

    if (this.resolveNewChunk) {
      this.resolveNewChunk()
      this.resolveNewChunk = null
    }
  }

  private fail(error: AudioLimitError) {
    if (!this.isStreaming) return
    this.stopStreaming()
    console.error('[AudioStreamManager]', error.code, {
      queuedBytes: this.queuedBytes,
      retainedBytes: this.retainedBytes,
    })
    this.onError?.(error)
  }

  getInteractionAudioBuffer(): Buffer {
    return Buffer.concat(this.audioChunksForInteraction)
  }

  setAudioConfig(config: { sampleRate?: number; channels?: number }) {
    if (typeof config.sampleRate === 'number' && config.sampleRate > 0) {
      this.currentSampleRate = config.sampleRate
    }
  }

  getCurrentSampleRate(): number {
    return this.currentSampleRate
  }

  isCurrentlyStreaming(): boolean {
    return this.isStreaming
  }

  clearInteractionAudio() {
    this.audioChunksForInteraction = []
    this.audioChunkQueue = []
    this.retainedBytes = 0
    this.queuedBytes = 0
  }

  getAudioDurationMs(): number {
    // 16-bit PCM mono -> 2 bytes per sample
    const totalSamples = this.retainedBytes / 2
    const durationSeconds = totalSamples / this.currentSampleRate
    return Math.floor(durationSeconds * 1000)
  }
}
