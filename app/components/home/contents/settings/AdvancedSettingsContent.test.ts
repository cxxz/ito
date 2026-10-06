import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { Window, type HTMLInputElement } from 'happy-dom'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
const dom = new Window({ url: 'file:///Applications/Ito.app/index.html' })
Object.assign(globalThis, {
  window: dom,
  document: dom.document,
  HTMLElement: dom.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
})
Object.assign(dom, {
  electron: { store: { get: () => ({}), set: () => {} } },
  api: { on: () => () => {}, updateAdvancedSettings: async () => {} },
})
mock.module('@/app/components/window/WindowContext', () => ({
  useWindowContext: () => ({ window: { platform: 'darwin' } }),
}))
const { useAdvancedSettingsStore } = await import(
  '@/app/store/useAdvancedSettingsStore'
)
const { default: Content } = await import('./AdvancedSettingsContent')
let root: Root
let container: any
beforeEach(async () => {
  useAdvancedSettingsStore.setState({
    llm: {
      asrProvider: 'aliyun',
      asrModel: 'qwen-audio-3.1-asr-flash',
      asrPrompt: 'Saved context',
      noSpeechThreshold: 0.6,
    } as any,
  })
  container = dom.document.createElement('div')
  dom.document.body.append(container)
  root = createRoot(container as Element)
  await act(async () => root.render(createElement(Content)))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
const input = (name: string) =>
  container.querySelector(`#${name}`) as HTMLInputElement
test('unsupported options are explained while saved settings survive provider changes', async () => {
  expect(input('asrPrompt').readOnly).toBe(true)
  expect(input('noSpeechThreshold').readOnly).toBe(true)
  expect(container.textContent).toContain('dictionary hints only')
  expect(container.textContent).toContain('Turn off for faster raw dictation')
  await act(async () =>
    useAdvancedSettingsStore.setState(state => ({
      llm: { ...state.llm, asrProvider: 'openai', asrModel: 'whisper-1' },
    })),
  )
  expect(input('asrPrompt').readOnly).toBe(false)
  expect(input('noSpeechThreshold').readOnly).toBe(false)
  expect(useAdvancedSettingsStore.getState().llm.asrPrompt).toBe(
    'Saved context',
  )
  expect(useAdvancedSettingsStore.getState().llm.noSpeechThreshold).toBe(0.6)
  await act(async () =>
    useAdvancedSettingsStore.setState(state => ({
      llm: { ...state.llm, asrProvider: 'aliyun', asrModel: 'qwen3-asr-flash' },
    })),
  )
  expect(input('asrPrompt').readOnly).toBe(false)
  expect(input('noSpeechThreshold').readOnly).toBe(true)
  expect(container.textContent).toContain('background context or terminology')
})
