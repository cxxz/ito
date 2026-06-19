import { grpcClient } from '../clients/grpcClient'
import {
  DEFAULT_HISTORY_RETENTION_DAYS,
  HISTORY_RETENTION_CHECK_INTERVAL_MS,
  normalizeHistoryRetentionDays,
} from '../constants/history-retention'
import { STORE_KEYS } from '../constants/store-keys'
import { IPC_EVENTS } from '../types/ipc'
import { broadcastToAllWindows } from '../window/broadcast'
import mainStore, { getCurrentUserId } from './store'
import { InteractionsTable, KeyValueStore } from './sqlite/repo'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const PENDING_REMOTE_DELETE_IDS_KEY = 'historyRetention:pendingRemoteDeleteIds'
// Cap concurrent remote permanent-delete calls so a large first-run backlog
// doesn't open hundreds of simultaneous gRPC requests on one HTTP/2 session.
const REMOTE_DELETE_BATCH_SIZE = 20

export const calculateHistoryRetentionCutoffIso = (
  retentionDays: number,
  now = new Date(),
): string => {
  const normalizedDays = normalizeHistoryRetentionDays(retentionDays)
  return new Date(now.getTime() - normalizedDays * MS_PER_DAY).toISOString()
}

export class HistoryRetentionService {
  private isPruning = false
  private retentionInterval: ReturnType<typeof setInterval> | null = null

  start() {
    this.stop()
    void this.pruneExpiredHistory()
    this.retentionInterval = setInterval(
      () => void this.pruneExpiredHistory(),
      HISTORY_RETENTION_CHECK_INTERVAL_MS,
    )
  }

  stop() {
    if (this.retentionInterval) {
      clearInterval(this.retentionInterval)
      this.retentionInterval = null
    }
    this.isPruning = false
  }

  async pruneExpiredHistory(now = new Date()): Promise<number> {
    if (this.isPruning) {
      return 0
    }

    this.isPruning = true
    try {
      const userId = getCurrentUserId()
      // Without a user we can't safely scope the query (local rows are always
      // stored with a user_id), so skip rather than run a NULL-user query that
      // silently matches nothing.
      if (!userId) {
        return 0
      }

      const settings = mainStore.get(STORE_KEYS.SETTINGS) as
        | { historyRetentionDays?: number }
        | undefined
      const cutoffIso = calculateHistoryRetentionCutoffIso(
        settings?.historyRetentionDays ?? DEFAULT_HISTORY_RETENTION_DAYS,
        now,
      )
      const [expiredIds, pendingRemoteDeleteIds] = await Promise.all([
        InteractionsTable.findExpiredIds(cutoffIso, userId),
        this.getPendingRemoteDeleteIds(),
      ])

      if (expiredIds.length === 0 && pendingRemoteDeleteIds.length === 0) {
        return 0
      }

      const remoteDeleteIds = Array.from(
        new Set([...pendingRemoteDeleteIds, ...expiredIds]),
      )
      const failedRemoteDeleteIds =
        await this.deleteRemoteInteractions(remoteDeleteIds)
      await this.setPendingRemoteDeleteIds(failedRemoteDeleteIds)

      if (expiredIds.length > 0) {
        await InteractionsTable.hardDeleteByIds(expiredIds)
        this.notifyHistoryPruned(expiredIds.length)
      }
      return expiredIds.length
    } catch (error) {
      console.warn('[HistoryRetention] Failed to prune expired history:', error)
      return 0
    } finally {
      this.isPruning = false
    }
  }

  private async deleteRemoteInteractions(
    interactionIds: string[],
  ): Promise<string[]> {
    const failedIds: string[] = []

    for (let i = 0; i < interactionIds.length; i += REMOTE_DELETE_BATCH_SIZE) {
      const batch = interactionIds.slice(i, i + REMOTE_DELETE_BATCH_SIZE)
      const results = await Promise.allSettled(
        batch.map(id => grpcClient.deleteInteraction(id, { permanent: true })),
      )

      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          failedIds.push(batch[index])
          console.warn(
            `[HistoryRetention] Failed to permanently delete remote interaction ${batch[index]}:`,
            result.reason,
          )
        }
      })
    }

    return failedIds
  }

  private async getPendingRemoteDeleteIds(): Promise<string[]> {
    try {
      const rawValue = await KeyValueStore.get(PENDING_REMOTE_DELETE_IDS_KEY)
      if (!rawValue) {
        return []
      }
      const parsedValue = JSON.parse(rawValue)
      return Array.isArray(parsedValue)
        ? parsedValue.filter(id => typeof id === 'string' && id.length > 0)
        : []
    } catch (error) {
      console.warn(
        '[HistoryRetention] Failed to read pending remote deletes:',
        error,
      )
      return []
    }
  }

  private async setPendingRemoteDeleteIds(interactionIds: string[]) {
    try {
      if (interactionIds.length === 0) {
        await KeyValueStore.delete(PENDING_REMOTE_DELETE_IDS_KEY)
        return
      }
      await KeyValueStore.set(
        PENDING_REMOTE_DELETE_IDS_KEY,
        JSON.stringify(interactionIds),
      )
    } catch (error) {
      console.warn(
        '[HistoryRetention] Failed to persist pending remote deletes:',
        error,
      )
    }
  }

  private notifyHistoryPruned(count: number) {
    broadcastToAllWindows(IPC_EVENTS.HISTORY_RETENTION_PRUNED, { count })
  }
}

export const historyRetentionService = new HistoryRetentionService()
