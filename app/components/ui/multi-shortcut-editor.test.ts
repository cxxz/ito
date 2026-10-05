import { beforeEach, afterEach, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ItoMode } from '@/app/generated/ito_pb'

const dom = new Window({ url: 'file:///Applications/Ito.app/index.html' })
Object.assign(globalThis, {
  window: dom,
  document: dom.document,
  IS_REACT_ACT_ENVIRONMENT: true,
})

let saved: any
let shortcutsEnabled = true
let nativeKey: ((event: { type: string; key: string }) => void) | undefined
Object.assign(dom, {
  electron: {
    store: {
      get: () => saved,
      set: (_key: string, value: any) => {
        saved = structuredClone(value)
      },
    },
  },
  api: {
    setShortcutEditing: () => {},
    getPlatform: async () => 'darwin',
    registerHotkeys: async () => {},
    notifySettingsUpdate: () => {},
    send: (_channel: string, _key: string, enabled: boolean) => {
      shortcutsEnabled = enabled
    },
    onKeyEvent: (callback: typeof nativeKey) => {
      nativeKey = callback
      return () => {
        nativeKey = undefined
      }
    },
  },
})

const { default: MultiShortcutEditor } = await import('./multi-shortcut-editor')
const { useSettingsStore } = await import('@/app/store/useSettingsStore')
const { useShortcutEditingStore } = await import(
  '@/app/store/useShortcutEditingStore'
)
let root: Root
let container: HTMLDivElement

function Editor() {
  const shortcuts = useSettingsStore(state => state.keyboardShortcuts)
  return createElement(MultiShortcutEditor, {
    shortcuts,
    mode: ItoMode.TRANSCRIBE,
  })
}

beforeEach(async () => {
  saved = {
    keyboardShortcuts: [
      { id: 'original', mode: ItoMode.TRANSCRIBE, keys: ['fn'] },
    ],
  }
  shortcutsEnabled = true
  useSettingsStore.setState(saved)
  useShortcutEditingStore.setState({ activeEditor: null })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root.render(createElement(Editor))
  })
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
})

function button(label: string) {
  const found = Array.from(container.querySelectorAll('button')).find(
    el => el.getAttribute('aria-label') === label || el.textContent === label,
  )
  if (!found) throw new Error(`Missing button: ${label}`)
  return found
}

async function click(label: string) {
  await act(async () => {
    button(label).click()
  })
}

async function key(code: string, type = 'keydown', repeat = false) {
  await act(async () => {
    dom.dispatchEvent(
      new dom.KeyboardEvent(type, {
        code,
        repeat,
        bubbles: true,
        cancelable: true,
      }),
    )
  })
}

test('additional shortcuts inherit the mode trigger while preserving configurable keys', async () => {
  await act(async () => {
    useSettingsStore
      .getState()
      .updateShortcutTriggerType('original', 'double-tap')
    useSettingsStore.getState().createKeyboardShortcut(ItoMode.TRANSCRIBE)
  })
  expect(saved.keyboardShortcuts[1].triggerType).toBe('double-tap')
  expect(saved.keyboardShortcuts[1].keys).toEqual([])
  expect(saved.keyboardShortcuts[0].keys).toEqual(['fn'])
})

test('additional legacy hold shortcuts remain hold shortcuts', async () => {
  await act(async () => {
    useSettingsStore.getState().createKeyboardShortcut(ItoMode.TRANSCRIBE)
  })
  expect(saved.keyboardShortcuts[1].triggerType).toBe('hold')
})

test('edits and persists a shortcut in a packaged file:// page without native key events', async () => {
  await click('Edit shortcut')
  expect(shortcutsEnabled).toBe(false)
  await key('ControlRight')
  await key('Space')
  await click('Save shortcut')
  expect(saved.keyboardShortcuts[0].keys).toEqual(['control-right', 'space'])
  expect(shortcutsEnabled).toBe(true)
  expect(nativeKey).toBeUndefined()
})

test('adding a shortcut immediately captures keys and saves the new row', async () => {
  await click('Add another')
  expect(container.textContent).toContain('Press keys to add')
  await key('AltLeft')
  await key('KeyT')
  await click('Save shortcut')
  expect(saved.keyboardShortcuts).toHaveLength(2)
  expect(saved.keyboardShortcuts[1].keys).toEqual(['option-left', 't'])
})

test('repeated and native duplicate events do not toggle a held key off', async () => {
  await click('Edit shortcut')
  await key('ShiftLeft')
  await key('ShiftLeft', 'keydown', true)
  await act(async () => {
    nativeKey?.({ type: 'keydown', key: 'ShiftLeft' })
  })
  await key('Digit1')
  await click('Save shortcut')
  expect(saved.keyboardShortcuts[0].keys).toEqual(['shift-left', '1'])
})

test('captures modifiers already held before the editor receives a key event', async () => {
  await click('Edit shortcut')
  await act(async () => {
    dom.dispatchEvent(
      new dom.KeyboardEvent('keydown', {
        code: 'KeyT',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
  })
  await click('Save shortcut')
  expect(saved.keyboardShortcuts[0].keys).toEqual([
    'control-left',
    'shift-left',
    't',
  ])
})

test('a fresh key press works when macOS omitted keyup during a Command combination', async () => {
  await click('Edit shortcut')
  await act(async () => {
    dom.dispatchEvent(
      new dom.KeyboardEvent('keydown', {
        code: 'KeyT',
        ctrlKey: true,
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
  })
  // macOS/Electron sometimes never deliver the preceding letter's keyup.
  await key('KeyT')
  await click('Save shortcut')
  expect(saved.keyboardShortcuts[0].keys).toEqual([
    'control-left',
    'command-left',
  ])
})

test('Fn can be configured even when macOS does not deliver it', async () => {
  await click('Edit shortcut')
  await click('Add Fn')
  await key('ControlLeft')
  await click('Save shortcut')
  expect(saved.keyboardShortcuts[0].keys).toEqual(['control-left', 'fn'])
})

test('native and DOM Fn events are deduplicated when permission is available', async () => {
  const originalHasFocus = document.hasFocus
  document.hasFocus = () => true
  try {
    await click('Edit shortcut')
    await act(async () => {
      nativeKey?.({ type: 'keydown', key: 'Function' })
    })
    await key('Fn')
    await click('Save shortcut')
    expect(saved.keyboardShortcuts[0].keys).toEqual(['fn'])
  } finally {
    document.hasFocus = originalHasFocus
  }
})

test('reserved shortcuts remain editable and show validation before saving', async () => {
  await click('Edit shortcut')
  await key('MetaLeft')
  await key('KeyQ')
  await click('Save shortcut')
  expect(container.textContent).toContain('System quit command')
  expect(saved.keyboardShortcuts[0].keys).toEqual(['fn'])
  await click('Cancel')
})

test('cancel preserves the shortcut and releases the editing lock', async () => {
  await click('Edit shortcut')
  await key('KeyA')
  await click('Cancel')
  expect(saved.keyboardShortcuts[0].keys).toEqual(['fn'])
  expect(shortcutsEnabled).toBe(true)
  expect(useShortcutEditingStore.getState().activeEditor).toBeNull()
  expect(button('Add another').disabled).toBe(false)
})

test('closing the editor releases keyboard capture and re-enables shortcuts', async () => {
  await click('Edit shortcut')
  await act(async () => {
    root.render(null)
  })
  expect(shortcutsEnabled).toBe(true)
  expect(nativeKey).toBeUndefined()
  expect(useShortcutEditingStore.getState().activeEditor).toBeNull()
})
