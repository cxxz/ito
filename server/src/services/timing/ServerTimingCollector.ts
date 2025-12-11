// No-op timing collector for self-hosted version
// All timing collection is disabled

export enum ServerTimingEventName {
  TOTAL_PROCESSING = 'total_processing',
  AUDIO_PROCESSING = 'audio_processing',
  ASR_TRANSCRIPTION = 'asr_transcription',
  LLM_ADJUSTMENT = 'llm_adjustment',
}

class NoOpServerTimingCollector {
  startInteraction(_interactionId?: string, _userId?: string): void {
    // No-op
  }

  startTiming(_eventName: ServerTimingEventName, _interactionId?: string): void {
    // No-op
  }

  endTiming(_eventName: ServerTimingEventName, _interactionId?: string): void {
    // No-op
  }

  finalizeInteraction(_interactionId?: string): void {
    // No-op
  }

  clearInteraction(_interactionId?: string): void {
    // No-op
  }

  async timeAsync<T>(
    _eventName: ServerTimingEventName,
    fn: () => Promise<T>,
    _interactionId?: string,
  ): Promise<T> {
    // Just execute the function without timing
    return fn()
  }
}

export const serverTimingCollector = new NoOpServerTimingCollector()
