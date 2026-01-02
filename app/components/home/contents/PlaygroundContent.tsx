import { useCallback, useRef, useState } from 'react'
import {
  Upload,
  Play,
  Square,
  Copy,
  Check,
  X,
  Refresh,
} from '@mynaui/icons-react'
import { Button } from '../../ui/button'
import { Spinner } from '../../ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip'
import { usePlaygroundStore } from '../../../store/usePlaygroundStore'
import { createStereo48kWavFromMonoPCM } from '@/app/utils/audioUtils'

const ASR_PROVIDER_OPTIONS = ['groq', 'aliyun']
const POLISH_PROVIDER_OPTIONS = ['groq', 'cerebras', 'openai']

export default function PlaygroundContent() {
  const {
    audioBuffer,
    audioFileName,
    audioDuration,
    sampleRate,
    interactionId,
    asrProvider,
    asrModel,
    customVocabulary,
    polishLlmProvider,
    polishLlmModel,
    polishLlmTemperature,
    transcriptionPrompt,
    asrOutput,
    originalAsrOutput,
    polishedOutput,
    asrError,
    polishError,
    isTranscribing,
    isPolishing,
    setAudioFile,
    setAsrProvider,
    setAsrModel,
    setCustomVocabulary,
    setPolishLlmProvider,
    setPolishLlmModel,
    setPolishLlmTemperature,
    setTranscriptionPrompt,
    resetTranscriptionPrompt,
    setAsrOutput,
    restoreOriginalAsrOutput,
    runTranscribeOnly,
    runTranscribeAndPolish,
    runPolishOnly,
    clearAudio,
  } = usePlaygroundStore()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [copiedField, setCopiedField] = useState<'asr' | 'polished' | null>(
    null,
  )
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const handleFileSelect = useCallback(
    async (file: File) => {
      if (
        file.type.startsWith('audio/') ||
        file.name.match(/\.(wav|mp3|m4a|webm|ogg)$/i)
      ) {
        await setAudioFile(file)
      } else {
        console.error('Invalid file type:', file.type)
      }
    },
    [setAudioFile],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) {
        handleFileSelect(file)
      }
    },
    [handleFileSelect],
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) {
        handleFileSelect(file)
      }
    },
    [handleFileSelect],
  )

  const handlePlayAudio = useCallback(() => {
    if (!audioBuffer) return

    if (isPlaying && audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
      setIsPlaying(false)
      return
    }

    // If audio came from an interaction, it's raw PCM and needs WAV conversion
    // If audio came from file upload, it's already a playable format
    let audioBlob: Blob
    if (interactionId) {
      const pcmData = new Uint8Array(audioBuffer)
      const wavBuffer = createStereo48kWavFromMonoPCM(pcmData, sampleRate, 48000)
      audioBlob = new Blob([wavBuffer], { type: 'audio/wav' })
    } else {
      audioBlob = new Blob([audioBuffer], { type: 'audio/wav' })
    }

    const url = URL.createObjectURL(audioBlob)
    const audio = new Audio(url)

    audio.onended = () => {
      setIsPlaying(false)
      URL.revokeObjectURL(url)
      audioRef.current = null
    }

    audio.onerror = () => {
      setIsPlaying(false)
      URL.revokeObjectURL(url)
      audioRef.current = null
    }

    audioRef.current = audio
    audio.play()
    setIsPlaying(true)
  }, [audioBuffer, isPlaying, interactionId, sampleRate])

  const handleCopy = useCallback(
    async (text: string, field: 'asr' | 'polished') => {
      try {
        await navigator.clipboard.writeText(text)
        setCopiedField(field)
        setTimeout(() => setCopiedField(null), 2000)
      } catch (error) {
        console.error('Failed to copy:', error)
      }
    },
    [],
  )

  const handleTranscribe = useCallback(async () => {
    await runTranscribeOnly()
  }, [runTranscribeOnly])

  const handleTranscribeAndPolish = useCallback(async () => {
    await runTranscribeAndPolish()
  }, [runTranscribeAndPolish])

  const handlePolish = useCallback(async () => {
    await runPolishOnly()
  }, [runPolishOnly])

  const isRunning = isTranscribing || isPolishing

  return (
    <div className="w-full px-24 py-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-medium">Playground</h1>
        <p className="text-sm text-gray-500 mt-1">
          Experiment with transcription and polish settings
        </p>
      </div>

      <div className="space-y-4">
        {/* Audio Source and Custom Vocabulary - Side by Side */}
        <div className="grid grid-cols-2 gap-4">
          {/* Audio Source */}
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h2 className="text-xs font-medium text-gray-500 uppercase mb-3">
              Audio Source
            </h2>

            {!audioBuffer ? (
              <div
                className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                  isDragging
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-300 hover:border-gray-400'
                }`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-6 h-6 text-gray-400 mx-auto mb-1" />
                <p className="text-xs text-gray-600">
                  Drop audio or click to browse
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  WAV, MP3, M4A, WebM
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg"
                  className="hidden"
                  onChange={handleFileInputChange}
                />
              </div>
            ) : (
              <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handlePlayAudio}
                    className="p-1.5 rounded-full bg-white border border-gray-200 hover:bg-gray-100 transition-colors"
                  >
                    {isPlaying ? (
                      <Square className="w-3 h-3 text-gray-600" />
                    ) : (
                      <Play className="w-3 h-3 text-gray-600" />
                    )}
                  </button>
                  <div>
                    <p className="text-sm font-medium text-gray-700 truncate max-w-[150px]">
                      {audioFileName}
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatDuration(audioDuration)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={clearAudio}
                  className="p-1 rounded hover:bg-gray-200 transition-colors"
                >
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>
            )}
          </div>

          {/* Custom Vocabulary */}
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h2 className="text-xs font-medium text-gray-500 uppercase mb-2">
              Custom Vocabulary{' '}
              <span className="text-gray-400 font-normal lowercase">
                (optional)
              </span>
            </h2>
            <textarea
              value={customVocabulary}
              onChange={e => setCustomVocabulary(e.target.value)}
              placeholder="Enter words separated by spaces or commas..."
              className="w-full h-20 px-2 py-1.5 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* ASR Settings Section */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-medium text-gray-500 uppercase">
              ASR Settings
            </h2>
            <div className="flex gap-2">
              <Button
                onClick={handleTranscribe}
                disabled={!audioBuffer || isRunning}
                variant="outline"
                size="sm"
                className="px-3 h-7 text-xs"
              >
                {isTranscribing ? (
                  <>
                    <Spinner className="w-3 h-3" />
                    Transcribing...
                  </>
                ) : (
                  'Transcribe'
                )}
              </Button>
              <Button
                onClick={handleTranscribeAndPolish}
                disabled={!audioBuffer || isRunning}
                size="sm"
                className="px-3 h-7 text-xs"
              >
                {isTranscribing ? (
                  <>
                    <Spinner className="w-3 h-3" />
                    Processing...
                  </>
                ) : (
                  'Transcribe & Polish'
                )}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Provider
              </label>
              <select
                value={asrProvider}
                onChange={e => setAsrProvider(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {ASR_PROVIDER_OPTIONS.map(provider => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Model</label>
              <input
                type="text"
                value={asrModel}
                onChange={e => setAsrModel(e.target.value)}
                placeholder="whisper-large-v3"
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>

        {/* RAW ASR OUTPUT Section */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-medium text-gray-500 uppercase">
              Raw ASR Output
            </h2>
            <div className="flex items-center gap-1">
              {asrOutput && asrOutput !== originalAsrOutput && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={restoreOriginalAsrOutput}
                      className="p-1.5 rounded hover:bg-gray-100 transition-colors"
                    >
                      <Refresh className="w-4 h-4 text-gray-400" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Restore original</TooltipContent>
                </Tooltip>
              )}
              {asrOutput && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => handleCopy(asrOutput, 'asr')}
                      className="p-1.5 rounded hover:bg-gray-100 transition-colors"
                    >
                      {copiedField === 'asr' ? (
                        <Check className="w-4 h-4 text-green-500" />
                      ) : (
                        <Copy className="w-4 h-4 text-gray-400" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Copy to clipboard</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
          {asrError ? (
            <p className="text-sm text-red-500 p-3 bg-gray-50 rounded-lg">
              {asrError}
            </p>
          ) : asrOutput ? (
            <textarea
              value={asrOutput}
              onChange={e => setAsrOutput(e.target.value)}
              className="w-full min-h-[60px] p-3 text-sm text-gray-700 bg-gray-50 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
            />
          ) : (
            <div className="min-h-[60px] p-3 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-400 italic">
                No transcription yet
              </p>
            </div>
          )}
        </div>

        {/* Polish Settings Section */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-medium text-gray-500 uppercase">
              Polish Settings
            </h2>
            <Button
              onClick={handlePolish}
              disabled={!asrOutput || isPolishing}
              variant="outline"
              size="sm"
              className="px-3 h-7 text-xs"
            >
              {isPolishing ? (
                <>
                  <Spinner className="w-3 h-3" />
                  Polishing...
                </>
              ) : (
                'Polish'
              )}
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Provider
              </label>
              <select
                value={polishLlmProvider}
                onChange={e => setPolishLlmProvider(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {POLISH_PROVIDER_OPTIONS.map(provider => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Model</label>
              <input
                type="text"
                value={polishLlmModel}
                onChange={e => setPolishLlmModel(e.target.value)}
                placeholder={polishLlmModel || 'Model name'}
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Temperature
              </label>
              <input
                type="number"
                value={polishLlmTemperature}
                onChange={e =>
                  setPolishLlmTemperature(parseFloat(e.target.value) || 0)
                }
                min={0}
                max={2}
                step={0.1}
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>

        {/* Transcription Prompt Section */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-medium text-gray-500 uppercase">
              Transcription Prompt
            </h2>
            <button
              onClick={resetTranscriptionPrompt}
              className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
            >
              Reset to default
            </button>
          </div>
          <textarea
            value={transcriptionPrompt}
            onChange={e => setTranscriptionPrompt(e.target.value)}
            className="w-full h-32 px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
          />
        </div>

        {/* Polished Output Section */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-medium text-gray-500 uppercase">
              Polished Output
            </h2>
            {polishedOutput && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => handleCopy(polishedOutput, 'polished')}
                    className="p-1.5 rounded hover:bg-gray-100 transition-colors"
                  >
                    {copiedField === 'polished' ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4 text-gray-400" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>Copy to clipboard</TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="min-h-[60px] p-3 bg-gray-50 rounded-lg">
            {polishError ? (
              <p className="text-sm text-red-500">{polishError}</p>
            ) : polishedOutput ? (
              <p className="text-sm text-gray-700 whitespace-pre-wrap">
                {polishedOutput}
              </p>
            ) : (
              <p className="text-sm text-gray-400 italic">
                No polished output yet
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
