export const DEFAULT_HISTORY_RETENTION_DAYS = 7
export const MIN_HISTORY_RETENTION_DAYS = 1
export const MAX_HISTORY_RETENTION_DAYS = 3650
export const HISTORY_RETENTION_CHECK_INTERVAL_MS = 60 * 60 * 1000

export const normalizeHistoryRetentionDays = (value: unknown): number => {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : DEFAULT_HISTORY_RETENTION_DAYS

  if (!Number.isFinite(parsed)) {
    return DEFAULT_HISTORY_RETENTION_DAYS
  }

  return Math.min(
    MAX_HISTORY_RETENTION_DAYS,
    Math.max(MIN_HISTORY_RETENTION_DAYS, Math.floor(parsed)),
  )
}
