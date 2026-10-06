import { describe, test, expect, beforeEach, mock } from 'bun:test'

// Mock external dependencies to focus on core grpcClient logic
const mockElectronWindow = {
  webContents: {
    send: mock(),
    isDestroyed: mock(() => false),
  },
  isDestroyed: mock(() => false),
} as any

const mockSetFocusedText = mock()

mock.module('../media/text-writer', () => ({
  setFocusedText: mockSetFocusedText,
}))

const mockStore = { get: mock(), set: mock(), delete: mock() }

mock.module('../main/store', () => ({
  default: mockStore,
  store: mockStore,
}))

mock.module('../main/sqlite/repo', () => ({
  NotesTable: {
    insert: mock(() => Promise.resolve({ id: 'test-id' })),
    findById: mock(() => Promise.resolve(undefined)),
    findAll: mock(() => Promise.resolve([])),
    findByInteractionId: mock(() => Promise.resolve([])),
    updateContent: mock(() => Promise.resolve()),
    softDelete: mock(() => Promise.resolve()),
    deleteAllUserData: mock(() => Promise.resolve()),
    upsert: mock(() => Promise.resolve()),
    findModifiedSince: mock(() => Promise.resolve([])),
  },
  InteractionsTable: {
    insert: mock(() => Promise.resolve({ id: 'test-id' })),
    findById: mock(() => Promise.resolve(undefined)),
    findAll: mock(() => Promise.resolve([])),
    softDelete: mock(() => Promise.resolve()),
    deleteAllUserData: mock(() => Promise.resolve()),
    upsert: mock(() => Promise.resolve()),
    findModifiedSince: mock(() => Promise.resolve([])),
  },
  KeyValueStore: {
    get: mock(() => Promise.resolve(undefined)),
    set: mock(() => Promise.resolve()),
  },
}))

// Mock the entire gRPC stack to avoid network calls
const mockGrpcClientMethods = {
  transcribeStream: mock(() =>
    (async function* () {
      yield { phase: 0, transcript: 'hello' }
    })(),
  ),
  createNote: mock(() => Promise.resolve({ success: true } as any)),
  updateNote: mock(() => Promise.resolve({ success: true } as any)),
  deleteNote: mock(() => Promise.resolve({ success: true } as any)),
  listNotes: mock(() => Promise.resolve({ notes: [] as any })),
  createInteraction: mock(() => Promise.resolve({ success: true } as any)),
  updateInteraction: mock(() => Promise.resolve({ success: true } as any)),
  deleteInteraction: mock(() => Promise.resolve({ success: true } as any)),
  listInteractions: mock(() => Promise.resolve({ interactions: [] as any })),
  createDictionaryItem: mock(() => Promise.resolve({ success: true } as any)),
  updateDictionaryItem: mock(() => Promise.resolve({ success: true } as any)),
  deleteDictionaryItem: mock(() => Promise.resolve({ success: true } as any)),
  listDictionaryItems: mock(() => Promise.resolve({ items: [] as any })),
  deleteUserData: mock(() => Promise.resolve({ success: true } as any)),
  updateAdvancedSettings: mock(() => Promise.resolve({ success: true } as any)),
}

mock.module('@connectrpc/connect', () => ({
  createClient: mock(() => mockGrpcClientMethods),
  ConnectError: class MockConnectError extends Error {
    code: number
    constructor(message: string, code: number) {
      super(message)
      this.code = code
    }
  },
  Code: {
    Unauthenticated: 16,
    InvalidArgument: 3,
    NotFound: 5,
    Internal: 13,
  },
}))

const mockCreateConnectTransport = mock(() => ({}))
const mockAbortSession = mock()
const mockConnectSession = mock(async () => 'idle')
let sessionState = 'idle'

mock.module('@connectrpc/connect-node', () => ({
  createConnectTransport: mockCreateConnectTransport,
  Http2SessionManager: class MockHttp2SessionManager {
    abort = mockAbortSession
    connect = mockConnectSession
    state = () => sessionState
    error = () => null
  },
}))

mock.module('@bufbuild/protobuf', () => ({
  create: mock((_schema: any, data: any) => data),
}))

