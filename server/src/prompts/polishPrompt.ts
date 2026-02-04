/**
 * Builds the vocabulary dictionary section for the polish prompt.
 * Returns an empty string if no vocabulary is provided.
 */
export function buildVocabularySection(vocabulary: string[]): string {
  if (!vocabulary || vocabulary.length === 0) {
    return ''
  }

  const vocabularyList = vocabulary.join('\n')

  return `

<terminology_dictionary>
The raw ASR transcript may misspell domain-specific terms. Use this dictionary to correct close phonetic matches.

Canonical spellings (case-sensitive—use exactly as written):
${vocabularyList}

Dictionary rules:
- Apply a dictionary term only when the transcript contains a close phonetic or orthographic match AND the surrounding context supports it.
- Preserve the exact capitalization shown above.
- Do not force-fit a dictionary term when context makes a different word more plausible.
- For compound terms (e.g., "Claude Code"), match the full phrase, not individual words in isolation.
</terminology_dictionary>
`
}

/**
 * Creates the complete polish prompt by combining the base transcription prompt
 * with an optional vocabulary section.
 */
export function createPolishPrompt(
  basePrompt: string,
  vocabulary: string[],
): string {
  const vocabularySection = buildVocabularySection(vocabulary)
  const outputRules = `<error_detection>
Review the transcript for mathematical, logical, or scientific errors that conflict with your expert knowledge, especially in computer science.

- **Flag**: Arithmetic mistakes, contradictory claims (e.g., "A has more than B" when the stated numbers show the opposite), unit errors, or clearly wrong factual statements. In the field of machine learning, "The model outputs a 0.9 probability, so it's correct about 90% of the time" is a wrong statement because the softmax score is not inherently a calibrated probability; it's a normalized score that can be systematically overconfident (or underconfident).
- **Do not flag**: Stylistic choices, opinions, or judgments you are uncertain about.

If errors are found, list them starting on a new line after the polished transcript inside <comments></comments> tags. If no errors are found, output nothing after the polished transcript.
</error_detection>

<output_format>
- Output ONLY the polished transcript text, optionally followed by <comments> if errors were detected.
- No preamble, commentary, meta-notes, labels, or apologies.
- Do not wrap the polished transcript in quotation marks or code blocks.
</output_format>`

  if (!vocabularySection) {
    return `${basePrompt}\n${outputRules}`
  }

  return `${basePrompt}\n${vocabularySection}\n${outputRules}`
}
