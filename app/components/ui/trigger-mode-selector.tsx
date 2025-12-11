import type { TriggerType } from '@/lib/types/keyboard'

interface TriggerModeSelectorProps {
  value: TriggerType
  onChange: (value: TriggerType) => void
  disabled?: boolean
}

export default function TriggerModeSelector({
  value,
  onChange,
  disabled = false,
}: TriggerModeSelectorProps) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onChange('double-tap')}
        disabled={disabled}
        className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
          value === 'double-tap'
            ? 'bg-purple-100 border-purple-300 text-purple-700'
            : 'bg-white border-neutral-300 text-neutral-600 hover:bg-neutral-50'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        Double-tap to toggle
      </button>
      <button
        type="button"
        onClick={() => onChange('hold')}
        disabled={disabled}
        className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
          value === 'hold'
            ? 'bg-purple-100 border-purple-300 text-purple-700'
            : 'bg-white border-neutral-300 text-neutral-600 hover:bg-neutral-50'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        Hold to record
      </button>
    </div>
  )
}