// Mock protobuf schemas
mock.module('@/app/generated/ito_pb', () => ({
  ItoService: { typeName: 'ItoService' },
  // Mock all the schema objects
  CreateNoteRequestSchema: { typeName: 'CreateNoteRequest' },
  UpdateNoteRequestSchema: { typeName: 'UpdateNoteRequest' },
  DeleteNoteRequestSchema: { typeName: 'DeleteNoteRequest' },
  ListNotesRequestSchema: { typeName: 'ListNotesRequest' },
  CreateInteractionRequestSchema: { typeName: 'CreateInteractionRequest' },
  GetInteractionRequestSchema: { typeName: 'GetInteractionRequest' },
  UpdateInteractionRequestSchema: { typeName: 'UpdateInteractionRequest' },
  DeleteInteractionRequestSchema: { typeName: 'DeleteInteractionRequest' },
  ListInteractionsRequestSchema: { typeName: 'ListInteractionsRequest' },
  CreateDictionaryItemRequestSchema: {
    typeName: 'CreateDictionaryItemRequest',
  },
  UpdateDictionaryItemRequestSchema: {
    typeName: 'UpdateDictionaryItemRequest',
  },
  DeleteDictionaryItemRequestSchema: {
    typeName: 'DeleteDictionaryItemRequest',
  },
  ListDictionaryItemsRequestSchema: { typeName: 'ListDictionaryItemsRequest' },
  DeleteUserDataRequestSchema: { typeName: 'DeleteUserDataRequest' },
  UpdateAdvancedSettingsRequestSchema: {
    typeName: 'UpdateAdvancedSettingsRequest',
  },
  GetAdvancedSettingsRequestSchema: { typeName: 'GetAdvancedSettingsRequest' },
  PlaygroundRunRequestSchema: { typeName: 'PlaygroundRunRequest' },
  PlaygroundRunResponse: { typeName: 'PlaygroundRunResponse' },
  PlaygroundPolishRequestSchema: { typeName: 'PlaygroundPolishRequest' },
  PlaygroundPolishResponse: { typeName: 'PlaygroundPolishResponse' },
  TranscribeStreamRequest: { typeName: 'TranscribeStreamRequest' },
  TranscribeStreamResponse: { typeName: 'TranscribeStreamResponse' },
  TranscribePhase: { PHASE_COMPLETE: 0 },
}))

// Mock console to avoid noise
beforeEach(() => {
  console.log = mock()
  console.error = mock()
  console.info = mock()
})

