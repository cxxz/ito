import { describe, test, expect, beforeEach, mock } from 'bun:test'

const mockGrpcClient = {
  deleteInteraction: mock(() => Promise.resolve()),
}

mock.module('../clients/grpcClient', () => ({
  grpcClient: mockGrpcClient,
}))

const mockMainStore = {
  get: mock(),
}
const mockGetCurrentUserId = mock(() => 'test-user-123')

mock.module('./store', () => ({
  default: mockMainStore,
  getCurrentUserId: mockGetCurrentUserId,
}))

const mockInteractionsTable = {
  findExpiredIds: mock(() => Promise.resolve([] as string[])),
  hardDeleteByIds: mock(() => Promise.resolve()),
}
const mockKeyValueStore = {
  get: mock(() => Promise.resolve(undefined as string | undefined)),
  set: mock(() => Promise.resolve()),
  delete: mock(() => Promise.resolve()),
}

mock.module('./sqlite/repo', () => ({
  InteractionsTable: mockInteractionsTable,
  KeyValueStore: mockKeyValueStore,
}))

import {
  calculateHistoryRetentionCutoffIso,
  historyRetentionService,
} from './historyRetention'
import { STORE_KEYS } from '../constants/store-keys'

describe('HistoryRetentionService', () => {
  beforeEach(() => {
    mockGrpcClient.deleteInteraction.mockClear()
    mockMainStore.get.mockClear()
    mockGetCurrentUserId.mockClear()
    mockInteractionsTable.findExpiredIds.mockClear()
    mockInteractionsTable.hardDeleteByIds.mockClear()
    mockKeyValueStore.get.mockClear()
    mockKeyValueStore.set.mockClear()
    mockKeyValueStore.delete.mockClear()

    mockGetCurrentUserId.mockReturnValue('test-user-123')
    mockGrpcClient.deleteInteraction.mockResolvedValue(undefined)
    mockKeyValueStore.get.mockResolvedValue(undefined)
    mockMainStore.get.mockImplementation((key: string) => {
      if (key === STORE_KEYS.SETTINGS) {
        return { historyRetentionDays: 7 }
      }
      return undefined
    })
    mockInteractionsTable.findExpiredIds.mockResolvedValue([])
  })

  test('should calculate the cutoff from retention days', () => {
    const now = new Date('2024-01-15T00:00:00.000Z')

    expect(calculateHistoryRetentionCutoffIso(7, now)).toBe(
      '2024-01-08T00:00:00.000Z',
    )
  })

  test('should permanently delete expired interactions locally and remotely', async () => {
    mockInteractionsTable.findExpiredIds.mockResolvedValue(['old-1', 'old-2'])

    const prunedCount = await historyRetentionService.pruneExpiredHistory(
      new Date('2024-01-15T00:00:00.000Z'),
    )

    expect(prunedCount).toBe(2)
    expect(mockInteractionsTable.findExpiredIds).toHaveBeenCalledWith(
      '2024-01-08T00:00:00.000Z',
      'test-user-123',
    )
    expect(mockGrpcClient.deleteInteraction).toHaveBeenCalledWith('old-1', {
      permanent: true,
    })
    expect(mockGrpcClient.deleteInteraction).toHaveBeenCalledWith('old-2', {
      permanent: true,
    })
    expect(mockInteractionsTable.hardDeleteByIds).toHaveBeenCalledWith([
      'old-1',
      'old-2',
    ])
    expect(mockKeyValueStore.delete).toHaveBeenCalledWith(
      'historyRetention:pendingRemoteDeleteIds',
    )
  })

  test('should keep failed remote deletes pending after local pruning', async () => {
    mockInteractionsTable.findExpiredIds.mockResolvedValue(['old-1'])
    mockGrpcClient.deleteInteraction.mockRejectedValue(new Error('offline'))

    const prunedCount = await historyRetentionService.pruneExpiredHistory(
      new Date('2024-01-15T00:00:00.000Z'),
    )

    expect(prunedCount).toBe(1)
    expect(mockInteractionsTable.hardDeleteByIds).toHaveBeenCalledWith([
      'old-1',
    ])
    expect(mockKeyValueStore.set).toHaveBeenCalledWith(
      'historyRetention:pendingRemoteDeleteIds',
      JSON.stringify(['old-1']),
    )
  })
})
