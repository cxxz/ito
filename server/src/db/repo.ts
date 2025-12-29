import pool from '../db.js'
import {
  Note,
  Interaction,
  DictionaryItem,
  LlmSettings,
  AdvancedSettings,
} from './models.js'
import {
  CreateNoteRequest,
  UpdateNoteRequest,
  UpdateInteractionRequest,
  CreateDictionaryItemRequest,
  UpdateDictionaryItemRequest,
  UpdateAdvancedSettingsRequest,
} from '../generated/ito_pb.js'

export class NotesRepository {
  static async create(
    noteData: CreateNoteRequest & { userId: string },
  ): Promise<Note> {
    const res = await pool.query<Note>(
      `INSERT INTO notes (id, user_id, interaction_id, content)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        noteData.id,
        noteData.userId,
        noteData.interactionId || null,
        noteData.content,
      ],
    )
    return res.rows[0]
  }

  static async findById(id: string): Promise<Note | undefined> {
    const res = await pool.query<Note>('SELECT * FROM notes WHERE id = $1', [
      id,
    ])
    return res.rows[0]
  }

  static async findByUserId(userId: string, since?: Date): Promise<Note[]> {
    let query = 'SELECT * FROM notes WHERE user_id = $1'
    const params: any[] = [userId]

    if (since) {
      query += ' AND (updated_at > $2 OR deleted_at > $2)'
      params.push(since)
    }

    query += ' ORDER BY updated_at ASC'

    const res = await pool.query<Note>(query, params)
    return res.rows
  }

  static async update(noteData: UpdateNoteRequest): Promise<Note | undefined> {
    const res = await pool.query<Note>(
      `UPDATE notes
       SET content = $1, updated_at = current_timestamp
       WHERE id = $2
       RETURNING *`,
      [noteData.content, noteData.id],
    )
    return res.rows[0]
  }

  static async softDelete(id: string): Promise<boolean> {
    const res = await pool.query(
      `UPDATE notes
       SET deleted_at = current_timestamp
       WHERE id = $1`,
      [id],
    )
    return (res.rowCount ?? 0) > 0
  }

  static async deleteAllUserData(userId: string): Promise<boolean> {
    const res = await pool.query(
      `UPDATE notes
       SET deleted_at = current_timestamp
       WHERE user_id = $1`,
      [userId],
    )
    return (res.rowCount ?? 0) > 0
  }

  static async hardDeleteAllUserData(userId: string): Promise<number> {
    const res = await pool.query('DELETE FROM notes WHERE user_id = $1', [
      userId,
    ])
    return res.rowCount ?? 0
  }
}

export class InteractionsRepository {
  static async create(interactionData: {
    id: string
    userId: string
    title: string
    asrOutput: string
    llmOutput: string | null
    durationMs: number
  }): Promise<Interaction> {
    const res = await pool.query<Interaction>(
      `INSERT INTO interactions (id, user_id, title, asr_output, llm_output, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        interactionData.id,
        interactionData.userId,
        interactionData.title,
        interactionData.asrOutput,
        interactionData.llmOutput,
        interactionData.durationMs ?? 0,
      ],
    )
    return res.rows[0]
  }

  static async findById(id: string): Promise<Interaction | undefined> {
    const res = await pool.query<Interaction>(
      'SELECT * FROM interactions WHERE id = $1 AND deleted_at IS NULL',
      [id],
    )
    return res.rows[0]
  }

  static async findByUserId(
    userId: string,
    since?: Date,
  ): Promise<Interaction[]> {
    let query = 'SELECT * FROM interactions WHERE user_id = $1'
    const params: any[] = [userId]

    if (since) {
      query += ' AND (updated_at > $2 OR deleted_at > $2)'
      params.push(since)
    }

    query += ' ORDER BY updated_at ASC'

    const res = await pool.query<Interaction>(query, params)
    return res.rows
  }