describe('GrpcClient Business Logic Tests', () => {
  beforeEach(() => {
    // Reset all mocks
    Object.values(mockGrpcClientMethods).forEach(m => m.mockClear())
    mockElectronWindow.webContents.send.mockClear()
    mockElectronWindow.isDestroyed.mockClear()
    mockSetFocusedText.mockClear()
    mockAbortSession.mockClear()
    mockConnectSession.mockClear()
    sessionState = 'idle'

    // Reset default behaviors
    mockElectronWindow.isDestroyed.mockReturnValue(false)
  })

  test('reuses a healthy idle connection and returns the transcript before trailing history work', async () => {
    let closed = false
    mockGrpcClientMethods.transcribeStream.mockImplementationOnce(() =>
      (async function* () {
        try {
          yield { phase: 0, transcript: 'ready' }
          await new Promise(() => {})
        } finally {
          closed = true
        }
      })(),
    )
    const { GrpcClient } = await import('./grpcClient')
    const result = await new GrpcClient().transcribeStream(
      (async function* () {})(),
    )
    expect(result.transcript).toBe('ready')
    expect(closed).toBe(true)
    expect(mockAbortSession).not.toHaveBeenCalled()
    expect(mockConnectSession).toHaveBeenCalledTimes(1)
  })

  test('replaces an errored HTTP/2 connection without replaying the audio stream', async () => {
    sessionState = 'error'
    const { GrpcClient } = await import('./grpcClient')
    await new GrpcClient().transcribeStream((async function* () {})())
    expect(mockAbortSession).toHaveBeenCalledTimes(1)
    expect(mockGrpcClientMethods.transcribeStream).toHaveBeenCalledTimes(1)
  })

  describe('Authentication', () => {
    test('protects active requests while switching server configuration', async () => {
      const { GrpcClient } = await import('./grpcClient')
      const client = new GrpcClient()
      let finishRequest!: (value: any) => void
      mockGrpcClientMethods.listNotes.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finishRequest = resolve
          }),
      )
      const request = client.listNotesSince('2024-01-01T00:00:00Z')
      expect(() => client.pauseRequests()).toThrow(
        'Wait for dictation or processing to finish',
      )
      finishRequest({ notes: [] })
      await request
      client.pauseRequests()
      await expect(
        client.listNotesSince('2024-01-01T00:00:00Z'),
      ).rejects.toThrow('Server settings are being updated')
      client.invalidateConnection()
      client.resumeRequests()
      await expect(
        client.listNotesSince('2024-01-01T00:00:00Z'),
      ).resolves.toEqual([])
    })

    test('can construct a client without environment credentials', async () => {
      const { GrpcClient } = await import('./grpcClient')
      const key = process.env.VITE_ITO_API_KEY
      delete process.env.VITE_ITO_API_KEY
      try {
        const client = new GrpcClient()
        await expect(
          client.listNotesSince('2024-01-01T00:00:00Z'),
        ).rejects.toThrow('Settings → Server')
      } finally {
        process.env.VITE_ITO_API_KEY = key
      }
    })

    test('recreates the transport when the configured URL and key change', async () => {
      const { GrpcClient } = await import('./grpcClient')
      const client = new GrpcClient()
      await client.listNotesSince('2024-01-01T00:00:00Z')
      const previousUrl = process.env.VITE_ITO_API_BASE_URL
      const previousKey = process.env.VITE_ITO_API_KEY
      process.env.VITE_ITO_API_BASE_URL = 'https://new.ito.test'
      process.env.VITE_ITO_API_KEY = 'new-key'
      try {
        await client.listNotesSince('2024-01-01T00:00:00Z')
        expect(mockCreateConnectTransport).toHaveBeenLastCalledWith(
          expect.objectContaining({ baseUrl: 'https://new.ito.test' }),
        )
        const [, options] = (
          mockGrpcClientMethods.listNotes as any
        ).mock.calls.at(-1)
        expect(options.headers.get('x-ito-api-key')).toBe('new-key')
        expect(mockAbortSession).toHaveBeenCalled()
      } finally {
        process.env.VITE_ITO_API_BASE_URL = previousUrl
        process.env.VITE_ITO_API_KEY = previousKey
      }
    })

    test('should handle operations with no auth token gracefully', async () => {
      const { grpcClient } = await import('./grpcClient')

      const testNote = {
        id: 'note-123',
        content: 'Test note',
        interaction_id: null,
        user_id: 'test-user',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
        deleted_at: null,
      }

      // Should proceed with operation (empty headers but no crash)
      const result = await grpcClient.createNote(testNote)
      expect(result).toBeDefined()

      const [, options] = (mockGrpcClientMethods.createNote as any).mock
        .calls[0]
      expect(options.headers.get('x-ito-api-key')).toBe('test-api-key')
      expect(mockCreateConnectTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'https://ito.test',
          httpVersion: '2',
        }),
      )
    })
  })

  describe('Advanced Settings Business Logic', () => {
    test('should send llm provider/base URL to server', async () => {
      const { grpcClient } = await import('./grpcClient')

      const settings = {
        llm: {
          asrModel: null,
          asrProvider: null,
          asrPrompt: null,
          llmProvider: 'openai',
          llmModel: null,
          llmTemperature: null,
          llmBaseUrl: 'https://api.openai.com/v1',
          transcriptionPrompt: null,
          editingPrompt: null,
          noSpeechThreshold: null,
        },
        grammarServiceEnabled: false,
        macosAccessibilityContextEnabled: false,
      }

      await grpcClient.updateAdvancedSettings(settings as any)

      expect(
        mockGrpcClientMethods.updateAdvancedSettings,
      ).toHaveBeenCalledTimes(1)

      const [request] = (mockGrpcClientMethods.updateAdvancedSettings as any)
        .mock.calls[0]
      expect(request.llm.llmProvider).toBe('openai')
      expect(request.llm.llmBaseUrl).toBe('https://api.openai.com/v1')
    })
  })

  describe('Interaction deletion', () => {
    test('should mark retention deletes as permanent', async () => {
      const { grpcClient } = await import('./grpcClient')

      await grpcClient.deleteInteraction('interaction-123', {
        permanent: true,
      })

      expect(mockGrpcClientMethods.deleteInteraction).toHaveBeenCalledTimes(1)

      const [request, options] = (
        mockGrpcClientMethods.deleteInteraction as any
      ).mock.calls[0]
      expect(request.id).toBe('interaction-123')
      expect(options.headers.get('x-ito-permanent-delete')).toBe('true')
    })
  })
})
