interface RecordingTimerProps {
  elapsedSeconds: number
  color?: string
}

export const RecordingTimer = ({
  elapsedSeconds,
  color = 'white',
}: RecordingTimerProps) => {
  const minutes = Math.floor(elapsedSeconds / 60)
  const seconds = elapsedSeconds % 60
  const formatted = `${minutes}:${seconds.toString().padStart(2, '0')}`

  return (
    <span
      style={{
        fontFamily: 'monospace',
        fontSize: '12px',
        color,
        minWidth: '28px',
        textAlign: 'right',
      }}
    >
      {formatted}
    </span>
  )
}
