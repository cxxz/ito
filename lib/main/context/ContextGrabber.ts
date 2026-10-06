import { ItoMode } from '@/app/generated/ito_pb'
import { DictionaryTable } from '../sqlite/repo'
import { getCurrentUserId, getAdvancedSettings } from '../store'
import { getActiveWindow } from '../../media/active-application'
import { getSelectedTextString } from '../../media/selected-text-reader'
import log from 'electron-log'
import { timingCollector, TimingEventName } from '../timing/TimingCollector'
import { macOSAccessibilityContextProvider } from '../../media/macOSAccessibilityContextProvider'

export interface ContextData {
  vocabularyWords: string[]
  windowTitle: string
  appName: string
  contextText: string
  advancedSettings: ReturnType<typeof getAdvancedSettings>
}

/**
 * ContextGrabber centralizes all context gathering logic for transcription streams.
 * It collects vocabulary, window info, selected text, and settings.
 */
export class ContextGrabber {
  /**
   * Gather all context data needed for a transcription stream
   */
  public async gatherContext(mode: ItoMode): Promise<ContextData> {
    console.log('[ContextGrabber] Gathering context for mode:', mode)

    // These reads are independent; do not serialize dictionary, window, and selection work.
    const [
      dictionaryVocabulary,
      { windowTitle, appName },
      contextText,
      selectedTextVocabulary,
    ] = await Promise.all([
      this.getVocabulary(),
      timingCollector.timeAsync(TimingEventName.WINDOW_CONTEXT_GATHER, () =>
        this.getWindowContext(),
      ),
      this.getContextText(mode),
      this.getSelectedTextVocabulary(mode),
    ])

    // Combine dictionary vocabulary with selected text vocabulary
    const vocabularyWords = normalizeVocabulary([
      ...dictionaryVocabulary,
      ...selectedTextVocabulary,
    ])

    // Get advanced settings
    const advancedSettings = getAdvancedSettings()

    console.log('[ContextGrabber] Context gathered successfully')

    return {
      vocabularyWords,
      windowTitle,
      appName,
      contextText,
      advancedSettings,
    }
  }

  /**
   * Gather vocabulary words only (dictionary + selected text).
   * Useful for refreshing vocabulary at the end of a recording.
   */
  public async gatherVocabularyWords(mode: ItoMode): Promise<string[]> {
    const dictionaryVocabulary = await this.getVocabulary()
    const selectedTextVocabulary = await this.getSelectedTextVocabulary(mode)
    return normalizeVocabulary([
      ...dictionaryVocabulary,
      ...selectedTextVocabulary,
    ])
  }

  private async getVocabulary(): Promise<string[]> {
    try {
      const userId = getCurrentUserId()
      const dictionaryItems = await DictionaryTable.findAll(userId)
      return dictionaryItems
        .filter(item => item.deleted_at === null)
        .map(item => item.word)
    } catch (error) {
      log.error('[ContextGrabber] Error getting vocabulary:', error)
      return []
    }
  }

  /**
   * Extract vocabulary words from selected text to use as temporary hints for ASR.
   * Splits text by common separators (comma, semicolon, newline) and validates each word.
   */
  private extractVocabularyFromText(text: string): string[] {
    if (!text || text.trim().length === 0) return []

    return normalizeVocabulary(text.slice(0, 5000).split(/[,;\n，；]+/)).slice(
      0,
      100,
    )
  }

  private async getSelectedTextVocabulary(mode: ItoMode): Promise<string[]> {
    if (mode === ItoMode.EDIT) {
      return []
    }

    const selectedTextVocabulary = this.extractVocabularyFromText(
      await this.getSelectedTextForVocabulary(),
    )

    if (selectedTextVocabulary.length > 0) {
      console.log(
        '[ContextGrabber] Extracted vocabulary from selected text:',
        selectedTextVocabulary.length,
      )
    }

    return selectedTextVocabulary
  }

  /**
   * Get selected text for vocabulary hints - works in ALL modes.
   * This is separate from getContextText which only works in EDIT mode.
   */
  private async getSelectedTextForVocabulary(): Promise<string> {
    try {
      const { macosAccessibilityContextEnabled } = getAdvancedSettings()
      if (process.platform === 'darwin') {
        if (!macosAccessibilityContextEnabled) return ''
        if (macOSAccessibilityContextProvider.isRunning()) {
          const result =
            await macOSAccessibilityContextProvider.getCursorContext({
              maxCharsBefore: 0,
              maxCharsAfter: 0,
              timeout: 500,
              debug: false,
            })
          if (result.success)
            return result.context?.selectedText?.slice(0, 5000) || ''
        }
      }
      // Never simulate copy or release modifier keys for optional dictation hints.
      return (await getSelectedTextString(5000, false)) || ''
    } catch (error) {
      log.error(
        '[ContextGrabber] Error getting selected text for vocabulary:',
        error,
      )
      return ''
    }
  }

