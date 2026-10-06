import { beforeEach, expect, mock, test } from 'bun:test'
import { create } from '@bufbuild/protobuf'
import {
  ItoMode,
  StreamConfigSchema,
  TranscribeStreamRequestSchema,
  TranscribePhase,
} from '../../generated/ito_pb.js'
import { kUser } from '../../auth/userContext.js'

const transcribeAudio = mock(
  async (_audio?: Buffer, _options?: any) => 'hello world',
)
const adjustTranscript = mock(async () => 'Hello world.')
mock.module('../../clients/providerUtils.js', () => ({
  getAsrProvider: () => ({ transcribeAudio }),
  getLlmProvider: () => ({ adjustTranscript }),
}))
const persist = mock<(...args: any[]) => Promise<any>>(async () => ({}))
mock.module('./interactionHelpers.js', () => ({
  createInteractionWithAudio: persist,
}))
const { TranscribeStreamHandler } = await import('./transcribeStreamHandler.js')

beforeEach(() => {
  transcribeAudio.mockClear()
  adjustTranscript.mockClear()
  persist.mockClear()
})

function requests(polishEnabled = false) {
  return (async function* () {
    yield create(TranscribeStreamRequestSchema, {
      payload: {
        case: 'config',
        value: create(StreamConfigSchema, {
          interactionId: 'recording-1',
          context: { mode: ItoMode.TRANSCRIBE },
          llmSettings: { polishEnabled, asrPrompt: 'Meeting about Ito' },
        }),
      },
    })
    yield create(TranscribeStreamRequestSchema, {
      payload: { case: 'audioData', value: new Uint8Array(32000) },
    })
  })()
}
const context = () =>
  ({
    values: {
      get: (key: any) => (key === kUser ? { sub: 'user' } : undefined),
    },
    signal: new AbortController().signal,
  }) as any

test('bounds incoming audio before concatenating or invoking a provider', async () => {
  async function* oversized() {
    yield create(TranscribeStreamRequestSchema, {
      payload: {
        case: 'audioData',
        value: new Uint8Array(20 * 1024 * 1024 + 1),
      },
    })
  }
  const responses = new TranscribeStreamHandler().process(
    oversized(),
    context(),
  )
  const iterator = responses[Symbol.asyncIterator]()
  await expect(iterator.next()).rejects.toThrow('audio limit')
  expect(transcribeAudio).not.toHaveBeenCalled()
})

test('delivers complete metadata before database persistence and keeps persistence alive on response close', async () => {
  const saved = Promise.withResolvers<any>()
  persist.mockImplementationOnce(() => saved.promise)
  const responses = new TranscribeStreamHandler().process(requests(), context())
  const stream = responses[Symbol.asyncIterator]()
  const response = (await stream.next()).value
  expect(response.phase).toBe(TranscribePhase.PHASE_COMPLETE)
  expect(response.transcript).toBe('hello world')
  expect(response.interaction.id).toBe('recording-1')
  expect(response.interaction.durationMs).toBe(1000)
  expect(JSON.parse(response.interaction.asrOutput).transcript).toBe(
    'hello world',
  )
  expect(persist).toHaveBeenCalledTimes(1)
  const close = stream.return?.()
  saved.resolve({})
  await close
})

test('raw mode avoids a polishing request; polish mode reports its separate phase and metadata', async () => {
  const raw = []
  for await (const response of new TranscribeStreamHandler().process(
    requests(),
    context(),
  ))
    raw.push(response)
  expect(adjustTranscript).not.toHaveBeenCalled()
  expect(transcribeAudio.mock.calls[0]?.[1]?.asrPrompt).toBe(
    'Meeting about Ito',
  )
  expect(JSON.parse(raw[0]!.interaction!.asrOutput).adjustmentLatencyMs).toBe(0)
  const polished = []
  for await (const response of new TranscribeStreamHandler().process(
    requests(true),
    context(),
  ))
    polished.push(response)
  expect(polished.map(response => response.phase)).toEqual([
    TranscribePhase.PHASE_POLISHING,
    TranscribePhase.PHASE_COMPLETE,
  ])
  expect(adjustTranscript).toHaveBeenCalledTimes(1)
  const complete = polished[polished.length - 1]
  expect(complete?.transcript).toBe('Hello world.')
  expect(JSON.parse(complete.interaction!.llmOutput).polishedTranscript).toBe(
    'Hello world.',
  )
})

test('records recognition and polishing latency independently', async () => {
  transcribeAudio.mockImplementationOnce(async () => {
    await Bun.sleep(20)
    return 'hello world'
  })
  adjustTranscript.mockImplementationOnce(async () => {
    await Bun.sleep(40)
    return 'Hello world.'
  })
  const responses = []
  for await (const response of new TranscribeStreamHandler().process(
    requests(true),
    context(),
  ))
    responses.push(response)
  const timing = JSON.parse(
    responses[responses.length - 1]!.interaction!.asrOutput,
  )
  expect(timing.asrLatencyMs).toBeGreaterThanOrEqual(15)
  expect(timing.adjustmentLatencyMs).toBeGreaterThanOrEqual(35)
  expect(timing.durationMs).toBe(1000)
})