  static async update(
    interactionData: UpdateInteractionRequest,
  ): Promise<Interaction | undefined> {
    const res = await pool.query<Interaction>(
      `UPDATE interactions
       SET title = $1, updated_at = current_timestamp
       WHERE id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [interactionData.title, interactionData.id],
    )
    return res.rows[0]
  }

  static async softDelete(id: string): Promise<boolean> {
    const res = await pool.query(
      `UPDATE interactions
       SET deleted_at = current_timestamp,
           updated_at = current_timestamp,
           title = NULL,
           asr_output = NULL,
           llm_output = NULL,
           raw_audio = NULL,
           raw_audio_id = NULL
       WHERE id = $1`,
      [id],
    )
    return (res.rowCount ?? 0) > 0
  }

  static async deleteAllUserData(userId: string): Promise<boolean> {
    const res = await pool.query(
      `UPDATE interactions
       SET deleted_at = current_timestamp,
           updated_at = current_timestamp,
           title = NULL,
           asr_output = NULL,
           llm_output = NULL,
           raw_audio = NULL,
           raw_audio_id = NULL
       WHERE user_id = $1`,
      [userId],
    )
    return (res.rowCount ?? 0) > 0
  }

  static async hardDeleteAllUserData(userId: string): Promise<number> {
    const res = await pool.query(
      'DELETE FROM interactions WHERE user_id = $1',
      [userId],
    )
    return res.rowCount ?? 0
  }
}

export class DictionaryRepository {
  static async create(
    itemData: CreateDictionaryItemRequest & { userId: string },
  ): Promise<DictionaryItem> {
    const res = await pool.query<DictionaryItem>(
      `INSERT INTO dictionary_items (id, user_id, word, pronunciation)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [itemData.id, itemData.userId, itemData.word, itemData.pronunciation],
    )
    return res.rows[0]
  }

  static async findByUserId(
    userId: string,
    since?: Date,
  ): Promise<DictionaryItem[]> {
    let query = 'SELECT * FROM dictionary_items WHERE user_id = $1'
    const params: any[] = [userId]

    if (since) {
      query += ' AND (updated_at > $2 OR deleted_at > $2)'
      params.push(since)
    }

    query += ' ORDER BY updated_at ASC'

    const res = await pool.query<DictionaryItem>(query, params)
    return res.rows
  }

  static async update(
    itemData: UpdateDictionaryItemRequest,
  ): Promise<DictionaryItem | undefined> {
    const res = await pool.query<DictionaryItem>(
      `UPDATE dictionary_items
       SET word = $1, pronunciation = $2, updated_at = current_timestamp
       WHERE id = $3 AND deleted_at IS NULL
       RETURNING *`,
      [itemData.word, itemData.pronunciation, itemData.id],
    )
    return res.rows[0]
  }

  static async softDelete(id: string): Promise<boolean> {
    const res = await pool.query(
      `UPDATE dictionary_items
       SET deleted_at = current_timestamp
       WHERE id = $1`,
      [id],
    )
    return (res.rowCount ?? 0) > 0
  }

  static async deleteAllUserData(userId: string): Promise<boolean> {
    const res = await pool.query(
      `UPDATE dictionary_items
       SET deleted_at = current_timestamp
       WHERE user_id = $1`,
      [userId],
    )
    return (res.rowCount ?? 0) > 0
  }

  static async hardDeleteAllUserData(userId: string): Promise<number> {
    const res = await pool.query(
      'DELETE FROM dictionary_items WHERE user_id = $1',
      [userId],
    )
    return res.rowCount ?? 0
  }
}

export class AdvancedSettingsRepository {
  static async findByUserId(
    userId: string,
  ): Promise<AdvancedSettings | undefined> {
    const res = await pool.query<LlmSettings>(
      'SELECT * FROM llm_settings WHERE user_id = $1',
      [userId],
    )

    if (res.rows.length === 0) {
      return undefined
    }

    const llmSettings = res.rows[0]
    return {
      id: llmSettings.id,
      user_id: llmSettings.user_id,
      llm: {
        asr_model: llmSettings.asr_model,
        asr_provider: llmSettings.asr_provider,
        asr_prompt: llmSettings.asr_prompt,
        llm_provider: llmSettings.llm_provider,
        llm_model: llmSettings.llm_model,
        llm_temperature: llmSettings.llm_temperature,
        llm_base_url: llmSettings.llm_base_url,
        transcription_prompt: llmSettings.transcription_prompt,
        editing_prompt: llmSettings.editing_prompt,
        no_speech_threshold: llmSettings.no_speech_threshold,
        low_quality_threshold: llmSettings.low_quality_threshold,
        polish_enabled: llmSettings.polish_enabled,
        polish_llm_provider: llmSettings.polish_llm_provider,
        polish_llm_model: llmSettings.polish_llm_model,
        polish_llm_temperature: llmSettings.polish_llm_temperature,
      },
      created_at: llmSettings.created_at,
      updated_at: llmSettings.updated_at,
    }
  }

