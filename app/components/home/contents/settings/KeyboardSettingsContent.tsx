import { useSettingsStore } from '@/app/store/useSettingsStore'
import { ItoMode } from '@/app/generated/ito_pb'
import MultiShortcutEditor from '@/app/components/ui/multi-shortcut-editor'
import TriggerModeSelector from '@/app/components/ui/trigger-mode-selector'
import type { TriggerType } from '@/lib/types/keyboard'
import { useEffect, useState } from 'react'

export default function KeyboardSettingsContent() {
  const { getItoModeShortcuts, updateShortcutTriggerType } = useSettingsStore()
  const [accessibilityEnabled, setAccessibilityEnabled] = useState<
    boolean | null
  >(null)
  const [permissionError, setPermissionError] = useState('')

  useEffect(() => {
    let disposed = false
    const checkPermission = async () => {
      try {
        const enabled = await window.api.startKeyListener()
        if (!disposed) {
          setAccessibilityEnabled(enabled)
          setPermissionError('')
        }
      } catch {
        if (!disposed)
          setPermissionError(
            'Unable to check keyboard access. Please reopen Ito.',
          )
      }
    }
    void checkPermission()
    const timer = setInterval(checkPermission, 2000)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [])

  const requestAccessibility = async () => {
    try {
      await window.api.invoke('check-accessibility-permission', true)
    } catch {
      setPermissionError(
        'Open System Settings → Privacy & Security → Accessibility and enable Ito.',
      )
    }
  }
  const transcribeShortcuts = getItoModeShortcuts(ItoMode.TRANSCRIBE)
  const editShortcuts = getItoModeShortcuts(ItoMode.EDIT)

  // Get current trigger type for TRANSCRIBE mode (use first shortcut's type)
  const transcribeTriggerType: TriggerType =
    transcribeShortcuts[0]?.triggerType || 'hold'

  const handleTriggerTypeChange = async (triggerType: TriggerType) => {
    // Update all TRANSCRIBE shortcuts to use the new trigger type
    for (const shortcut of transcribeShortcuts) {
      // Update the trigger type after updating keys (to ensure correct state)
      updateShortcutTriggerType(shortcut.id, triggerType)
    }
  }

  return (
    <div className="space-y-8">
      {accessibilityEnabled === false && (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
          role="status"
        >
          <p>
            You can edit shortcuts here. To use them in other apps, enable Ito
            in System Settings → Privacy &amp; Security → Accessibility. The
            installed app needs its own permission, separate from development.
          </p>
          <button
            type="button"
            className="mt-2 font-medium underline"
            onClick={requestAccessibility}
          >
            Enable Accessibility
          </button>
        </div>
      )}
      {permissionError && (
        <p role="alert" className="text-sm text-red-600">
          {permissionError}
        </p>
      )}
      <div>
        <div className="space-y-6">
          <div className="flex gap-4 justify-between">
            <div className="w-1/3">
              <div className="text-sm font-medium mb-2">Keyboard Shortcut</div>
              <div className="text-xs text-gray-600 mb-4">
                {transcribeTriggerType === 'double-tap'
                  ? 'Double-tap the shortcut to start recording, double-tap again to stop and transcribe.'
                  : 'Press and hold the keys to record, release to stop and transcribe.'}
              </div>

              {/* Trigger Mode Selector */}
              <div className="mt-4">
                <div className="text-xs text-gray-500 mb-2">
                  Activation mode
                </div>
                <TriggerModeSelector
                  value={transcribeTriggerType}
                  onChange={handleTriggerTypeChange}
                />
              </div>
            </div>
            <MultiShortcutEditor
              shortcuts={transcribeShortcuts}
              mode={ItoMode.TRANSCRIBE}
            />
          </div>
          <div className="flex gap-4 justify-between">
            <div className="w-1/3">
              <div className="text-sm font-medium mb-2">
                Intelligent Mode Shortcut
              </div>
              <div className="text-xs text-gray-600 mb-4">
                Press and hold to activate Intelligent Mode. Speak to Ito, and
                the LLM's output is pasted into your text box.
              </div>
            </div>
            <MultiShortcutEditor
              shortcuts={editShortcuts}
              mode={ItoMode.EDIT}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
