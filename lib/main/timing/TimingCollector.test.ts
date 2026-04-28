import { describe, test, expect, beforeEach, mock, spyOn } from 'bun:test'

mock.module('electron-log', () => ({
  default: {
    info: mock(),
    warn: mock(),
    error: mock(),
  },
}))

const mockStore = {
  get: mock((key: string) => {
    if (key === 'settings') {
      return { shareAnalytics: true }
    }
    return undefined
  }),
}
mock.module('../store', () => ({
  default: mockStore,
  store: mockStore,
  getCurrentUserId: mock(() => 'test-user-id'),
}))

import { TimingCollector, TimingEventName } from './TimingCollector'

describe('TimingCollector', () => {
  let timingCollector: TimingCollector
  let logSpy: ReturnType<typeof spyOn>
  let warnSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    timingCollector = new TimingCollector()
    mockStore.get.mockClear()
    mockStore.get.mockImplementation((key: string) => {
      if (key === 'settings') {
        return { shareAnalytics: true }
      }
      return undefined
    })
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
  })

  const expectLogIncludes = (substring: string) => {
    expect(
      logSpy.mock.calls.some(args =>
        args.some(arg => typeof arg === 'string' && arg.includes(substring)),
      ),
    ).toBe(true)
  }

  const expectWarnIncludes = (substring: string) => {
    expect(
      warnSpy.mock.calls.some(args =>
        args.some(arg => typeof arg === 'string' && arg.includes(substring)),
      ),
    ).toBe(true)
  }

  describe('Interaction Lifecycle', () => {
    test('logs a finalized interaction summary', () => {
      const interactionId = 'test-interaction-1'
      timingCollector.startInteraction(interactionId)
      timingCollector.finalizeInteraction(interactionId)

      expectLogIncludes(`Finalized interaction: ${interactionId}`)
    })

    test('skips entirely when shareAnalytics is disabled', () => {
      mockStore.get.mockImplementation((key: string) => {
        if (key === 'settings') {
          return { shareAnalytics: false }
        }
        return undefined
      })

      const interactionId = 'test-interaction-1'
      timingCollector.startInteraction(interactionId)
      timingCollector.finalizeInteraction(interactionId)

      expect(
        logSpy.mock.calls.some(args =>
          args.some(
            arg => typeof arg === 'string' && arg.includes('Finalized'),
          ),
        ),
      ).toBe(false)
    })

    test('clearInteraction discards in-flight state', () => {
      const interactionId = 'test-interaction-1'
      timingCollector.startInteraction(interactionId)
      timingCollector.clearInteraction(interactionId)
      timingCollector.finalizeInteraction(interactionId)

      expectWarnIncludes(
        `Cannot finalize unknown interaction: ${interactionId}`,
      )
    })
  })

  describe('Timing Events', () => {
    test('records start and end without warnings', () => {
      const interactionId = 'test-interaction-1'
      timingCollector.startInteraction(interactionId)
      timingCollector.startTiming(TimingEventName.TEXT_WRITER, interactionId)
      timingCollector.endTiming(TimingEventName.TEXT_WRITER, interactionId)

      expect(warnSpy).not.toHaveBeenCalled()
    })

    test('warns when ending an event that was never started', () => {
      const interactionId = 'test-interaction-1'
      timingCollector.startInteraction(interactionId)
      timingCollector.endTiming(TimingEventName.TEXT_WRITER, interactionId)

      expectWarnIncludes(
        `Cannot end timing for unknown event: ${TimingEventName.TEXT_WRITER}`,
      )
    })

    test('warns when starting a timing for an unregistered interaction', () => {
      timingCollector.startTiming(TimingEventName.TEXT_WRITER, 'ghost-id')
      expectWarnIncludes(
        'Cannot start timing for unknown interaction: ghost-id',
      )
    })

    test('no-ops without an interactionId and without a current interaction', () => {
      timingCollector.startTiming(TimingEventName.TEXT_WRITER)
      timingCollector.endTiming(TimingEventName.TEXT_WRITER)
      expect(warnSpy).not.toHaveBeenCalled()
    })
  })

  describe('timeAsync', () => {
    test('returns the wrapped function result', async () => {
      const interactionId = 'test-interaction-1'
      timingCollector.startInteraction(interactionId)

      const result = await timingCollector.timeAsync(
        TimingEventName.TEXT_WRITER,
        async () => {
          await new Promise(resolve => setTimeout(resolve, 5))
          return 'result'
        },
        interactionId,
      )

      expect(result).toBe('result')
    })

    test('still ends timing when the function throws', async () => {
      const interactionId = 'test-interaction-1'
      timingCollector.startInteraction(interactionId)

      await expect(
        timingCollector.timeAsync(
          TimingEventName.TEXT_WRITER,
          async () => {
            throw new Error('boom')
          },
          interactionId,
        ),
      ).rejects.toThrow('boom')

      timingCollector.finalizeInteraction(interactionId)
      expectLogIncludes('Finalized interaction')
    })

    test('handles synchronous functions', async () => {
      const interactionId = 'test-interaction-1'
      timingCollector.startInteraction(interactionId)

      const result = await timingCollector.timeAsync(
        TimingEventName.TEXT_WRITER,
        () => 'sync-result',
        interactionId,
      )

      expect(result).toBe('sync-result')
    })
  })

  describe('Finalization', () => {
    test('warns when finalizing an unknown interaction', () => {
      timingCollector.finalizeInteraction('unknown-interaction')
      expectWarnIncludes('Cannot finalize unknown interaction')
    })

    test('summary reports the number of recorded events', () => {
      const interactionId = 'test-interaction-1'
      timingCollector.startInteraction(interactionId)

      timingCollector.startTiming(
        TimingEventName.INTERACTION_ACTIVE,
        interactionId,
      )
      timingCollector.endTiming(
        TimingEventName.INTERACTION_ACTIVE,
        interactionId,
      )
      timingCollector.startTiming(TimingEventName.TEXT_WRITER, interactionId)
      timingCollector.endTiming(TimingEventName.TEXT_WRITER, interactionId)

      timingCollector.finalizeInteraction(interactionId)

      expectLogIncludes('(2 events,')
    })
  })

  describe('Multiple Interactions', () => {
    test('finalizing one interaction leaves others intact', () => {
      const id1 = 'test-interaction-1'
      const id2 = 'test-interaction-2'

      timingCollector.startInteraction(id1)
      timingCollector.startInteraction(id2)
      timingCollector.finalizeInteraction(id2)

      expectLogIncludes(`Finalized interaction: ${id2}`)

      timingCollector.finalizeInteraction(id1)
      expectLogIncludes(`Finalized interaction: ${id1}`)
    })
  })
})
