import {
  ItoService,
  TimingService,
  Note as NotePb,
  Interaction as InteractionPb,
  DictionaryItem as DictionaryItemPb,
  AdvancedSettings as AdvancedSettingsPb,
  TimingReport,
  CreateNoteRequestSchema,
  UpdateNoteRequestSchema,
  DeleteNoteRequestSchema,
  ListNotesRequestSchema,
  CreateInteractionRequestSchema,
  UpdateInteractionRequestSchema,
  DeleteInteractionRequestSchema,
  ListInteractionsRequestSchema,
  CreateDictionaryItemRequestSchema,
  DeleteDictionaryItemRequestSchema,
  UpdateDictionaryItemRequestSchema,
  ListDictionaryItemsRequestSchema,
  DeleteUserDataRequestSchema,
  GetAdvancedSettingsRequestSchema,
  UpdateAdvancedSettingsRequestSchema,
  SubmitTimingReportsRequestSchema,
  TranscribeStreamRequest,
  TranscribeStreamResponse,
  TranscribePhase,
} from '@/app/generated/ito_pb'
import { createClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-node'
import { BrowserWindow } from 'electron'
import { create } from '@bufbuild/protobuf'
import { Note, Interaction, DictionaryItem } from '../main/sqlite/models'
import { AdvancedSettings } from '../main/store'

class GrpcClient {
  private client: ReturnType<typeof createClient<typeof ItoService>>
  private timingClient: ReturnType<typeof createClient<typeof TimingService>>
  private mainWindow: BrowserWindow | null = null

  constructor() {
    const transport = createConnectTransport({
      baseUrl: import.meta.env.VITE_GRPC_BASE_URL,
      // Use HTTP/2 for bidirectional streaming support (required for TranscribeStream phase updates)
      httpVersion: '2',
    })
    console.log(
      'Creating gRPC client with base URL:',
      import.meta.env.VITE_GRPC_BASE_URL,
    )
    this.client = createClient(ItoService, transport)
    this.timingClient = createClient(TimingService, transport)
  }

  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window
  }

  // Helper method to safely send messages to the main window
  private safeSendToMainWindow(channel: string, ...args: any[]) {
    if (
      this.mainWindow &&
      !this.mainWindow.isDestroyed() &&
      !this.mainWindow.webContents.isDestroyed()
    ) {
      try {
        this.mainWindow.webContents.send(channel, ...args)
      } catch (error) {
        console.warn(
          `Failed to send message to main window on channel ${channel}:`,
          error,
        )
        // Clear the reference to the destroyed window
        this.mainWindow = null
      }
    }
  }

  private getHeaders() {
    // Self-hosted mode: no authentication required
    return new Headers()
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    // Self-hosted mode: no token refresh needed, just execute the operation
    return await operation()
  }

  async transcribeStream(
    stream: AsyncIterable<TranscribeStreamRequest>,
    signal?: AbortSignal,
    onPhaseUpdate?: (phase: TranscribePhase) => void,
  ): Promise<TranscribeStreamResponse> {
    return this.withRetry(async () => {
      const responseStream = this.client.transcribeStream(stream, {
        headers: this.getHeaders(),
        signal,
      })

      let finalResponse: TranscribeStreamResponse | null = null
      for await (const response of responseStream) {
        if (onPhaseUpdate) {
          onPhaseUpdate(response.phase)
        }
        if (response.phase === TranscribePhase.PHASE_COMPLETE) {
          finalResponse = response
        }
      }

      if (!finalResponse) {
        throw new Error('No final response received from transcription stream')
      }
      return finalResponse
    })
  }

  // =================================================================
  // Notes, Interactions, Dictionary (Unary Calls)
  // =================================================================

  async createNote(note: Note) {
    return this.withRetry(async () => {
      const request = create(CreateNoteRequestSchema, {
        id: note.id,
        interactionId: note.interaction_id ?? '',
        content: note.content,
      })
      return await this.client.createNote(request, {
        headers: this.getHeaders(),
      })
    })
  }

  async updateNote(note: Note) {
    return this.withRetry(async () => {
      const request = create(UpdateNoteRequestSchema, {
        id: note.id,
        content: note.content,
      })
      return await this.client.updateNote(request, {
        headers: this.getHeaders(),
      })
    })
  }

  async deleteNote(note: Note) {
    return this.withRetry(async () => {
      const request = create(DeleteNoteRequestSchema, {
        id: note.id,
      })
      return await this.client.deleteNote(request, {
        headers: this.getHeaders(),
      })
    })
  }

  async listNotesSince(since?: string): Promise<NotePb[]> {
    return this.withRetry(async () => {
      const request = create(ListNotesRequestSchema, {
        sinceTimestamp: since ?? '',
      })
      const response = await this.client.listNotes(request, {
        headers: this.getHeaders(),
      })
      return response.notes
    })
  }

  async createInteraction(interaction: Interaction) {
    return this.withRetry(async () => {
      // Convert Buffer to Uint8Array for protobuf
      let uint8AudioData: Uint8Array
      if (interaction.raw_audio) {
        uint8AudioData = new Uint8Array(interaction.raw_audio)
      } else {
        uint8AudioData = new Uint8Array()
      }

      const request = create(CreateInteractionRequestSchema, {
        id: interaction.id,
        title: interaction.title ?? '',
        asrOutput: JSON.stringify(interaction.asr_output),
        llmOutput: JSON.stringify(interaction.llm_output),
        rawAudio: uint8AudioData,
        durationMs: interaction.duration_ms ?? 0,
      })

      console.log(
        '[gRPC Client] Sending request with audio size:',
        request.rawAudio.length,
        'duration:',
        request.durationMs,
        'ms',
      )

      return await this.client.createInteraction(request, {
        headers: this.getHeaders(),
      })
    })
  }

  async updateInteraction(interaction: Interaction) {
    return this.withRetry(async () => {
      const request = create(UpdateInteractionRequestSchema, {
        id: interaction.id,
        title: interaction.title ?? '',
      })
      return await this.client.updateInteraction(request, {
        headers: this.getHeaders(),
      })
    })
  }

  async deleteInteraction(interactionId: string) {
    return this.withRetry(async () => {
      const request = create(DeleteInteractionRequestSchema, {
        id: interactionId,
      })
      return await this.client.deleteInteraction(request, {
        headers: this.getHeaders(),
      })
    })
  }

  async listInteractionsSince(since?: string): Promise<InteractionPb[]> {
    return this.withRetry(async () => {
      const request = create(ListInteractionsRequestSchema, {
        sinceTimestamp: since ?? '',
      })
      const response = await this.client.listInteractions(request, {
        headers: this.getHeaders(),
      })
      return response.interactions
    })
  }

  async createDictionaryItem(item: DictionaryItem) {
    return this.withRetry(async () => {
      const request = create(CreateDictionaryItemRequestSchema, {
        id: item.id,
        word: item.word,
        pronunciation: item.pronunciation ?? '',
      })
      return await this.client.createDictionaryItem(request, {
        headers: this.getHeaders(),
      })
    })
  }

  async updateDictionaryItem(item: DictionaryItem) {
    return this.withRetry(async () => {
      const request = create(UpdateDictionaryItemRequestSchema, {
        id: item.id,
        word: item.word,
        pronunciation: item.pronunciation ?? '',
      })
      return await this.client.updateDictionaryItem(request, {
        headers: this.getHeaders(),
      })
    })
  }

  async deleteDictionaryItem(item: DictionaryItem) {
    return this.withRetry(async () => {
      const request = create(DeleteDictionaryItemRequestSchema, {
        id: item.id,
      })
      return await this.client.deleteDictionaryItem(request, {
        headers: this.getHeaders(),
      })
    })
  }

  async listDictionaryItemsSince(since?: string): Promise<DictionaryItemPb[]> {
    return this.withRetry(async () => {
      const request = create(ListDictionaryItemsRequestSchema, {
        sinceTimestamp: since ?? '',
      })
      const response = await this.client.listDictionaryItems(request, {
        headers: this.getHeaders(),
      })
      return response.items
    })
  }

  async deleteUserData() {
    return this.withRetry(async () => {
      const request = create(DeleteUserDataRequestSchema, {})
      return await this.client.deleteUserData(request, {
        headers: this.getHeaders(),
      })
    })
  }

  async getAdvancedSettings(): Promise<AdvancedSettingsPb | null> {
    return this.withRetry(async () => {
      const request = create(GetAdvancedSettingsRequestSchema, {})
      return await this.client.getAdvancedSettings(request, {
        headers: this.getHeaders(),
      })
    })
  }

  async updateAdvancedSettings(
    settings: AdvancedSettings,
  ): Promise<AdvancedSettingsPb | null> {
    console.log('Updating advanced settings:', settings.llm)

    return this.withRetry(async () => {
      const request = create(UpdateAdvancedSettingsRequestSchema, {
        llm: {
          asrModel: settings.llm.asrModel ?? undefined,
          asrProvider: settings.llm.asrProvider ?? undefined,
          asrPrompt: settings.llm.asrPrompt ?? undefined,
          llmProvider: settings.llm.llmProvider ?? undefined,
          llmModel: settings.llm.llmModel ?? undefined,
          llmBaseUrl: settings.llm.llmBaseUrl ?? undefined,
          transcriptionPrompt: settings.llm.transcriptionPrompt ?? undefined,
          editingPrompt: settings.llm.editingPrompt ?? undefined,
          llmTemperature: settings.llm.llmTemperature ?? undefined,
          noSpeechThreshold: settings.llm.noSpeechThreshold ?? undefined,
          polishEnabled: settings.llm.polishEnabled ?? undefined,
          polishLlmProvider: settings.llm.polishLlmProvider ?? undefined,
          polishLlmModel: settings.llm.polishLlmModel ?? undefined,
          polishLlmTemperature: settings.llm.polishLlmTemperature ?? undefined,
        },
      })
      return await this.client.updateAdvancedSettings(request, {
        headers: this.getHeaders(),
      })
    })
  }

  async submitTimingReports(reports: TimingReport[]) {
    return this.withRetry(async () => {
      const request = create(SubmitTimingReportsRequestSchema, {
        reports,
      })
      return await this.timingClient.submitTimingReports(request, {
        headers: this.getHeaders(),
      })
    })
  }
}

export const grpcClient = new GrpcClient()
