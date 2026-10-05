import { all, get, run } from './sqlite/utils'
import { parseInteractionJsonFields } from './sqlite/repo'
import type {
  HistoryCursor,
  HistoryItem,
  HistoryPage,
  HistoryStats,
} from '../types/history'

const userFilter = (userId?: string) =>
  userId ? 'user_id = ?' : 'user_id IS NULL'
const userParams = (userId?: string) => (userId ? [userId] : [])

export async function getHistoryPage(
  userId?: string,
  before?: HistoryCursor | null,
  requestedLimit = 50,
): Promise<HistoryPage> {
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(100, Math.max(1, Math.floor(requestedLimit)))
    : 50
  if (
    before &&
    (typeof before.createdAt !== 'string' || typeof before.id !== 'string')
  )
    throw new Error('Invalid history cursor')
  const rows = await all<HistoryItem>(
    `
    SELECT id, user_id, title, asr_output, llm_output, raw_audio_id,
      duration_ms, sample_rate, created_at, updated_at, deleted_at,
      (length(raw_audio) > 0) AS has_audio
    FROM interactions WHERE ${userFilter(userId)} AND deleted_at IS NULL
      ${before ? 'AND (created_at, id) < (?, ?)' : ''}
    ORDER BY created_at DESC, id DESC LIMIT ?`,
    [
      ...userParams(userId),
      ...(before ? [before.createdAt, before.id] : []),
      limit + 1,
    ],
  )
  const items = rows.slice(0, limit).map(row => ({
    ...parseInteractionJsonFields(row),
    has_audio: !!row.has_audio,
  }))
  const last = items.at(-1)
  return {
    items,
    nextCursor:
      rows.length > limit && last
        ? { createdAt: last.created_at, id: last.id }
        : null,
  }
}

export async function getHistoryIds(userId?: string): Promise<string[]> {
  return (
    await all<{ id: string }>(
      `SELECT id FROM interactions WHERE ${userFilter(userId)} AND deleted_at IS NULL`,
      userParams(userId),
    )
  ).map(row => row.id)
}

// Backfill old records in small batches; new/changed records are counted once.
const backfills = new Map<string, Promise<void>>()
async function updateWordCounts(userId?: string) {
  const key = userId ?? ''
  const existing = backfills.get(key)
  if (existing) return existing
  const pending = (async () => {
    while (true) {
      const rows = await all<{
        id: string
        asr_output: any
        llm_output: any
        updated_at: string
      }>(
        `SELECT id, asr_output, llm_output, updated_at FROM interactions
         WHERE ${userFilter(userId)} AND deleted_at IS NULL AND word_count IS NULL LIMIT 100`,
        userParams(userId),
      )
      if (!rows.length) break
      for (const row of rows) {
        const parsed = parseInteractionJsonFields({ ...row })
        const text =
          parsed.llm_output?.adjustedTranscript?.trim() ||
          parsed.asr_output?.transcript?.trim() ||
          ''
        const count =
          typeof text === 'string' && text ? text.split(/\s+/).length : 0
        await run(
          `UPDATE interactions SET word_count = ? WHERE id = ? AND word_count IS NULL
          AND updated_at = ? AND asr_output IS ? AND llm_output IS ?`,
          [count, row.id, row.updated_at, row.asr_output, row.llm_output],
        )
      }
      await new Promise<void>(resolve => setImmediate(resolve))
    }
  })().finally(() => {
    backfills.delete(key)
  })
  backfills.set(key, pending)
  return pending
}

export async function getHistoryStats(
  userId?: string,
  now = new Date(),
): Promise<HistoryStats> {
  await updateWordCounts(userId)
  const week = new Date(now)
  week.setDate(week.getDate() - ((week.getDay() + 6) % 7))
  week.setHours(0, 0, 0, 0)
  const totals = await get<{
    totalWords: number
    weeklyWords: number
    timedWords: number
    durationMs: number
  }>(
    `
    SELECT COALESCE(SUM(word_count), 0) AS totalWords,
      COALESCE(SUM(CASE WHEN created_at >= ? THEN word_count ELSE 0 END), 0) AS weeklyWords,
      COALESCE(SUM(CASE WHEN duration_ms > 0 THEN word_count ELSE 0 END), 0) AS timedWords,
      COALESCE(SUM(CASE WHEN word_count > 0 AND duration_ms > 0 THEN duration_ms ELSE 0 END), 0) AS durationMs
    FROM interactions WHERE ${userFilter(userId)} AND deleted_at IS NULL`,
    [week.toISOString(), ...userParams(userId)],
  )
  const days = await all<{ day: string }>(
    `SELECT DISTINCT date(created_at, 'localtime') AS day
    FROM interactions WHERE ${userFilter(userId)} AND deleted_at IS NULL ORDER BY day DESC`,
    userParams(userId),
  )
  let streakDays = 0
  const expected = new Date(now)
  for (const { day } of days) {
    const date = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`
    if (day !== date) break
    streakDays++
    expected.setDate(expected.getDate() - 1)
  }
  return {
    streakDays,
    totalWords: totals?.totalWords ?? 0,
    weeklyWords: totals?.weeklyWords ?? 0,
    averageWPM: totals?.durationMs
      ? Math.round(Math.max(1, (totals.timedWords * 60000) / totals.durationMs))
      : 0,
  }
}