  private async getWindowContext(): Promise<{
    windowTitle: string
    appName: string
  }> {
    try {
      const windowContext = await getActiveWindow()
      return {
        windowTitle: windowContext?.title || '',
        appName: windowContext?.appName || '',
      }
    } catch (error) {
      log.error('[ContextGrabber] Error getting window context:', error)
      return {
        windowTitle: '',
        appName: '',
      }
    }
  }

  private async getContextText(mode: ItoMode): Promise<string> {
    if (mode !== ItoMode.EDIT) {
      return ''
    }

    const { macosAccessibilityContextEnabled } = getAdvancedSettings()

    // Try accessibility API first if enabled
    if (
      process.platform === 'darwin' &&
      macosAccessibilityContextEnabled &&
      macOSAccessibilityContextProvider.isRunning()
    ) {
      try {
        const result = await timingCollector.timeAsync(
          TimingEventName.CURSOR_CONTEXT_GATHER,
          async () =>
            await macOSAccessibilityContextProvider.getCursorContext({
              maxCharsBefore: 1000,
              maxCharsAfter: 1000,
              timeout: 500,
              debug: false,
            }),
        )

        if (result.success && result.context?.selectedText) {
          console.log(
            '[ContextGrabber] Got selected text via accessibility API',
          )
          return result.context.selectedText.trim()
        }
      } catch (error) {
        console.log(
          '[ContextGrabber] Accessibility API failed, falling back to keyboard:',
          error,
        )
      }
    }

    // Fallback to keyboard-based method
    console.log('[ContextGrabber] Using keyboard method for selected text')
    try {
      const text = await timingCollector.timeAsync(
        TimingEventName.SELCTED_TEXT_GATHER,
        async () => await getSelectedTextString(),
      )
      console.log('[ContextGrabber] Selected text length:', text?.length || 0)
      return text && text.trim().length > 0 ? text : ''
    } catch (error) {
      log.error('[ContextGrabber] Error getting context text:', error)
      return ''
    }
  }

  /**
   * Get cursor context for grammar rules (capitalization, spacing, etc.)
   * This fetches a small amount of text before the cursor position.
   *
   * @param contextLength - Number of characters to fetch before cursor (default: 4)
   * @returns The text before the cursor, or empty string if unavailable
   */
  public async getCursorContextForGrammar(
    contextLength: number = 4,
  ): Promise<string> {
    const { macosAccessibilityContextEnabled } = getAdvancedSettings()

    // Try accessibility API first if enabled
    if (
      process.platform === 'darwin' &&
      macosAccessibilityContextEnabled &&
      macOSAccessibilityContextProvider.isRunning()
    ) {
      try {
        const result = await macOSAccessibilityContextProvider.getCursorContext(
          {
            maxCharsBefore: contextLength,
            maxCharsAfter: 0,
            timeout: 500,
            debug: false,
          },
        )

        if (result.success && result.context?.textBefore) {
          console.log(
            '[ContextGrabber] Got cursor context via accessibility API',
          )
          return result.context.textBefore
        }
      } catch (error) {
        console.log(
          '[ContextGrabber] Accessibility grammar context unavailable:',
          error,
        )
      }
    }

    // Optional grammar context must not change selection, clipboard, or held keys.
    return ''
  }
}

export const contextGrabber = new ContextGrabber()

/** Keep hints within the server limits, with dictionary terms taking priority. */
export function normalizeVocabulary(words: string[]): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  let characters = 0
  for (const input of words) {
    const word = input.normalize('NFC').trim().replace(/\s+/gu, ' ')
    if (!word || word.length > 100 || !/^[\p{L}\p{M}\p{N}._'’ -]+$/u.test(word))
      continue
    const key = word.toLowerCase()
    if (seen.has(key)) continue
    if (
      result.length >= 500 ||
      characters + word.length + (result.length ? 1 : 0) > 5000
    )
      break
    characters += word.length + (result.length ? 1 : 0)
    seen.add(key)
    result.push(word)
  }
  return result
}
