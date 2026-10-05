import { expect, mock, test } from 'bun:test'
import { BatchedLogQueue } from './BatchedLogQueue'

test('a burst persists once instead of serializing the queue for every log', async () => {
  const persist = mock()
  const queue = new BatchedLogQueue<{ i: number }>(
    [],
    persist,
    () => {},
    5000,
    10,
  )
  for (let i = 0; i < 1000; i++) queue.append({ i })
  expect(persist).not.toHaveBeenCalled()
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(persist).toHaveBeenCalledTimes(1)
  expect(persist.mock.calls[0][0]).toHaveLength(1000)
  queue.persistNow()
  expect(persist).toHaveBeenCalledTimes(1)
})

test('acknowledging an evicted batch does not discard newer unsent logs', () => {
  const queue = new BatchedLogQueue<{ id: number }>(
    [],
    () => {},
    () => {},
    3,
  )
  queue.append({ id: 1 })
  queue.append({ id: 2 })
  const batch = queue.take(2)
  queue.append({ id: 3 })
  queue.append({ id: 4 })
  queue.append({ id: 5 })
  queue.acknowledge(batch)
  expect(queue.take(3).map(event => event.id)).toEqual([3, 4, 5])
  queue.persistNow()
})
