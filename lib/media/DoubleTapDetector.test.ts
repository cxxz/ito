import { expect, test } from 'bun:test'
import { DoubleTapDetector } from './DoubleTapDetector'

function detectorFor(keys: string[]) {
  const detector = new DoubleTapDetector(keys)
  const pressed = new Set<string>()
  return (type: 'keydown' | 'keyup', key: string, time: number) => {
    if (type === 'keydown') pressed.add(key)
    else pressed.delete(key)
    return detector.update(type, key, time, pressed)
  }
}

test('requires a simultaneous chord, with every key released between taps', () => {
  const event = detectorFor(['control-left', 'space'])
  for (const start of [0, 100]) {
    event('keydown', 'control-left', start)
    event('keyup', 'control-left', start + 10)
    event('keydown', 'space', start + 20)
    expect(event('keyup', 'space', start + 30)).toBe(false)
  }
  for (const start of [200, 300]) {
    event('keydown', 'control-left', start)
    event('keydown', 'space', start + 10)
    event('keyup', 'space', start + 20)
    expect(event('keyup', 'control-left', start + 30)).toBe(start === 300)
  }
})

test('does not count a partial chord release and repress as another tap', () => {
  const event = detectorFor(['control-left', 'space'])
  event('keydown', 'control-left', 0)
  event('keydown', 'space', 10)
  event('keyup', 'space', 20)
  event('keydown', 'space', 30)
  event('keyup', 'space', 40)
  expect(event('keyup', 'control-left', 50)).toBe(false)
})

test('rejects a backwards capture clock and the 400ms double-tap boundary', () => {
  const event = detectorFor(['control-left'])
  event('keydown', 'control-left', 100)
  event('keyup', 'control-left', 150)
  event('keydown', 'control-left', 50)
  expect(event('keyup', 'control-left', 80)).toBe(false)
  event('keydown', 'control-left', 500)
  event('keyup', 'control-left', 550)
  event('keydown', 'control-left', 900)
  expect(event('keyup', 'control-left', 950)).toBe(false)
})
