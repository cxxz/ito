import { Microphone, Sparkles } from '@mynaui/icons-react'

interface PillHoverMenuProps {
  microphoneName: string
  polishEnabled: boolean
  onTogglePolish: () => void
}

const styles = `
  .pill-shortcut {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.05);
    color: #aeb4be;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }
  .pill-shortcut:hover {
    background: rgba(255, 255, 255, 0.14);
    color: white;
  }
  .pill-shortcut[aria-pressed="true"] {
    background: rgba(96, 165, 250, 0.2);
    border-color: rgba(96, 165, 250, 0.55);
    color: #93c5fd;
  }
  .pill-shortcut[aria-pressed="true"]:hover {
    background: rgba(96, 165, 250, 0.3);
  }
  .pill-shortcut:focus-visible {
    outline: 2px solid #93c5fd;
    outline-offset: 2px;
  }
`

export const PillHoverMenu = ({
  microphoneName,
  polishEnabled,
  onTogglePolish,
}: PillHoverMenuProps) => (
  // Padding bridges the gap so moving up from the pill keeps the menu open.
  <div
    style={{
      position: 'absolute',
      bottom: '100%',
      left: '50%',
      transform: 'translateX(-50%)',
      paddingBottom: '8px',
      pointerEvents: 'auto',
    }}
  >
    <style>{styles}</style>
    <div
      style={{
        width: '196px',
        boxSizing: 'border-box',
        padding: '10px 12px',
        border: '1px solid rgba(255, 255, 255, 0.14)',
        borderRadius: '12px',
        background: 'rgba(24, 24, 27, 0.96)',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.18)',
        color: 'white',
      }}
    >
      <div
        role="status"
        aria-label={`Transcription microphone: ${microphoneName}`}
        title={`Transcription microphone: ${microphoneName}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          minWidth: 0,
          fontSize: '12px',
          lineHeight: '18px',
          color: '#d4d4d8',
        }}
      >
        <Microphone
          width={14}
          height={14}
          style={{ flexShrink: 0 }}
          aria-hidden="true"
        />
        <span
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {microphoneName}
        </span>
      </div>
      <div
        role="group"
        aria-label="Quick settings"
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '8px',
          marginTop: '8px',
        }}
      >
        <button
          type="button"
          className="pill-shortcut"
          aria-label="Polish transcriptions"
          aria-pressed={polishEnabled}
          title={`Polish transcriptions: ${polishEnabled ? 'On' : 'Off'}. Click to turn ${polishEnabled ? 'off' : 'on'}.`}
          onClick={event => {
            event.stopPropagation()
            onTogglePolish()
          }}
        >
          <Sparkles width={18} height={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  </div>
)
