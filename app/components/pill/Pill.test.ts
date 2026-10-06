import { afterEach, beforeEach, expect, test } from 'bun:test'
import { Window, type HTMLButtonElement, type HTMLDivElement } from 'happy-dom'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const dom = new Window({ url: 'file:///Applications/Ito.app/index.html#/pill' })
Object.assign(globalThis, {
  window: dom,
  document: dom.document,
  HTMLElement: dom.HTMLElement,
  MutationObserver: dom.MutationObserver,
  getComputedStyle: dom.getComputedStyle.bind(dom),
  IS_REACT_ACT_ENVIRONMENT: true,
})

const initialAdvancedSettings = {
  llm: {
    asrProvider: 'groq',
    asrModel: 'whisper-large-v3',
    asrPrompt: null,
    llmProvider: null,
    llmModel: null,
    llmTemperature: null,
    llmBaseUrl: null,
    transcriptionPrompt: 'Keep my terminology',
    editingPrompt: null,
    noSpeechThreshold: null,
    polishEnabled: null,
    polishLlmProvider: 'openai',
    polishLlmModel: 'gpt-5-mini',
    polishLlmTemperature: 0.7,
  },
  defaults: { polishEnabled: true },
  grammarServiceEnabled: true,
  macosAccessibilityContextEnabled: true,
}
let saved: Record<string, any> = {
  settings: { showItoBarAlways: true },
  onboarding: { onboardingCompleted: true },
  advancedSettings: structuredClone(initialAdvancedSettings),
}
const listeners = new Map<string, Set<(payload?: any) => void>>()
let serverWrites: any[] = []
let messages: string[] = []
let ignoredMouseEvents: boolean[] = []
let syncError: Error | undefined

Object.assign(dom, {
  electron: {
    store: {
      get: (key: string) => saved[key],
      set: (key: string, value: any) => {
        saved[key] = structuredClone(value)
      },
    },
  },
  api: {
    on: (channel: string, listener: (payload?: any) => void) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set())
      listeners.get(channel)!.add(listener)
      return () => listeners.get(channel)!.delete(listener)
    },
    send: (channel: string) => messages.push(channel),
    setPillMouseEvents: (ignore: boolean) => ignoredMouseEvents.push(ignore),
    updateAdvancedSettings: async (settings: any) => {
      serverWrites.push(structuredClone(settings))
      if (syncError) throw syncError
    },
  },
})

const { default: Pill } = await import('./Pill')
const { useAdvancedSettingsStore } = await import(
  '@/app/store/useAdvancedSettingsStore'
)
const { useAudioStore } = await import('@/app/store/useAudioStore')
let root: Root
let container: HTMLDivElement

