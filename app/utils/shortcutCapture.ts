import { keyNameMap, type KeyName } from '@/lib/types/keyboard'

// DOM codes differ from rdev names for these physical keys.
const DOM_TO_NATIVE: Record<string, string> = {
  AltLeft: 'Alt',
  AltRight: 'AltGr',
  Enter: 'Return',
  ArrowUp: 'UpArrow',
  ArrowDown: 'DownArrow',
  ArrowLeft: 'LeftArrow',
  ArrowRight: 'RightArrow',
  BracketLeft: 'LeftBracket',
  BracketRight: 'RightBracket',
  Period: 'Dot',
  Fn: 'Function',
  NumpadEnter: 'KpReturn',
  NumpadAdd: 'KpPlus',
  NumpadSubtract: 'KpMinus',
  NumpadMultiply: 'KpMultiply',
  NumpadDivide: 'KpDivide',
  NumpadDecimal: 'KpDelete',
}

const MODIFIERS = [
  ['ctrlKey', 'control'],
  ['altKey', 'option'],
  ['shiftKey', 'shift'],
  ['metaKey', 'command'],
] as const

export function shortcutKeyFromCode(code: string): KeyName | null {
  if (!code || code === 'Unidentified') return null
  const native =
    DOM_TO_NATIVE[code] ??
    code.replace(/^Digit(\d)$/, 'Num$1').replace(/^Numpad(\d)$/, 'Kp$1')
  return (keyNameMap[native] ?? native.toLowerCase()) as KeyName
}

/** Capture inside Ito even when macOS has not allowed the global listener. */
export function captureShortcutKeys(onPress: (key: KeyName) => void) {
  window.api.setShortcutEditing(true)
  const pressed = new Set<KeyName>()
  const press = (key: KeyName) => {
    if (pressed.has(key)) return
    pressed.add(key)
    onPress(key)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    const key = shortcutKeyFromCode(
      event.code || (event.key === 'Fn' ? 'Fn' : ''),
    )
    if (!key) return
    event.preventDefault()
    event.stopPropagation()
    if (event.repeat) return
    for (const [flag, name] of MODIFIERS) {
      // A modifier may have been held before the window gained focus. Preserve
      // its side when we saw its own keydown; otherwise use the left default.
      if (
        event[flag] &&
        !key.startsWith(`${name}-`) &&
        !Array.from(pressed).some(held => held.startsWith(`${name}-`))
      ) {
        press(`${name}-left`)
      }
    }
    if (key === 'fn') {
      press(key)
    } else {
      // macOS can omit a letter's keyup while Command is held. A fresh,
      // non-repeating DOM keydown is a new press even if that release was lost.
      pressed.add(key)
      onPress(key)
    }
  }
  const onKeyUp = (event: KeyboardEvent) => {
    const key = shortcutKeyFromCode(
      event.code || (event.key === 'Fn' ? 'Fn' : ''),
    )
    if (key) pressed.delete(key)
    for (const [flag, name] of MODIFIERS) {
      if (!event[flag]) {
        pressed.delete(`${name}-left`)
        pressed.delete(`${name}-right`)
      }
    }
  }
  const onBlur = () => pressed.clear()

  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('keyup', onKeyUp, true)
  window.addEventListener('blur', onBlur)
  // macOS may omit Fn from DOM events. Keep native capture only for that key,
  // so ordinary keys cannot be toggled twice by DOM and native notifications.
  const unsubscribe = window.api.onKeyEvent(event => {
    if (!document.hasFocus() || keyNameMap[event.key] !== 'fn') return
    if (event.type === 'keydown') press('fn')
    else if (event.type === 'keyup') pressed.delete('fn')
  })

  return () => {
    window.api.setShortcutEditing(false)
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('keyup', onKeyUp, true)
    window.removeEventListener('blur', onBlur)
    unsubscribe?.()
    pressed.clear()
  }
}
