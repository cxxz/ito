import type { ConnectRouter } from '@connectrpc/connect'
import {
  ItoService as ItoServiceDesc,
  Note,
  NoteSchema,
  Interaction,
  InteractionSchema,
  DictionaryItem,
  DictionaryItemSchema,
  AdvancedSettings,
  AdvancedSettingsSchema,
  LlmSettingsSchema,
  TranscribeStreamRequest,
} from '../../generated/ito_pb.js'
import { create } from '@bufbuild/protobuf'
import type { HandlerContext } from '@connectrpc/connect'
import { createInteractionWithAudio } from './interactionHelpers.js'
import {
  DictionaryRepository,
  InteractionsRepository,
  NotesRepository,
  AdvancedSettingsRepository,
} from '../../db/repo.js'
import {
  Note as DbNote,
  Interaction as DbInteraction,
  DictionaryItem as DbDictionaryItem,
  AdvancedSettings as DbAdvancedSettings,
} from '../../db/models.js'
import { ConnectError, Code } from '@connectrpc/connect'
import { kUser } from '../../auth/userContext.js'
import { transcribeStreamV2Handler } from './transcribeStreamV2Handler.js'
import {
  getDefaultAdvancedSettingsStruct,
  getProviderDefaultLlmModels,
} from './constants.js'
import { DEFAULT_ADVANCED_SETTINGS } from '../../constants/generated-defaults.js'

function dbToNotePb(dbNote: DbNote): Note {
  return create(NoteSchema, {
    id: dbNote.id,
    userId: dbNote.user_id,
    interactionId: dbNote.interaction_id ?? '',
    content: dbNote.content,
    createdAt: dbNote.created_at.toISOString(),
    updatedAt: dbNote.updated_at.toISOString(),
    deletedAt: dbNote.deleted_at?.toISOString() ?? '',
  })
}

function dbToInteractionPb(dbInteraction: DbInteraction): Interaction {
  return create(InteractionSchema, {
    id: dbInteraction.id,
    userId: dbInteraction.user_id ?? '',
    title: dbInteraction.title ?? '',
    asrOutput: dbInteraction.asr_output
      ? JSON.stringify(dbInteraction.asr_output)
      : '',
    llmOutput: dbInteraction.llm_output
      ? JSON.stringify(dbInteraction.llm_output)
      : '',
    durationMs: dbInteraction.duration_ms ?? 0,
    createdAt: dbInteraction.created_at.toISOString(),
    updatedAt: dbInteraction.updated_at.toISOString(),
    deletedAt: dbInteraction.deleted_at?.toISOString() ?? '',
  })
}

function dbToDictionaryItemPb(
  dbDictionaryItem: DbDictionaryItem,
): DictionaryItem {
  return create(DictionaryItemSchema, {
    id: dbDictionaryItem.id,
    userId: dbDictionaryItem.user_id,
    word: dbDictionaryItem.word,
    pronunciation: dbDictionaryItem.pronunciation ?? '',
    createdAt: dbDictionaryItem.created_at.toISOString(),
    updatedAt: dbDictionaryItem.updated_at.toISOString(),
    deletedAt: dbDictionaryItem.deleted_at?.toISOString() ?? '',
  })
}

