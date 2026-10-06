import { beforeEach, expect, mock, test } from 'bun:test'
import { ItoMode } from '@/app/generated/ito_pb'
const selected = mock(
  async (_length?: number, _clipboard?: boolean) =>
    'café, 東京, مرحبا, cafe\u0301, Café, Acme Inc',
)
const cursor = mock(async () => ({ success: false, context: undefined }) as any)
let enabled = true
mock.module('../sqlite/repo', () => ({
  DictionaryTable: {
    findAll: async () => [{ word: 'Café', deleted_at: null }],
  },
}))
mock.module('../store', () => ({
  getCurrentUserId: () => 'self-hosted',
  getAdvancedSettings: () => ({ macosAccessibilityContextEnabled: enabled }),
}))
mock.module('../../media/active-application', () => ({
  getActiveWindow: async () => ({ title: 'Editor', appName: 'Editor' }),
}))
mock.module('../../media/selected-text-reader', () => ({
  getSelectedTextString: selected,
}))
mock.module('../../media/macOSAccessibilityContextProvider', () => ({
  macOSAccessibilityContextProvider: {
    isRunning: () => true,
    getCursorContext: cursor,
  },
}))
mock.module('../timing/TimingCollector', () => ({
  timingCollector: {
    timeAsync: async (_name: string, fn: () => Promise<any>) => fn(),
  },
  TimingEventName: {},
}))
const { ContextGrabber, normalizeVocabulary } = await import('./ContextGrabber')
beforeEach(() => {
  enabled = true
  selected.mockClear()
  cursor.mockClear()
  cursor.mockResolvedValue({ success: false })
})
test('ordinary hints preserve Unicode and avoid clipboard fallback', async () => {
  const data = await new ContextGrabber().gatherContext(ItoMode.TRANSCRIBE)
  expect(selected).toHaveBeenCalledWith(5000, false)
  expect(data.contextText).toBe('')
  expect(data.vocabularyWords).toEqual(['Café', '東京', 'مرحبا', 'Acme Inc'])
})
test('accessibility selection is used without any simulated copy', async () => {
  cursor.mockResolvedValue({ success: true, context: { selectedText: '東京' } })
  const data = await new ContextGrabber().gatherContext(ItoMode.TRANSCRIBE)
  if (process.platform === 'darwin') {
    expect(selected).not.toHaveBeenCalled()
    expect(data.vocabularyWords).toEqual(['Café', '東京'])
  }
})
test('explicit editing keeps copy fallback while skipping temporary hints', async () => {
  await new ContextGrabber().gatherContext(ItoMode.EDIT)
  expect(selected).toHaveBeenCalledTimes(1)
  expect(selected).toHaveBeenCalledWith()
})
test('unavailable grammar context does not simulate selection or copy', async () => {
  expect(await new ContextGrabber().getCursorContextForGrammar()).toBe('')
  expect(selected).not.toHaveBeenCalled()
})
test('disabled macOS context prevents optional selection reads', async () => {
  enabled = false
  await new ContextGrabber().gatherContext(ItoMode.TRANSCRIBE)
  if (process.platform === 'darwin') {
    expect(selected).not.toHaveBeenCalled()
    expect(cursor).not.toHaveBeenCalled()
  }
})
test('deduplicates normalized hints and bounds count and payload size', () => {
  expect(normalizeVocabulary(['cafe\u0301', 'Café', '<bad>', '東京'])).toEqual([
    'café',
    '東京',
  ])
  expect(
    normalizeVocabulary(Array.from({ length: 600 }, (_, i) => `term${i}`)),
  ).toHaveLength(500)
  expect(
    normalizeVocabulary(
      Array.from({ length: 100 }, (_, i) => `${i}${'x'.repeat(90)}`),
    ).join(',').length,
  ).toBeLessThanOrEqual(5000)
})
