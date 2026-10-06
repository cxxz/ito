/** Provider capabilities shared with the desktop settings UI. No server dependencies. */
export function getAsrCapabilities(provider: string, model: string) {
  const normalizedProvider = provider.trim().toLowerCase()
  const normalizedModel = model.trim().toLowerCase()
  return {
    prompt:
      (normalizedProvider === 'openai' &&
        !normalizedModel.includes('diarize')) ||
      (normalizedProvider === 'groq' && normalizedModel.includes('whisper')) ||
      (normalizedProvider === 'aliyun' &&
        normalizedModel.startsWith('qwen3-asr-flash')),
    noSpeechProbability:
      (normalizedProvider === 'openai' && normalizedModel === 'whisper-1') ||
      (normalizedProvider === 'groq' && normalizedModel.includes('whisper')),
  }
}

/** Reject the recording only when every reported segment is confidently silent. */
export function getNoSpeechProbability(
  segments: unknown,
  threshold: number,
): number | undefined {
  if (
    !Number.isFinite(threshold) ||
    threshold <= 0 ||
    threshold > 1 ||
    !Array.isArray(segments) ||
    segments.length === 0
  )
    return undefined
  const probabilities = segments.map(segment => segment?.no_speech_prob)
  if (
    !probabilities.every(
      probability =>
        typeof probability === 'number' &&
        Number.isFinite(probability) &&
        probability >= 0 &&
        probability <= 1 &&
        probability > threshold,
    )
  )
    return undefined
  return Math.min(...probabilities)
}
