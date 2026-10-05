import { test, expect, mock } from 'bun:test'
import { EventEmitter } from 'events'
import { ItoMode } from '@/app/generated/ito_pb'

const recorder = new EventEmitter()
let finish: (value: any) => void
let signal: AbortSignal
mock.module('../media/audio', () => ({ audioRecorderService: recorder }))
mock.module('../clients/grpcClient', () => ({
  grpcClient: {
    transcribeStream: (_stream: any, abort: AbortSignal) => {
      signal = abort
      return new Promise(resolve => {
        finish = resolve
      })
    },
  },
}))
mock.module('./timing/TimingCollector', () => ({
  timingCollector: { timeAsync: (_name: string, fn: () => unknown) => fn() },
  TimingEventName: { SERVER_DICTATION: 'dictation', SERVER_EDITING: 'editing' },
}))
mock.module('./interactions/InteractionManager', () => ({
  interactionManager: { getCurrentInteractionId: () => 'test' },
}))
const { ItoStreamController } = await import('./itoStreamController')

test('a pending response prevents the next recording from replacing its audio', async () => {
  const controller = new ItoStreamController()
  await controller.initialize(ItoMode.TRANSCRIBE)
  const pending = controller.startGrpcStream()
  recorder.emit('audio-chunk', Buffer.from('first recording'))
  controller.endInteraction()
  expect(await controller.initialize(ItoMode.EDIT)).toBe(false)
  finish({ transcript: 'first transcript' })
  expect((await pending).audioBuffer.toString()).toBe('first recording')
  expect(await controller.initialize(ItoMode.EDIT)).toBe(true)
  controller.cancelTranscription()
})

test('cancellation after upload aborts and settles even an unresponsive transport', async () => {
  const controller = new ItoStreamController()
  await controller.initialize(ItoMode.TRANSCRIBE)
  const pending = controller.startGrpcStream()
  controller.endInteraction()
  controller.cancelTranscription()
  expect(signal.aborted).toBe(true)
  await expect(pending).rejects.toThrow('cancelled')
  expect(recorder.listenerCount('audio-chunk')).toBe(0)
  expect(await controller.initialize(ItoMode.TRANSCRIBE)).toBe(true)
  controller.cancelTranscription()
})

test('the response deadline aborts a hung request and allows recovery', async () => {
  const controller = new ItoStreamController(20)
  await controller.initialize(ItoMode.TRANSCRIBE)
  const pending = controller.startGrpcStream()
  controller.endInteraction()
  await expect(pending).rejects.toThrow('timed out')
  expect(signal.aborted).toBe(true)
  expect(await controller.initialize(ItoMode.TRANSCRIBE)).toBe(true)
  controller.cancelTranscription()
})
