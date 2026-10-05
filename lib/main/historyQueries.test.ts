import { Database } from 'bun:sqlite'
import { beforeEach, expect, mock, test } from 'bun:test'
import { INITIAL_SCHEMA } from './sqlite/schema'
import { MIGRATIONS } from './sqlite/migrations'

const db = new Database(':memory:')
db.exec(INITIAL_SCHEMA)
for (const migration of MIGRATIONS) db.exec(migration.up)
const reads: string[] = []
mock.module('./sqlite/utils', () => ({
  all: async (query: string, params: any[] = []) => {
    reads.push(query)
    return db.query(query).all(...params)
  },
  get: async (query: string, params: any[] = []) => {
    reads.push(query)
    return db.query(query).get(...params)
  },
  run: async (query: string, params: any[] = []) => {
    db.query(query).run(...params)
  },
  exec: async (query: string) => {
    db.exec(query)
  },
}))
const { getHistoryPage, getHistoryStats, getHistoryIds } = await import(
  './historyQueries'
)
const { InteractionsTable } = await import('./sqlite/repo')

beforeEach(() => {
  db.exec('DELETE FROM interactions')
  reads.length = 0
})

function insert(
  id: string,
  userId = 'user',
  words = 'hello world',
  createdAt = '2026-10-06T10:00:00.000Z',
) {
  db.query(
    `INSERT INTO interactions
    (id, user_id, asr_output, llm_output, duration_ms, created_at, updated_at, raw_audio)
    VALUES (?, ?, ?, '{}', 1000, ?, ?, zeroblob(1048576))`,
  ).run(id, userId, JSON.stringify({ transcript: words }), createdAt, createdAt)
}

test('keyset pages exclude audio blobs and scope users, deleted records, and equal timestamps', async () => {
  for (let i = 0; i < 55; i++) insert(String(i).padStart(3, '0'))
  insert('private', 'another-user')
  insert('deleted')
  db.exec(
    "UPDATE interactions SET deleted_at = '2026-10-06' WHERE id = 'deleted'",
  )
  const first = await getHistoryPage('user')
  expect(first.items).toHaveLength(50)
  expect(first.items.every(row => row.has_audio && !('raw_audio' in row))).toBe(
    true,
  )
  const second = await getHistoryPage('user', first.nextCursor)
  expect(second.items).toHaveLength(5)
  expect(second.nextCursor).toBeNull()
  expect(
    new Set([...first.items, ...second.items].map(row => row.id)).size,
  ).toBe(55)
  expect(await getHistoryIds('user')).toHaveLength(55)
  expect(reads.every(query => !query.includes('SELECT *'))).toBe(true)
})

test('statistics cover all pages, preserve whitespace word counts, and invalidate on edits', async () => {
  const now = new Date('2026-10-06T12:00:00.000Z')
  insert('a', 'user', 'hello\tworld\n你好')
  insert('b', 'user', 'yesterday', '2026-10-05T10:00:00.000Z')
  const stats = await getHistoryStats('user', now)
  expect(stats.totalWords).toBe(4)
  expect(stats.weeklyWords).toBe(4)
  expect(stats.averageWPM).toBe(120)
  expect(stats.streakDays).toBe(2)
  const row = await InteractionsTable.findById('a')
  await InteractionsTable.upsert({
    ...row!,
    llm_output: { adjustedTranscript: 'polished' },
  })
  expect((await getHistoryStats('user', now)).totalWords).toBe(2)
  await InteractionsTable.softDelete('b')
  expect((await getHistoryStats('user', now)).totalWords).toBe(1)
})

test('page sizes are bounded even for invalid or oversized requests', async () => {
  insert('a')
  await getHistoryPage('user', null, Number.POSITIVE_INFINITY)
  await expect(getHistoryPage('user', { id: 1 } as any)).rejects.toThrow(
    'Invalid history cursor',
  )
  expect((await getHistoryPage('user', null, 100000)).items).toHaveLength(1)
})
