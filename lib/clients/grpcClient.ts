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
  GetInteractionRequestSchema,
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
  PlaygroundRunRequestSchema,
  PlaygroundRunResponse,
  PlaygroundPolishRequestSchema,
  PlaygroundPolishResponse,
} from '@/app/generated/ito_pb'
import { createClient } from '@connectrpc/connect'
import {
  createConnectTransport,
  Http2SessionManager,
} from '@connectrpc/connect-node'
import { BrowserWindow } from 'electron'
import { create } from '@bufbuild/protobuf'
import { Note, Interaction, DictionaryItem } from '../main/sqlite/models'
import { AdvancedSettings } from '../main/store'

class GrpcClient {
  private client: ReturnType<typeof createClient<typeof ItoService>>
  private timingClient: ReturnType<typeof createClient<typeof TimingService>>
  private mainWindow: BrowserWindow | null = null
  private sessionManager: Http2SessionManager

  constructor() {
    const baseUrl = import.meta.env.VITE_GRPC_BASE_URL

    // Create HTTP/2 session manager with keepalive configuration
    // This prevents "Too many invalid HTTP/2 frames" errors during long-running streams
    this.sessionManager = new Http2SessionManager(baseUrl, {
      pingIntervalMs: 10_000, // Send PING every 10 seconds to keep connection alive
      pingIdleConnection: true, // Keep pinging even without active streams
      pingTimeoutMs: 5_000, // 5 second timeout for PING response
      idleConnectionTimeoutMs: 60_000, // Close idle connections after 1 minute (prevents stale reuse)
    })

    const transport = createConnectTransport({
      baseUrl,
      httpVersion: '2',
      sessionManager: this.sessionManager,
    })

    console.log('[gRPC Client] Creating client with base URL:', baseUrl)
    console.log(
      '[gRPC Client] HTTP/2 keepalive enabled: pingInterval=10s, pingTimeout=5s, idleTimeout=60s',
    )

    this.client = createClient(ItoService, transport)
    this.timingClient = createClient(TimingService, transport)
  }

  // Log current HTTP/2 session state for diagnostics
  logSessionState(context?: string) {
    const state = this.sessionManager.state()
    const error = this.sessionManager.error()
    const prefix = context ? `[gRPC HTTP/2] ${context}:` : '[gRPC HTTP/2]'
    console.log(prefix, 'Session state:', state, error ? `Error: ${error}` : '')
  }

  // Public method to abort HTTP/2 session from external callers (e.g., uncaught exception handler)
  abortSession() {
    console.log(
      '[gRPC Client] External abort requested, resetting HTTP/2 session',
    )
    this.sessionManager.abort()
  }

