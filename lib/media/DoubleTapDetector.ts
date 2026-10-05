/** Recognizes two clean, fully released chords using event capture times. */
export class DoubleTapDetector {
  private firstTapTime: number | null = null
  private downTime: number | null = null
  private lastEventTime: number | null = null
  private chordComplete = false
  private releasing = false

  constructor(private readonly keys: string[]) {}

  reset() {
    this.firstTapTime = null
    this.downTime = null
    this.lastEventTime = null
    this.chordComplete = false
    this.releasing = false
  }

  update(
    type: 'keydown' | 'keyup',
    key: string,
    time: number,
    pressedKeys: ReadonlySet<string>,
  ): boolean {
    if (
      !Number.isFinite(time) ||
      (this.lastEventTime !== null && time < this.lastEventTime) ||
      !this.keys.includes(key) ||
      [...pressedKeys].some(pressed => !this.keys.includes(pressed))
    ) {
      this.reset()
      return false
    }
    this.lastEventTime = time

    if (type === 'keydown') {
      if (this.releasing) {
        this.reset()
        return false
      }
      if (this.downTime === null) {
        // Do not start halfway through a chord after an interruption.
        if (pressedKeys.size !== 1) return false
        this.downTime = time
      }
      this.chordComplete = this.keys.every(key => pressedKeys.has(key))
      return false
    }

    if (this.downTime === null) return false
    if (!this.chordComplete || time - this.downTime > 300) {
      this.reset()
      return false
    }
    this.releasing = true
    if (pressedKeys.size > 0) return false

    const isDoubleTap =
      this.firstTapTime !== null && time - this.firstTapTime < 400
    this.downTime = null
    this.chordComplete = false
    this.releasing = false
    this.firstTapTime = isDoubleTap ? null : time
    return isDoubleTap
  }
}
