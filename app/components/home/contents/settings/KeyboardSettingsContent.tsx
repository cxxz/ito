import { useSettingsStore } from '@/app/store/useSettingsStore'
import { ItoMode } from '@/app/generated/ito_pb'
import MultiShortcutEditor from '@/app/components/ui/multi-shortcut-editor'
import TriggerModeSelector from '@/app/components/ui/trigger-mode-selector'
import type { TriggerType } from '@/lib/types/keyboard'

export default function KeyboardSettingsContent() {
  const {
    getItoModeShortcuts,
    updateShortcutTriggerType,
    updateKeyboardShortcut,
  } = useSettingsStore()
  const transcribeShortcuts = getItoModeShortcuts(ItoMode.TRANSCRIBE)
  const editShortcuts = getItoModeShortcuts(ItoMode.EDIT)

  // Get current trigger type for TRANSCRIBE mode (use first shortcut's type)
  const transcribeTriggerType: TriggerType =
    transcribeShortcuts[0]?.triggerType || 'hold'

  const handleTriggerTypeChange = async (triggerType: TriggerType) => {
    // Update all TRANSCRIBE shortcuts to use the new trigger type
    for (const shortcut of transcribeShortcuts) {
      // When switching to double-tap, also update keys to control-left if needed
      // Double-tap only works with single-key shortcuts
      if (triggerType === 'double-tap') {
        // If the shortcut doesn't have control-left as a single key, update it
        const hasCtrl =
          shortcut.keys.length === 1 &&
          (shortcut.keys[0] === 'control-left' ||
            shortcut.keys[0] === 'control-right')
        if (!hasCtrl) {
          await updateKeyboardShortcut(shortcut.id, ['control-left'])
        }
      }

      // Update the trigger type after updating keys (to ensure correct state)
      updateShortcutTriggerType(shortcut.id, triggerType)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="space-y-6">
          <div className="flex gap-4 justify-between">
            <div className="w-1/3">
              <div className="text-sm font-medium mb-2">Keyboard Shortcut</div>
              <div className="text-xs text-gray-600 mb-4">
                {transcribeTriggerType === 'double-tap'
                  ? 'Double-tap the key to start recording, double-tap again to stop and transcribe.'
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
