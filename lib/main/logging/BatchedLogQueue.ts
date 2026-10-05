/** Bounded log queue with throttled persistence and identity-based acknowledgments. */
export class BatchedLogQueue<T extends object> {
  private events: T[]
  private timer: ReturnType<typeof setTimeout> | null = null
  private dirty = false

  constructor(
    initial: T[],
    private readonly persist: (events: T[]) => void,
    private readonly onError: (error: unknown) => void,
    private readonly maxEvents = 5000,
    private readonly persistIntervalMs = 1000,
  ) {
    this.events = initial.slice(-maxEvents)
  }

  get length() {
    return this.events.length
  }

  append(event: T) {
    this.events.push(event)
    if (this.events.length > this.maxEvents)
      this.events.splice(0, this.events.length - this.maxEvents)
    this.changed()
  }

  take(count: number): T[] {
    return this.events.slice(0, count)
  }

  acknowledge(batch: T[]) {
    const sent = new Set(batch)
    // New events may have evicted part of this batch while the upload was pending.
    this.events = this.events.filter(event => !sent.has(event))
    this.changed()
  }

  private changed() {
    this.dirty = true
    if (!this.timer)
      this.timer = setTimeout(() => this.persistNow(), this.persistIntervalMs)
  }

  persistNow() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.dirty) return
    this.dirty = false
    try {
      this.persist([...this.events])
    } catch (error) {
      this.onError(error)
    }
  }
}
