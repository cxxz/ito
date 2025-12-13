/**
 * Add llm_base_url column to llm_settings table for OpenAI-compatible API endpoints.
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
  pgm.addColumn('llm_settings', {
    llm_base_url: {
      type: 'text',
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
  pgm.dropColumn('llm_settings', 'llm_base_url')
}
