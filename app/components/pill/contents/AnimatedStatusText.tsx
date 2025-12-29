import React from 'react'

interface AnimatedStatusTextProps {
  text: string // "Polishing" or "Editing"
  color?: string
}

const dotAnimationStyles = `
  @keyframes dotFade1 {
    0%, 20% { opacity: 0; }
    25%, 100% { opacity: 1; }
  }
  @keyframes dotFade2 {
    0%, 40% { opacity: 0; }
    45%, 100% { opacity: 1; }
  }
  @keyframes dotFade3 {
    0%, 60% { opacity: 0; }
    65%, 95% { opacity: 1; }
    100% { opacity: 0; }
  }
`

export const AnimatedStatusText: React.FC<AnimatedStatusTextProps> = ({
  text,
  color = 'white',
}) => {
  return (
    <>
      <style>{dotAnimationStyles}</style>
      <span
        style={{
          color,
          fontSize: '12px',
          fontFamily: 'monospace',
          whiteSpace: 'nowrap',
        }}
      >
        {text}
        <span style={{ animation: 'dotFade1 1.5s infinite' }}>.</span>
        <span style={{ animation: 'dotFade2 1.5s infinite' }}>.</span>
        <span style={{ animation: 'dotFade3 1.5s infinite' }}>.</span>
      </span>
    </>
  )
}