  static async upsert(
    userId: string,
    settingsData: UpdateAdvancedSettingsRequest,
  ): Promise<AdvancedSettings> {
    const toNullableString = (value?: string | null): string | null => {
      if (value === undefined || value === null) return null
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    }

    const res = await pool.query<LlmSettings>(
      `INSERT INTO llm_settings (
         user_id, asr_model, asr_provider, asr_prompt, llm_provider, llm_model,
         llm_temperature, llm_base_url, transcription_prompt, editing_prompt, no_speech_threshold,
         low_quality_threshold, polish_enabled, polish_llm_provider, polish_llm_model,
         polish_llm_temperature, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, current_timestamp)
       ON CONFLICT (user_id)
       DO UPDATE SET
         asr_model = EXCLUDED.asr_model,
         asr_provider = EXCLUDED.asr_provider,
         asr_prompt = EXCLUDED.asr_prompt,
         llm_provider = EXCLUDED.llm_provider,
         llm_model = EXCLUDED.llm_model,
         llm_temperature = EXCLUDED.llm_temperature,
         llm_base_url = EXCLUDED.llm_base_url,
         transcription_prompt = EXCLUDED.transcription_prompt,
         editing_prompt = EXCLUDED.editing_prompt,
         no_speech_threshold = EXCLUDED.no_speech_threshold,
         low_quality_threshold = EXCLUDED.low_quality_threshold,
         polish_enabled = EXCLUDED.polish_enabled,
         polish_llm_provider = EXCLUDED.polish_llm_provider,
         polish_llm_model = EXCLUDED.polish_llm_model,
         polish_llm_temperature = EXCLUDED.polish_llm_temperature,
         updated_at = current_timestamp
       RETURNING *`,
      [
        userId,
        toNullableString(settingsData.llm?.asrModel),
        toNullableString(settingsData.llm?.asrProvider),
        toNullableString(settingsData.llm?.asrPrompt),
        toNullableString(settingsData.llm?.llmProvider),
        toNullableString(settingsData.llm?.llmModel),
        settingsData.llm?.llmTemperature ?? null,
        toNullableString(settingsData.llm?.llmBaseUrl),
        toNullableString(settingsData.llm?.transcriptionPrompt),
        toNullableString(settingsData.llm?.editingPrompt),
        settingsData.llm?.noSpeechThreshold ?? null,
        settingsData.llm?.lowQualityThreshold ?? null,
        settingsData.llm?.polishEnabled ?? null,
        toNullableString(settingsData.llm?.polishLlmProvider),
        toNullableString(settingsData.llm?.polishLlmModel),
        settingsData.llm?.polishLlmTemperature ?? null,
      ],
    )

    const llmSettings = res.rows[0]
    return {
      id: llmSettings.id,
      user_id: llmSettings.user_id,
      llm: {
        asr_model: llmSettings.asr_model,
        asr_provider: llmSettings.asr_provider,
        asr_prompt: llmSettings.asr_prompt,
        llm_provider: llmSettings.llm_provider,
        llm_model: llmSettings.llm_model,
        llm_temperature: llmSettings.llm_temperature,
        llm_base_url: llmSettings.llm_base_url,
        transcription_prompt: llmSettings.transcription_prompt,
        editing_prompt: llmSettings.editing_prompt,
        no_speech_threshold: llmSettings.no_speech_threshold,
        low_quality_threshold: llmSettings.low_quality_threshold,
        polish_enabled: llmSettings.polish_enabled,
        polish_llm_provider: llmSettings.polish_llm_provider,
        polish_llm_model: llmSettings.polish_llm_model,
        polish_llm_temperature: llmSettings.polish_llm_temperature,
      },
      created_at: llmSettings.created_at,
      updated_at: llmSettings.updated_at,
    }
  }

  static async hardDeleteByUserId(userId: string): Promise<number> {
    const res = await pool.query(
      'DELETE FROM llm_settings WHERE user_id = $1',
      [userId],
    )
    return res.rowCount ?? 0
  }
}
