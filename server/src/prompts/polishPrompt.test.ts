import { describe, it, expect } from 'bun:test'
import { buildVocabularySection, createPolishPrompt } from './polishPrompt.js'

describe('polishPrompt', () => {
  describe('buildVocabularySection', () => {
    it('should return empty string for empty vocabulary', () => {
      const result = buildVocabularySection([])
      expect(result).toBe('')
    })

    it('should return empty string for undefined vocabulary', () => {
      const result = buildVocabularySection(undefined as unknown as string[])
      expect(result).toBe('')
    })

    it('should format vocabulary list with one term per line', () => {
      const result = buildVocabularySection(['Kubernetes', 'gRPC', 'TypeScript'])

      expect(result).toContain('Kubernetes')
      expect(result).toContain('gRPC')
      expect(result).toContain('TypeScript')
      expect(result).toContain('<dictionary_list>')
      expect(result).toContain('</dictionary_list>')
    })

    it('should preserve case sensitivity in vocabulary', () => {
      const result = buildVocabularySection(['iPhone', 'macOS', 'iPad'])

      expect(result).toContain('iPhone')
      expect(result).toContain('macOS')
      expect(result).toContain('iPad')
    })

    it('should include dictionary rules section', () => {
      const result = buildVocabularySection(['test'])

      expect(result).toContain('Dictionary rules:')
      expect(result).toContain('phonetic/visual match')
      expect(result).toContain('capitalization')
    })

    it('should handle vocabulary with special characters', () => {
      const result = buildVocabularySection([
        'hello-world',
        'test_case',
        "it's",
      ])

      expect(result).toContain('hello-world')
      expect(result).toContain('test_case')
      expect(result).toContain("it's")
    })

    it('should handle single vocabulary item', () => {
      const result = buildVocabularySection(['SingleTerm'])

      expect(result).toContain('SingleTerm')
      expect(result).toContain('<dictionary_list>')
      expect(result).toContain('</dictionary_list>')
    })

    it('should join vocabulary with newlines', () => {
      const result = buildVocabularySection(['term1', 'term2', 'term3'])

      // Check that terms are joined with newlines inside the dictionary_list
      expect(result).toContain('term1\nterm2\nterm3')
    })
  })

  describe('createPolishPrompt', () => {
    const basePrompt = 'You are a transcript polisher.'

    it('should return base prompt unchanged when no vocabulary', () => {
      const result = createPolishPrompt(basePrompt, [])
      expect(result).toBe(basePrompt)
    })

    it('should return base prompt unchanged when vocabulary is undefined', () => {
      const result = createPolishPrompt(
        basePrompt,
        undefined as unknown as string[],
      )
      expect(result).toBe(basePrompt)
    })

    it('should append vocabulary section when vocabulary provided', () => {
      const result = createPolishPrompt(basePrompt, ['test'])

      expect(result).toContain(basePrompt)
      expect(result).toContain('<dictionary_list>')
      expect(result).toContain('test')
    })

    it('should place vocabulary section after base prompt', () => {
      const result = createPolishPrompt(basePrompt, ['term1', 'term2'])

      const basePromptIndex = result.indexOf(basePrompt)
      const dictionaryIndex = result.indexOf('<dictionary_list>')

      expect(basePromptIndex).toBeLessThan(dictionaryIndex)
    })

    it('should work with multi-line base prompt', () => {
      const multiLinePrompt = `You are a transcript polisher.
Remove disfluencies.
Preserve meaning.`

      const result = createPolishPrompt(multiLinePrompt, ['test'])

      expect(result).toContain(multiLinePrompt)
      expect(result).toContain('<dictionary_list>')
    })

    it('should handle large vocabulary lists', () => {
      const largeVocabulary = Array.from({ length: 100 }, (_, i) => `term${i}`)
      const result = createPolishPrompt(basePrompt, largeVocabulary)

      expect(result).toContain(basePrompt)
      expect(result).toContain('term0')
      expect(result).toContain('term99')
    })
  })
})
