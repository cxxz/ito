import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { HistoryCursor, HistoryItem } from '@/lib/types/history'

const dom = new Window({ url: 'file:///Applications/Ito.app/index.html' })
Object.assign(globalThis, {
  window: dom,
  document: dom.document,
  IS_REACT_ACT_ENVIRONMENT: true,
  confirm: () => true,
})

const setCurrentPage = mock()
const setAudioFromInteraction = mock()
mock.module('@/app/store/useSettingsStore', () => ({
  useSettingsStore: () => ({
    getItoModeShortcuts: () => [{ keys: ['control-left'] }],
  }),
}))
mock.module('@/app/store/useAuthStore', () => ({
  useAuthStore: () => ({ user: { name: 'Test User' } }),
}))
mock.module('@/app/store/useMainStore', () => ({
  useMainStore: () => ({ setCurrentPage }),
}))
mock.module('@/app/store/usePlaygroundStore', () => ({
  usePlaygroundStore: () => ({ setAudioFromInteraction }),
}))
mock.module('../../ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipContent: () => null,
}))
mock.module('@/app/utils/audioUtils', () => ({
  createStereo48kWavFromMonoPCM: () => new ArrayBuffer(8),
}))

const audioInstances: FakeAudio[] = []
class FakeAudio {
  currentTime = 0
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  play = mock(async () => {})
  pause = mock()
  constructor(public src: string) {
    audioInstances.push(this)
  }
}
Object.assign(globalThis, { Audio: FakeAudio })

let items: HistoryItem[]
const getAll = mock(async () => items)
const getPage = mock(async (before?: HistoryCursor | null) => {
  const start = before ? items.findIndex(row => row.id === before.id) + 1 : 0
  const page = items.slice(start, start + 50)
  const last = page.at(-1)
  return {
    items: page,
    nextCursor:
      start + 50 < items.length && last
        ? { createdAt: last.created_at, id: last.id }
        : null,
  }
})
const getById = mock<(id: string) => Promise<any>>(async id => ({
  id,
  raw_audio: new Uint8Array([0, 1]),
}))
const getIds = mock(async () => items.map(row => row.id))
const deleteInteraction = mock(async (id: string) => {
  items = items.filter(row => row.id !== id)
})
const listeners = new Map<string, () => void>()
Object.assign(dom, {
  api: {
    getPlatform: async () => 'darwin',
    interactions: {
      getAll,
      getPage,
      getById,
      getIds,
      delete: deleteInteraction,
      getStats: async () => ({
        streakDays: 2,
        totalWords: 900,
        weeklyWords: 900,
        averageWPM: 60,
      }),
    },
    on: (event: string, callback: () => void) => {
      listeners.set(event, callback)
      return () => listeners.delete(event)
    },
  },
})
const { default: HomeContent } = await import('./HomeContent')
let root: Root
let container: HTMLDivElement

beforeEach(async () => {
  items = Array.from({ length: 60 }, (_, i) => ({
    id: String(i),
    user_id: null,
    title: null,
    raw_audio_id: null,
    deleted_at: null,
    created_at: '2026-10-06T10:00:00.000Z',
    updated_at: '2026-10-06T10:00:00.000Z',
    asr_output: { transcript: `Transcript ${i}.` },
    llm_output: null,
    duration_ms: 1000,
    sample_rate: 16000,
    has_audio: true,
  }))
  for (const fn of [
    getAll,
    getPage,
    getById,
    getIds,
    deleteInteraction,
    setCurrentPage,
    setAudioFromInteraction,
  ])
    fn.mockClear()
  getById.mockImplementation(async id => ({
    id,
    raw_audio: new Uint8Array([0, 1]),
  }))
  audioInstances.length = 0
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(createElement(HomeContent)))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

function buttons(label: string) {
  return Array.from(container.querySelectorAll('button')).filter(
    el => el.getAttribute('aria-label') === label || el.textContent === label,
  )
}
async function click(label: string, index = 0) {
  const button = buttons(label)[index]
  if (!button) throw new Error(`Missing button ${label}`)
  await act(async () => button.click())
}

test('pages through bounded metadata without loading audio and keeps global statistics', async () => {
  expect(getAll).not.toHaveBeenCalled()
  expect(getById).not.toHaveBeenCalled()
  expect(buttons('Play audio')).toHaveLength(50)
  expect(container.textContent).toContain('900 words')
  await click('Older')
  expect(buttons('Play audio')).toHaveLength(10)
  expect(container.textContent).toContain('Page 2')
  expect(container.textContent).not.toContain('Transcript 0.')
  expect(getPage.mock.calls[1][0]?.id).toBe('49')
  await click('Newer')
  expect(buttons('Play audio')).toHaveLength(50)
  expect(container.textContent).toContain('Page 1')
  expect(getById).not.toHaveBeenCalled()
})

test('fetches only the selected audio when opening Playground', async () => {
  await click('Send to Playground', 3)
  expect(getById.mock.calls).toEqual([['3']])
  expect(setAudioFromInteraction.mock.calls[0][0]).toBe('3')
  expect(setAudioFromInteraction.mock.calls[0][1]).toBeInstanceOf(ArrayBuffer)
  expect(setCurrentPage).toHaveBeenCalledWith('playground')
})

test('stopping during an audio fetch prevents late playback', async () => {
  const pending = Promise.withResolvers<any>()
  getById.mockImplementationOnce(() => pending.promise)
  await click('Play audio')
  await click('Stop audio')
  await act(async () => pending.resolve({ raw_audio: new Uint8Array([0, 1]) }))
  expect(audioInstances).toHaveLength(0)
  expect(buttons('Stop audio')).toHaveLength(0)
})

test('a stale audio failure does not stop the new selection and navigation releases playback', async () => {
  const pending = Promise.withResolvers<any>()
  getById.mockImplementationOnce(() => pending.promise)
  await click('Play audio')
  await click('Play audio')
  expect(audioInstances).toHaveLength(1)
  await act(async () => pending.reject(new Error('stale fetch')))
  expect(buttons('Stop audio')).toHaveLength(1)
  expect(audioInstances[0].pause).not.toHaveBeenCalled()
  await click('Older')
  expect(audioInstances[0].pause).toHaveBeenCalledTimes(1)
  expect(buttons('Stop audio')).toHaveLength(0)
})

test('clear all includes records outside the current page', async () => {
  await click('Clear all')
  expect(getIds).toHaveBeenCalledTimes(1)
  expect(deleteInteraction).toHaveBeenCalledTimes(60)
  expect(items).toHaveLength(0)
  expect(container.textContent).toContain('No interactions yet')
  expect(getAll).not.toHaveBeenCalled()
  expect(getById).not.toHaveBeenCalled()
})
