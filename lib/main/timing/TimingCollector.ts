import { store } from '../store'
import { performance } from 'perf_hooks'
import { interactionManager } from '../interactions/InteractionManager'
import { STORE_KEYS } from '../../constants/store-keys'

export enum TimingEventName {
  INTERACTION_ACTIVE = 'interaction_active',
  SERVER_DICTATION = 'server_transcribe',
  SERVER_EDITING = 'server_editing',
  SELCTED_TEXT_GATHER = 'selected_text_gather',
  WINDOW_CONTEXT_GATHER = 'window_context_gather',
  GRAMMAR_SERVICE = 'grammar_service',
  CURSOR_CONTEXT_GATHER = 'cursor_context_gather',
  TEXT_WRITER = 'text_writer',
}

interface TimingEventRecord {
  name: TimingEventName
  startMs: number
  endMs?: number
  durationMs?: number
}

interface ActiveTiming {
  events: Map<TimingEventName, TimingEventRecord>
}

/**
 * Tracks per-interaction event durations and logs a summary on finalize.
 * Self-hosted: timings are local-only, never shipped off the machine.
 * Gated by the user's shareAnalytics setting.
 */
export class TimingCollector {
  private activeTimings = new Map<string, ActiveTiming>()
  private readonly FIRST_EVENT = TimingEventName.INTERACTION_ACTIVE

  constructor() {
    console.log('[TimingCollector] Service initialized')
  }

  private shouldCollect(): boolean {
    const settings = store.get(STORE_KEYS.SETTINGS)
    return settings?.shareAnalytics ?? false
  }

  startInteraction(interactionId?: string) {
    if (!this.shouldCollect()) return

    const id = interactionId || interactionManager.getCurrentInteractionId()
    if (!id) {
      console.warn(
        '[TimingCollector] Cannot start timing: no interaction ID available',
      )
      return
    }

    this.activeTimings.set(id, { events: new Map() })
  }

  startTiming(eventName: TimingEventName, interactionId?: string) {
    if (!this.shouldCollect()) return

    const id = interactionId || interactionManager.getCurrentInteractionId()
    if (!id) return

    const active = this.activeTimings.get(id)
    if (!active) {
      console.warn(
        `[TimingCollector] Cannot start timing for unknown interaction: ${id}`,
      )
      return
    }

    active.events.set(eventName, {
      name: eventName,
      startMs: performance.now(),
    })
  }

  endTiming(eventName: TimingEventName, interactionId?: string) {
    if (!this.shouldCollect()) return

    const id = interactionId || interactionManager.getCurrentInteractionId()
    if (!id) return

    const active = this.activeTimings.get(id)
    if (!active) {
      console.warn(
        `[TimingCollector] Cannot end timing for unknown interaction: ${id}`,
      )
      return
    }

    const event = active.events.get(eventName)
    if (!event) {
      console.warn(
        `[TimingCollector] Cannot end timing for unknown event: ${eventName}`,
      )
      return
    }

    event.endMs = performance.now()
    event.durationMs = event.endMs - event.startMs
  }

  finalizeInteraction(interactionId?: string) {
    if (!this.shouldCollect()) return

    const id = interactionId || interactionManager.getCurrentInteractionId()
    if (!id) {
      console.warn(
        '[TimingCollector] Cannot finalize: no interaction ID available',
      )
      return
    }

    const active = this.activeTimings.get(id)
    if (!active) {
      console.warn(
        `[TimingCollector] Cannot finalize unknown interaction: ${id}`,
      )
      return
    }

    const events = Array.from(active.events.values())
    const totalDuration = computeTotalDurationMs(events, this.FIRST_EVENT)

    this.activeTimings.delete(id)

    console.log(
      `[TimingCollector] Finalized interaction: ${id} (${events.length} events, ${totalDuration}ms total)`,
    )
  }

  clearInteraction(interactionId?: string) {
    const id = interactionId || interactionManager.getCurrentInteractionId()
    if (!id) return

    this.activeTimings.delete(id)
    console.log(`[TimingCollector] Cleared interaction: ${id}`)
  }

  /**
   * @example
   * await timingCollector.timeAsync(
   *   TimingEventName.TEXT_WRITER,
   *   async () => await setFocusedText(transcript),
   * )
   */
  async timeAsync<T>(
    eventName: TimingEventName,
    fn: () => Promise<T> | T,
    interactionId?: string,
  ): Promise<T> {
    this.startTiming(eventName, interactionId)
    try {
      return await fn()
    } finally {
      this.endTiming(eventName, interactionId)
    }
  }
}

function computeTotalDurationMs(
  events: TimingEventRecord[],
  firstEventName: TimingEventName,
): number {
  if (events.length === 0) return 0

  const firstEvent = events.find(e => e.name === firstEventName)
  if (!firstEvent) return 0

  const lastEvent = events.reduce((latest, event) => {
    const eventEnd = event.endMs ?? event.startMs
    const latestEnd = latest.endMs ?? latest.startMs
    return eventEnd > latestEnd ? event : latest
  }, events[0])

  return (lastEvent.endMs ?? lastEvent.startMs) - firstEvent.startMs
}

export const timingCollector = new TimingCollector()