function dbToAdvancedSettingsPb(
  dbAdvancedSettings: DbAdvancedSettings,
): AdvancedSettings {
  const toOptionalString = (
    value: string | null | undefined,
  ): string | undefined => {
    if (value === null || value === undefined) return undefined
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  const resolvedDefaults = getDefaultAdvancedSettingsStruct()
  const dbAsrProvider = toOptionalString(dbAdvancedSettings.llm.asr_provider)
  let asrModel = toOptionalString(dbAdvancedSettings.llm.asr_model)

  // Backwards-compat: if we have a legacy default ASR model stored (from before
  // "NULL means use defaults"), treat it as unset so provider-specific defaults
  // (e.g. aliyun -> qwen3-asr-flash) can take effect.
  if (asrModel === DEFAULT_ADVANCED_SETTINGS.asrModel) {
    const currentProvider = resolvedDefaults.asrProvider
    const legacyDefaultProvider = DEFAULT_ADVANCED_SETTINGS.asrProvider
    if (!dbAsrProvider || currentProvider !== legacyDefaultProvider) {
      asrModel = undefined
    }
  }

  return create(AdvancedSettingsSchema, {
    id: dbAdvancedSettings.id,
    userId: dbAdvancedSettings.user_id,
    createdAt: dbAdvancedSettings.created_at.toISOString(),
    updatedAt: dbAdvancedSettings.updated_at.toISOString(),
    llm: create(LlmSettingsSchema, {
      // Convert null to undefined so protobuf omits unset optional fields
      asrModel,
      asrPrompt: toOptionalString(dbAdvancedSettings.llm.asr_prompt),
      // ASR provider is controlled by server environment, not user settings.
      asrProvider: undefined,
      llmProvider: toOptionalString(dbAdvancedSettings.llm.llm_provider),
      llmTemperature: dbAdvancedSettings.llm.llm_temperature ?? undefined,
      llmModel: toOptionalString(dbAdvancedSettings.llm.llm_model),
      llmBaseUrl: toOptionalString(dbAdvancedSettings.llm.llm_base_url),
      transcriptionPrompt:
        toOptionalString(dbAdvancedSettings.llm.transcription_prompt),
      editingPrompt: toOptionalString(dbAdvancedSettings.llm.editing_prompt),
      noSpeechThreshold:
        dbAdvancedSettings.llm.no_speech_threshold ?? undefined,
      lowQualityThreshold:
        dbAdvancedSettings.llm.low_quality_threshold ?? undefined,
      polishEnabled: dbAdvancedSettings.llm.polish_enabled ?? undefined,
      polishLlmProvider: toOptionalString(
        dbAdvancedSettings.llm.polish_llm_provider,
      ),
      polishLlmModel: toOptionalString(dbAdvancedSettings.llm.polish_llm_model),
      polishLlmTemperature:
        dbAdvancedSettings.llm.polish_llm_temperature ?? undefined,
    }),
    default: resolvedDefaults,
    llmProviderDefaultModels: getProviderDefaultLlmModels(),
  })
}

// Export the service implementation as a function that takes a ConnectRouter
export default (router: ConnectRouter) => {
  router.service(ItoServiceDesc, {
    async *transcribeStreamV2(
      requests: AsyncIterable<TranscribeStreamRequest>,
      context: HandlerContext,
    ) {
      yield* transcribeStreamV2Handler.process(requests, context)
    },
    async createNote(request, context: HandlerContext) {
      const user = context.values.get(kUser)
      const userId = user?.sub
      if (!userId) {
        throw new ConnectError('User not authenticated', Code.Unauthenticated)
      }
      const noteRequest = { ...request, userId }
      const newNote = await NotesRepository.create(noteRequest)
      return dbToNotePb(newNote)
    },

    async getNote(request) {
      const note = await NotesRepository.findById(request.id)
      if (!note) {
        throw new ConnectError('Note not found', Code.NotFound)
      }
      return dbToNotePb(note)
    },

    async listNotes(request, context: HandlerContext) {
      const user = context.values.get(kUser)
      const userId = user?.sub
      if (!userId) {
        throw new ConnectError('User not authenticated', Code.Unauthenticated)
      }
      const since = request.sinceTimestamp
        ? new Date(request.sinceTimestamp)
        : undefined
      const notes = await NotesRepository.findByUserId(userId, since)
      return { notes: notes.map(dbToNotePb) }
    },

    async updateNote(request) {
      const updatedNote = await NotesRepository.update(request)
      if (!updatedNote) {
        throw new ConnectError('Note not found', Code.NotFound)
      }
      return dbToNotePb(updatedNote)
    },

    async deleteNote(request) {
      await NotesRepository.softDelete(request.id)
      return {}
    },

    async createInteraction(request, context: HandlerContext) {
      const user = context.values.get(kUser)
      const userId = user?.sub
      if (!userId) {
        throw new ConnectError('User not authenticated', Code.Unauthenticated)
      }

      try {
        // Use shared helper to create interaction
        const newInteraction = await createInteractionWithAudio({
          id: request.id,
          userId,
          title: request.title,
          asrOutput: request.asrOutput,
          llmOutput: request.llmOutput,
          durationMs: request.durationMs,
        })

        return dbToInteractionPb(newInteraction)
      } catch (error) {
        console.error('Failed to create interaction:', error)
        throw new ConnectError('Failed to store interaction', Code.Internal)
      }
    },

    async getInteraction(request) {
      const interaction = await InteractionsRepository.findById(request.id)
      if (!interaction) {
        throw new ConnectError('Interaction not found', Code.NotFound)
      }

      return dbToInteractionPb(interaction)
    },

    async listInteractions(request, context: HandlerContext) {
      const user = context.values.get(kUser)
      const userId = user?.sub
      if (!userId) {
        throw new ConnectError('User not authenticated', Code.Unauthenticated)
      }
      const since = request.sinceTimestamp
        ? new Date(request.sinceTimestamp)
        : undefined
      const interactions = await InteractionsRepository.findByUserId(
        userId,
        since,
      )

      return {
        interactions: interactions.map(dbToInteractionPb),
      }
    },

    async updateInteraction(request) {
      const updatedInteraction = await InteractionsRepository.update(request)
      if (!updatedInteraction) {
        throw new ConnectError(
          'Interaction not found or was deleted',
          Code.NotFound,
        )
      }
      return dbToInteractionPb(updatedInteraction)
    },

    async deleteInteraction(request) {
      await InteractionsRepository.softDelete(request.id)
      return {}
    },

    async createDictionaryItem(request, context: HandlerContext) {
      const user = context.values.get(kUser)
      const userId = user?.sub
      if (!userId) {
        throw new ConnectError('User not authenticated', Code.Unauthenticated)
      }
      const dictionaryRequest = { ...request, userId }
      const newItem = await DictionaryRepository.create(dictionaryRequest)
      return dbToDictionaryItemPb(newItem)
    },

    async listDictionaryItems(request, context: HandlerContext) {
      const user = context.values.get(kUser)
      const userId = user?.sub
      if (!userId) {
        throw new ConnectError('User not authenticated', Code.Unauthenticated)
      }
      const since = request.sinceTimestamp
        ? new Date(request.sinceTimestamp)
        : undefined
      const items = await DictionaryRepository.findByUserId(userId, since)
      return { items: items.map(dbToDictionaryItemPb) }
    },

    async updateDictionaryItem(request) {
      const updatedItem = await DictionaryRepository.update(request)
      if (!updatedItem) {
        throw new ConnectError(
          'Dictionary item not found or was deleted',
          Code.NotFound,
        )
      }
      return dbToDictionaryItemPb(updatedItem)
    },

    async deleteDictionaryItem(request) {
      await DictionaryRepository.softDelete(request.id)
      return {}
    },

    async deleteUserData(_request, context: HandlerContext) {
      const user = context.values.get(kUser)
      const userId = user?.sub
      if (!userId) {
        throw new ConnectError('User not authenticated', Code.Unauthenticated)
      }

      console.log(`Deleting all data for authenticated user: ${userId}`)

      await Promise.all([
        NotesRepository.hardDeleteAllUserData(userId),
        InteractionsRepository.hardDeleteAllUserData(userId),
        DictionaryRepository.hardDeleteAllUserData(userId),
        AdvancedSettingsRepository.hardDeleteByUserId(userId),
      ])

      console.log(`Successfully deleted all data for user: ${userId}`)
      return {}
    },

    async getAdvancedSettings(_request, context: HandlerContext) {
      const user = context.values.get(kUser)
      const userId = user?.sub
      if (!userId) {
        throw new ConnectError('User not authenticated', Code.Unauthenticated)
      }

      const settings = await AdvancedSettingsRepository.findByUserId(userId)
      if (!settings) {
        // Return default settings if none exist
        return create(AdvancedSettingsSchema, {
          id: '',
          userId: userId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          llm: create(LlmSettingsSchema, {}),
          default: getDefaultAdvancedSettingsStruct(),
          llmProviderDefaultModels: getProviderDefaultLlmModels(),
        })
      }

      return dbToAdvancedSettingsPb(settings)
    },

    async updateAdvancedSettings(request, context: HandlerContext) {
      const user = context.values.get(kUser)
      const userId = user?.sub
      if (!userId) {
        throw new ConnectError('User not authenticated', Code.Unauthenticated)
      }

      const updatedSettings = await AdvancedSettingsRepository.upsert(
        userId,
        request,
      )
      return dbToAdvancedSettingsPb(updatedSettings)
    },
  })
}