  // Check if an error is an HTTP/2 connection error that requires session reset
  private isHttp2Error(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase()
      return (
        message.includes('http/2') ||
        message.includes('http2') ||
        message.includes('invalid frames') ||
        message.includes('goaway') ||
        message.includes('rst_stream') ||
        message.includes('session')
      )
    }
    return false
  }

  // Verify connection is healthy before starting a stream
  // This prevents using stale connections that the server has closed
  private async ensureHealthyConnection(): Promise<void> {
    const currentState = this.sessionManager.state()
    console.log(
      '[gRPC Client] Pre-stream connection check, current state:',
      currentState,
    )

    // For streaming operations, don't trust idle connections - they may be stale
    // The server may have closed the connection without our knowledge (GOAWAY, timeout, etc.)
    // Force a fresh connection to ensure reliability for long-running streams
    if (currentState === 'error' || currentState === 'idle') {
      console.log(
        `[gRPC Client] Session in ${currentState} state, forcing fresh connection for stream`,
      )
      this.sessionManager.abort()
    }

    // Establish a fresh connection
    try {
      const connectResult = await this.sessionManager.connect()
      console.log(
        '[gRPC Client] Fresh connection established, state:',
        connectResult,
      )

      if (connectResult === 'error') {
        console.log('[gRPC Client] Connection failed, retrying...')
        this.sessionManager.abort()
        const retryResult = await this.sessionManager.connect()
        console.log('[gRPC Client] Retry result:', retryResult)
        if (retryResult === 'error') {
          throw new Error('Failed to establish gRPC connection after retry')
        }
      }
    } catch (err) {
      console.log('[gRPC Client] Connection establishment failed:', err)
      throw err
    }
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

  private async withRetry<T>(
    operation: () => Promise<T>,
    options?: { retryOnHttp2Error?: boolean },
  ): Promise<T> {
    // Self-hosted mode: no token refresh needed, just execute the operation
    // But we need to handle HTTP/2 connection errors to prevent cascading failures
    const { retryOnHttp2Error = true } = options ?? {}

    try {
      return await operation()
    } catch (error) {
      // If we get an HTTP/2 error, abort the session to force a fresh connection
      if (this.isHttp2Error(error)) {
        console.log('[gRPC Client] HTTP/2 error detected, resetting connection')
        this.sessionManager.abort()

        // Retry once with fresh connection (for unary calls only)
        // This prevents pop-ups for transient connection issues
        if (retryOnHttp2Error) {
          console.log('[gRPC Client] Retrying with fresh connection...')
          return await operation()
        }
      }
      throw error
    }
  }

  async transcribeStream(
    stream: AsyncIterable<TranscribeStreamRequest>,
    signal?: AbortSignal,
    onPhaseUpdate?: (phase: TranscribePhase) => void,
  ): Promise<TranscribeStreamResponse> {
    // Disable retry for streaming - the input stream can only be consumed once
    return this.withRetry(
      async () => {
        // Pre-stream connection verification to detect stale connections
        await this.ensureHealthyConnection()

        this.logSessionState('Starting transcribe stream')

        const responseStream = this.client.transcribeStream(stream, {
          headers: this.getHeaders(),
          signal,
        })

        let finalResponse: TranscribeStreamResponse | null = null
        try {
          for await (const response of responseStream) {
            if (onPhaseUpdate) {
              onPhaseUpdate(response.phase)
            }
            if (response.phase === TranscribePhase.PHASE_COMPLETE) {
              finalResponse = response
            }
          }
        } catch (error) {
          this.logSessionState('Stream error occurred')
          // If we get an HTTP/2 error, abort the session to force a fresh connection next time
          if (this.isHttp2Error(error)) {
            console.log(
              '[gRPC Client] HTTP/2 error detected, aborting session to force reconnection',
            )
            this.sessionManager.abort()
          }
          throw error
        }

        this.logSessionState('Stream completed')

        if (!finalResponse) {
          throw new Error(
            'No final response received from transcription stream',
          )
        }
        return finalResponse
      },
      { retryOnHttp2Error: false },
    )
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

  async getInteraction(interactionId: string): Promise<InteractionPb> {
    return this.withRetry(async () => {
      const request = create(GetInteractionRequestSchema, {
        id: interactionId,
      })
      return await this.client.getInteraction(request, {
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

  async playgroundRun(params: {
    audioData: Uint8Array
    sampleRate: number
    customVocabulary: string[]
    asrProvider: string
    asrModel: string
    polishLlmProvider: string
    polishLlmModel: string
    polishLlmTemperature: number
    skipPolish?: boolean
  }): Promise<PlaygroundRunResponse> {
    return this.withRetry(async () => {
      const request = create(PlaygroundRunRequestSchema, {
        audioData: params.audioData,
        sampleRate: params.sampleRate,
        customVocabulary: params.customVocabulary,
        asrProvider: params.asrProvider,
        asrModel: params.asrModel,
        polishLlmProvider: params.polishLlmProvider,
        polishLlmModel: params.polishLlmModel,
        polishLlmTemperature: params.polishLlmTemperature,
        skipPolish: params.skipPolish ?? false,
      })
      return await this.client.playgroundRun(request, {
        headers: this.getHeaders(),
      })
    })
  }

  async playgroundPolish(params: {
    transcript: string
    transcriptionPrompt: string
    polishLlmProvider: string
    polishLlmModel: string
    polishLlmTemperature: number
  }): Promise<PlaygroundPolishResponse> {
    return this.withRetry(async () => {
      const request = create(PlaygroundPolishRequestSchema, {
        transcript: params.transcript,
        transcriptionPrompt: params.transcriptionPrompt,
        polishLlmProvider: params.polishLlmProvider,
        polishLlmModel: params.polishLlmModel,
        polishLlmTemperature: params.polishLlmTemperature,
      })
      return await this.client.playgroundPolish(request, {
        headers: this.getHeaders(),
      })
    })
  }
}

export const grpcClient = new GrpcClient()
