import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import log from 'electron-log'
import { EventEmitter } from 'events'
import { getNativeBinaryPath } from './native-interface'

// Message types from the native binary
const MSG_TYPE_JSON = 1
const MSG_TYPE_AUDIO = 2

interface Message {
  type: 'json' | 'audio'
  payload: Buffer
}

class AudioRecorderService extends EventEmitter {
  #audioRecorderProcess: ChildProcessWithoutNullStreams | null = null
  #audioBuffer = Buffer.alloc(0)
  #recordingRequested = false
  #ready = false
  #receivedAudio = false
  #startWait: Promise<void> | null = null
  #startup: { resolve: () => void; reject: (error: Error) => void } | null =
    null
  #deviceWait: Promise<string[]> | null = null
  #deviceListPromise: {
    resolve: (value: string[]) => void
    reject: (reason?: any) => void
  } | null = null
  #drainWait: Promise<void> | null = null
  #drainPromise: {
    resolve: () => void
    reject: (reason?: any) => void
  } | null = null

  constructor() {
    super()
  }

  /**
   * Spawns and initializes the native audio-recorder process.
   */
  public initialize(): void {
    if (this.#audioRecorderProcess) {
      log.warn('[AudioService] Audio recorder already running.')
      return
    }

    const binaryPath = getNativeBinaryPath('audio-recorder')
    if (!binaryPath) {
      log.error(
        '[AudioService] Could not determine audio recorder binary path.',
      )
      // Optionally emit an error event
      this.emit('error', new Error('Audio recorder binary not found.'))
      return
    }

    console.log(`[AudioService] Spawning audio recorder at: ${binaryPath}`)
    try {
      this.#audioRecorderProcess = spawn(binaryPath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      const child = this.#audioRecorderProcess
      this.#audioBuffer = Buffer.alloc(0)
      child.stdout.on('data', data => {
        if (this.#audioRecorderProcess === child) this.#onData(data)
      })
      child.stderr.on('data', data => {
        if (this.#audioRecorderProcess === child) this.#onStdErr(data)
      })
      child.on('close', code => {
        if (this.#audioRecorderProcess === child) this.#onClose(code)
      })
      child.on('error', error => {
        if (this.#audioRecorderProcess === child) this.#onError(error)
      })

      this.emit('started')
    } catch (err) {
      log.error(
        '[AudioService] Caught an error while spawning audio recorder:',
        err,
      )
      this.#audioRecorderProcess = null
      this.emit('error', err)
    }
  }

  /**
   * Stops the native audio-recorder process.
   */
  public terminate(): void {
    if (this.#audioRecorderProcess) {
      console.log('[AudioService] Stopping audio recorder process.')
      const child = this.#audioRecorderProcess
      this.#audioRecorderProcess = null
      child.kill()
      this.#rejectPending(new Error('Audio recorder terminated'))
      this.emit('stopped')
    }
  }

  /**
   * Sends a command to start recording from a specific device.
   */
  public startRecording(deviceName: string, timeoutMs = 5000): Promise<void> {
    if (this.#startWait) return this.#startWait
    if (!this.#audioRecorderProcess) this.initialize()
    if (!this.#audioRecorderProcess)
      return Promise.reject(new Error('Audio recorder process not running'))
    this.#recordingRequested = true
    this.#ready = false
    this.#receivedAudio = false
    this.#startWait = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#startup = null
        // A wedged helper must not later deliver audio into another session.
        this.terminate()
        reject(new Error('Microphone did not become ready and produce audio'))
      }, timeoutMs)
      this.#startup = {
        resolve: () => {
          clearTimeout(timer)
          this.#startup = null
          resolve()
        },
        reject: error => {
          clearTimeout(timer)
          this.#startup = null
          reject(error)
        },
      }
      try {
        this.#sendCommand({ command: 'start', device_name: deviceName })
      } catch (error) {
        this.#startup?.reject(error as Error)
      }
    }).finally(() => {
      this.#startWait = null
    })
    return this.#startWait
  }

  /**
   * Sends a command to stop the current recording.
   */
  public stopRecording(): void {
    this.#recordingRequested = false
    this.#startup?.reject(new Error('Recording stopped during startup'))
    this.#sendCommand({ command: 'stop' })
    console.log('[AudioService] Recording stopped')
  }

  /**
   * Requests a list of available audio devices from the native process.
   */
  public getDeviceList(timeoutMs = 3000): Promise<string[]> {
    if (this.#deviceWait) return this.#deviceWait
    if (!this.#audioRecorderProcess)
      return Promise.reject(new Error('Audio recorder process not running.'))
    this.#deviceWait = new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#deviceListPromise = null
        reject(new Error('Audio device enumeration timed out'))
      }, timeoutMs)
      this.#deviceListPromise = {
        resolve: value => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: error => {
          clearTimeout(timer)
          reject(error)
        },
      }
      try {
        this.#sendCommand({ command: 'list-devices' })
      } catch (error) {
        this.#deviceListPromise.reject(error)
        this.#deviceListPromise = null
      }
    }).finally(() => {
      this.#deviceWait = null
    })
    return this.#deviceWait
  }

  /**
   * Requests the effective output audio configuration (sample rate, channels)
   * that the recorder will use for a given device. Resolves via 'audio-config'.
   */
  public requestDeviceConfig(deviceName: string): void {
    this.#sendCommand({ command: 'get-device-config', device_name: deviceName })
  }

  // --- Private Methods ---

  /**
   * Handles incoming data chunks from the process's stdout.
   */
  #onData(chunk: Buffer): void {
    this.#audioBuffer = Buffer.concat([this.#audioBuffer, chunk])
    this.#processData()
  }

  #onStdErr(data: Buffer): void {
    log.error('[AudioService] stderr:', data.toString())
  }

  #onClose(code: number | null): void {
    log.warn(`[AudioService] Process exited with code: ${code}`)
    this.#audioRecorderProcess = null
    this.#rejectPending(new Error('Audio recorder exited unexpectedly'))
    this.emit('stopped')
  }

  #onError(err: Error): void {
    log.error('[AudioService] Failed to start audio recorder:', err)
    this.#audioRecorderProcess = null
    this.#rejectPending(err)
    this.emit('error', err)
  }

  #rejectPending(error: Error) {
    this.#audioBuffer = Buffer.alloc(0)
    this.#startup?.reject(error)
    this.#drainPromise?.reject(error)
    this.#drainPromise = null
    this.#deviceListPromise?.reject(error)
    this.#deviceListPromise = null
    if (this.#recordingRequested) this.emit('recording-error', error)
    this.#recordingRequested = false
  }

  #checkReady() {
    if (this.#ready && this.#receivedAudio) this.#startup?.resolve()
  }

  /**
   * Parses the internal buffer for complete messages and processes them.
   * This function is now cleaner, acting as a loop that calls helper methods.
   */
  #processData(): void {
    while (true) {
      const message = this.#parseMessage()
      if (!message) {
        break // Not enough data for a full message, wait for more.
      }
      this.#handleMessage(message)
    }
  }

  /**
   * Tries to parse a single message from the buffer.
   * If a full message is available, it returns the message and slices the buffer.
   * Otherwise, it returns null.
   */
  #parseMessage(): Message | null {
    if (this.#audioBuffer.length < 5) return null // 1 byte type + 4 bytes length

    const msgType = this.#audioBuffer.readUInt8(0)
    const msgLen = this.#audioBuffer.readUInt32LE(1)
    const frameLen = 5 + msgLen

    if (this.#audioBuffer.length < frameLen) return null // Incomplete frame

    const payload = this.#audioBuffer.slice(5, frameLen)
    this.#audioBuffer = this.#audioBuffer.slice(frameLen) // Consume the message from the buffer

    switch (msgType) {
      case MSG_TYPE_JSON:
        return { type: 'json', payload }
      case MSG_TYPE_AUDIO:
        return { type: 'audio', payload }
      default:
        log.warn(`[AudioService] Unknown message type: ${msgType}`)
        return null // Or handle error appropriately
    }
  }

  /**
   * Handles a parsed message by emitting corresponding events.
   * This completely removes side effects from the data processing logic.
   */
  #handleMessage(message: Message): void {
    if (message.type === 'json') {
      try {
        const jsonResponse = JSON.parse(message.payload.toString('utf-8'))
        if (jsonResponse.type === 'recording-ready') {
          this.#ready = true
          this.#checkReady()
        } else if (jsonResponse.type === 'recording-error') {
          const error = Object.assign(
            new Error(jsonResponse.message || 'Microphone failed'),
            {
              code: jsonResponse.code,
              droppedFrames: jsonResponse.dropped_frames,
              droppedSamples: jsonResponse.dropped_samples,
            },
          )
          this.#startup?.reject(error)
          this.#drainPromise?.reject(error)
          this.#drainPromise = null
          if (this.#recordingRequested) this.emit('recording-error', error)
        } else if (
          jsonResponse.type === 'device-list' &&
          this.#deviceListPromise
        ) {
          this.#deviceListPromise.resolve(jsonResponse.devices || [])
          this.#deviceListPromise = null
        } else if (jsonResponse.type === 'audio-config') {
          const inputRate = Number(jsonResponse.input_sample_rate) || 16000
          const outputRate = Number(jsonResponse.output_sample_rate) || 16000
          const channels = Number(jsonResponse.channels) || 1
          this.emit('audio-config', {
            sampleRate: inputRate,
            outputSampleRate: outputRate,
            channels,
          })
        } else if (jsonResponse.type === 'drain-complete') {
          if (this.#drainPromise) {
            if (jsonResponse.dropped_frames > 0) {
              this.#drainPromise.reject(
                Object.assign(
                  new Error(
                    'Audio capture dropped frames. Please try recording again.',
                  ),
                  {
                    code: 'AUDIO_OVERLOAD',
                    droppedFrames: jsonResponse.dropped_frames,
                  },
                ),
              )
            } else this.#drainPromise.resolve()
            this.#drainPromise = null
          }
        }
        // You could emit a generic 'json-message' event here if needed
      } catch (err) {
        log.error('[AudioService] Failed to parse JSON response:', err)
        // Optionally reject pending device list promise if parsing fails
        if (this.#deviceListPromise) {
          this.#deviceListPromise.reject(
            new Error('Failed to parse JSON response'),
          )
          this.#deviceListPromise = null
        }
        if (this.#drainPromise) {
          this.#drainPromise.reject(err as Error)
          this.#drainPromise = null
        }
      }
    } else if (message.type === 'audio') {
      this.#receivedAudio = true
      this.#checkReady()
      const volume = this.#calculateVolume(message.payload)

      this.emit('volume-update', volume)
      this.emit('audio-chunk', message.payload)
    }
  }

  public awaitDrainComplete(timeoutMs: number = 500): Promise<void> {
    if (this.#drainWait) return this.#drainWait
    this.#drainWait = new Promise<void>((resolve, reject) => {
      let settled = false
      const onTimeout = setTimeout(() => {
        if (!settled) {
          settled = true
          this.#drainPromise = null
          // Do not let a late writer drain into a replacement recording.
          this.terminate()
          reject(new Error('Audio recorder drain timed out'))
        }
      }, timeoutMs)
      this.#drainPromise = {
        resolve: () => {
          if (!settled) {
            settled = true
            clearTimeout(onTimeout)
            resolve()
          }
        },
        reject: (err?: any) => {
          if (!settled) {
            settled = true
            clearTimeout(onTimeout)
            reject(err)
          }
        },
      }
    }).finally(() => {
      this.#drainWait = null
    })
    return this.#drainWait
  }

  #sendCommand(command: object): void {
    if (this.#audioRecorderProcess?.stdin) {
      const cmdString = JSON.stringify(command) + '\n'
      this.#audioRecorderProcess.stdin.write(cmdString)
    } else {
      log.warn('[AudioService] Cannot send command, process not running.')
    }
  }

  #calculateVolume(buffer: Buffer): number {
    if (buffer.length < 2) return 0
    let sumOfSquares = 0
    for (let i = 0; i < buffer.length - 1; i += 2) {
      const sample = buffer.readInt16LE(i)
      sumOfSquares += sample * sample
    }
    const rms = Math.sqrt(sumOfSquares / (buffer.length / 2))
    return Math.min(rms / 32767, 1.0)
  }
}

// Export a singleton instance of the service
export const audioRecorderService = new AudioRecorderService()
