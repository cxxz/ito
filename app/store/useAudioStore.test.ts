import { beforeEach, expect, mock, test } from 'bun:test'

const send = mock()
Object.assign(globalThis, { window: { api: { send } } })
const { useAudioStore } = await import('./useAudioStore')

beforeEach(() => {
  send.mockClear()
  useAudioStore.setState({ isRecording: false, isShortcutEnabled: true })
})

test('Cancel discards a manual recording while Stop requests transcription', async () => {
  await useAudioStore.getState().startRecording()
  await useAudioStore.getState().cancelRecording()
  expect(send.mock.calls.map(call => call[0])).toEqual([
    'start-native-recording',
    'cancel-native-recording',
  ])
  await useAudioStore.getState().startRecording()
  await useAudioStore.getState().stopRecording()
  expect(send).toHaveBeenLastCalledWith('stop-native-recording')
})