beforeEach(async () => {
  saved = {
    settings: { showItoBarAlways: true },
    onboarding: { onboardingCompleted: true },
    advancedSettings: structuredClone(initialAdvancedSettings),
  }
  serverWrites = []
  messages = []
  ignoredMouseEvents = []
  syncError = undefined
  useAdvancedSettingsStore.setState(saved.advancedSettings)
  useAudioStore.setState({ isRecording: false, isShortcutEnabled: true })
  container = dom.document.createElement('div')
  dom.document.body.append(container)
  root = createRoot(container as unknown as Element)
  await act(async () => root.render(createElement(Pill)))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

function pill() {
  return container.lastElementChild!.lastElementChild as HTMLDivElement
}

function polishButton() {
  return container.querySelector(
    'button[aria-label="Polish transcriptions"]',
  ) as HTMLButtonElement | null
}

async function hover() {
  await act(async () => {
    pill().dispatchEvent(new dom.MouseEvent('mouseover', { bubbles: true }))
  })
}

async function emit(channel: string, payload?: any) {
  await act(async () => {
    listeners.get(channel)?.forEach(listener => listener(payload))
  })
}

test('hover exposes one icon toggle with the effective default and keeps it reachable', async () => {
  expect(polishButton()).toBeNull()
  await hover()
  const button = polishButton()!
  expect(button.getAttribute('aria-pressed')).toBe('true')
  expect(button.textContent).toBe('')
  expect(button.querySelector('svg')).not.toBeNull()
  expect(button.title).toContain('On')
  expect(container.querySelectorAll('button').length).toBe(1)

  await act(async () => {
    pill().dispatchEvent(
      new dom.MouseEvent('mouseout', { bubbles: true, relatedTarget: button }),
    )
    button.dispatchEvent(
      new dom.MouseEvent('mouseover', {
        bubbles: true,
        relatedTarget: pill(),
      }),
    )
  })
  expect(polishButton()).not.toBeNull()
  expect(ignoredMouseEvents.at(-1)).toBe(false)

  await act(async () => {
    button.dispatchEvent(new dom.MouseEvent('mouseout', { bubbles: true }))
  })
  expect(polishButton()).toBeNull()
  expect(ignoredMouseEvents.at(-1)).toBe(true)
})

test('the shortcut toggles and persists only polishing without starting a recording', async () => {
  await hover()
  await act(async () => polishButton()!.click())
  expect(polishButton()!.getAttribute('aria-pressed')).toBe('false')
  expect(saved.advancedSettings.llm).toEqual({
    ...initialAdvancedSettings.llm,
    polishEnabled: false,
  })
  expect(saved.advancedSettings.grammarServiceEnabled).toBe(true)
  expect(saved.advancedSettings.macosAccessibilityContextEnabled).toBe(true)
  expect(saved.advancedSettings.defaults.polishEnabled).toBe(true)
  expect(saved.advancedSettingsDirty).toBe(true)
  expect(serverWrites[0].llm.polishEnabled).toBe(false)
  expect(messages).toEqual([])

  await act(async () => polishButton()!.click())
  expect(polishButton()!.getAttribute('aria-pressed')).toBe('true')
  expect(serverWrites[1].llm.polishEnabled).toBe(true)
  expect(messages).toEqual([])
})

test('settings changes from another window update the open shortcut', async () => {
  await hover()
  saved.advancedSettings.llm.polishEnabled = false
  await emit('advanced-settings-updated')
  expect(polishButton()!.getAttribute('aria-pressed')).toBe('false')
  saved.advancedSettings.llm.polishEnabled = true
  await emit('advanced-settings-updated')
  expect(polishButton()!.getAttribute('aria-pressed')).toBe('true')
  expect(serverWrites).toEqual([])
})

test('polishing stays saved locally when the server is unavailable', async () => {
  syncError = new Error('Offline')
  await hover()
  await act(async () => polishButton()!.click())
  expect(saved.advancedSettings.llm.polishEnabled).toBe(false)
  expect(saved.advancedSettingsDirty).toBe(true)
  expect(polishButton()!.getAttribute('aria-pressed')).toBe('false')
})

test('clicking the pill still starts recording and hides the shortcuts', async () => {
  await hover()
  await act(async () => pill().click())
  expect(messages).toEqual(['start-native-recording'])
  expect(polishButton()).toBeNull()
})

test('shortcuts stay hidden while transcription or polishing is processing', async () => {
  await hover()
  await emit('processing-state-update', { isProcessing: true })
  expect(polishButton()).toBeNull()
  await emit('polish-state-update', { isPolishing: true })
  expect(polishButton()).toBeNull()
  expect(container.textContent).toContain('Polishing')
})

test.each([
  ['macOS', 'MacBook Pro Microphone'],
  ['Windows', 'Microphone Array (Intel Smart Sound Technology)'],
])(
  'shows the selected native microphone name on %s',
  async (_platform, name) => {
    saved.settings.microphoneDeviceId = name
    // Settings may use a generic friendly label; show the actual recorder name.
    saved.settings.microphoneName = 'Built-in mic (recommended)'
    await hover()
    const status = container.querySelector('[role="status"]')!
    expect(status.textContent).toBe(name)
    expect(status.getAttribute('title')).toBe(
      `Transcription microphone: ${name}`,
    )
    expect(container.textContent).not.toContain('Click and start speaking')
    expect(container.querySelectorAll('button').length).toBe(1)
  },
)

test('shows System default for automatic microphone selection', async () => {
  saved.settings.microphoneDeviceId = 'default'
  saved.settings.microphoneName = 'Auto-detect'
  await hover()
  expect(container.querySelector('[role="status"]')!.textContent).toBe(
    'System default',
  )
})

test('microphone changes in Settings refresh the open popup', async () => {
  await hover()
  saved.settings.microphoneDeviceId = 'USB Podcast Microphone'
  await emit('settings-update', saved.settings)
  expect(container.querySelector('[role="status"]')!.textContent).toBe(
    'USB Podcast Microphone',
  )
  expect(messages).toEqual([])
})

test('reopening the popup refreshes microphone changes made through the tray', async () => {
  await hover()
  await act(async () => {
    polishButton()!.dispatchEvent(
      new dom.MouseEvent('mouseout', { bubbles: true }),
    )
  })
  saved.settings.microphoneDeviceId = 'Headset Microphone (USB Audio)'
  await hover()
  expect(container.querySelector('[role="status"]')!.textContent).toBe(
    'Headset Microphone (USB Audio)',
  )
  expect(messages).toEqual([])
})

test('a failed insertion stays visible, can be dismissed and never starts recording on dismissal', async () => {
  await emit('settings-update', { showItoBarAlways: false })
  const message =
    'Text could not be inserted. Your transcript is saved in Recent activity.'
  await emit('transcription-error', { message })
  expect(container.querySelector('[role="alert"]')?.getAttribute('title')).toBe(
    message,
  )
  expect(pill().style.visibility).toBe('visible')
  await hover()
  await act(async () =>
    (
      container.querySelector(
        '[aria-label="Dismiss dictation error"]',
      ) as HTMLButtonElement
    ).click(),
  )
  expect(container.querySelector('[role="alert"]')).toBeNull()
  expect(messages).toEqual([])
})
test('the next successful recording clears the previous error', async () => {
  await emit('transcription-error', { message: 'Failed' })
  await emit('recording-state-update', { isRecording: true })
  await emit('recording-state-update', { isRecording: false })
  expect(container.querySelector('[role="alert"]')).toBeNull()
})
