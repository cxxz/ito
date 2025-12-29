/**
 * Add polish mode settings columns to llm_settings table.
 * These settings control the optional LLM polish step for TRANSCRIBE mode.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = pgm => {
  pgm.addColumns('llm_settings', {
    polish_enabled: {
      type: 'boolean',
      notNull: false,
      default: null,
    },
    polish_llm_provider: {
      type: 'text',
      notNull: false,
      default: null,
    },
    polish_llm_model: {
      type: 'text',
      notNull: false,
      default: null,
    },
    polish_llm_temperature: {
      type: 'decimal',
      notNull: false,
      default: null,
    },
  })
}

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = pgm => {
  pgm.dropColumns('llm_settings', [
    'polish_enabled',
    'polish_llm_provider',
    'polish_llm_model',
    'polish_llm_temperature',
  ])
}
