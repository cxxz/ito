import { checkAccessibilityPermission } from '../utils/crossPlatform'
import { KeyListenerProcess, startKeyListener } from './keyboard'

// Accessibility approval can arrive after startup, including after onboarding.
export function ensureKeyboardListener(): boolean {
  const allowed = checkAccessibilityPermission(false)
  if (allowed && !KeyListenerProcess) startKeyListener()
  return allowed
}
