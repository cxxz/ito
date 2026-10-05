import React, { useCallback, useEffect, useState, useRef } from 'react'
import {
  ChartNoAxesColumn,
  InfoCircle,
  Play,
  Stop,
  Copy,
  Check,
  Download,
  Trash,
  Refresh,
  DangerTriangle,
  Flask,
} from '@mynaui/icons-react'
import { EXTERNAL_LINKS } from '@/lib/constants/external-links'
import { useSettingsStore } from '../../../store/useSettingsStore'
import { Tooltip, TooltipTrigger, TooltipContent } from '../../ui/tooltip'
import { useAuthStore } from '@/app/store/useAuthStore'
import { useMainStore } from '@/app/store/useMainStore'
import { usePlaygroundStore } from '@/app/store/usePlaygroundStore'
import type {
  HistoryItem as Interaction,
  HistoryCursor,
} from '@/lib/types/history'
import { TotalWordsIcon } from '../../icons/TotalWordsIcon'
import { SpeedIcon } from '../../icons/SpeedIcon'
import {
  STREAK_MESSAGES,
  SPEED_MESSAGES,
  TOTAL_WORDS_MESSAGES,
  getStreakLevel,
  getSpeedLevel,
  getTotalWordsLevel,
  getActivityMessage,
} from './activityMessages'
import { ItoMode } from '@/app/generated/ito_pb'
import { getKeyDisplay } from '@/app/utils/keyboard'
import { createStereo48kWavFromMonoPCM } from '@/app/utils/audioUtils'
import { KeyName } from '@/lib/types/keyboard'
import { usePlatform } from '@/app/hooks/usePlatform'
import { InteractionStats } from '@/app/utils/userMetrics'
import { IPC_EVENTS } from '@/lib/types/ipc'

function disposeAudio(audio: HTMLAudioElement) {
  audio.onended = null
  audio.onerror = null
  audio.pause()
  audio.currentTime = 0
  if (audio.src?.startsWith('blob:')) URL.revokeObjectURL(audio.src)
}

const StatCard = ({
  title,
  value,
  description,
  icon,
}: {
  title: string
  value: string
  description: string
  icon: React.ReactNode
}) => {
  return (
    <div className="flex flex-col p-4 w-1/3 border-2 border-neutral-100 rounded-xl gap-4">
      <div className="flex flex-row items-center">
        <div className="flex flex-col gap-1">
          <div>{title}</div>
          <div className="font-bold">{value}</div>
        </div>
        <div className="flex flex-col items-end flex-1">{icon}</div>
      </div>
      <div className="w-full text-neutral-400">{description}</div>
    </div>
  )
}

export default function HomeContent() {
  const { getItoModeShortcuts } = useSettingsStore()
  const keyboardShortcut = getItoModeShortcuts(ItoMode.TRANSCRIBE)[0].keys
  const { user } = useAuthStore()
  const firstName = user?.name?.split(' ')[0]
  const platform = usePlatform()
  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [loading, setLoading] = useState(true)
  const [pageCursors, setPageCursors] = useState<Array<HistoryCursor | null>>([
    null,
  ])
  const [nextCursor, setNextCursor] = useState<HistoryCursor | null>(null)
  const loadGeneration = useRef(0)
  const audioRequest = useRef(0)
  const [playingAudio, setPlayingAudio] = useState<string | null>(null)
  const activeAudio = useRef<{ id: string; audio: HTMLAudioElement } | null>(
    null,
  )
  const [copiedItems, setCopiedItems] = useState<Set<string>>(new Set())
  const [openTooltipKey, setOpenTooltipKey] = useState<string | null>(null)
  const [retranscribingIds, setRetranscribingIds] = useState<Set<string>>(
    new Set(),
  )
  const [expandedInteractionIds, setExpandedInteractionIds] = useState<
    Set<string>
  >(new Set())
  const [isClearingAll, setIsClearingAll] = useState(false)
  const [stats, setStats] = useState<InteractionStats>({
    streakDays: 0,
    totalWords: 0,
    weeklyWords: 0,
    averageWPM: 0,
  })

  const formatStreakText = (days: number): string => {
    if (days === 0) return '0 days'
    if (days === 1) return '1 day'
    if (days < 7) return `${days} days`
    if (days < 14) return '1 week'
    if (days < 30) return `${Math.floor(days / 7)} weeks`
    if (days < 60) return '1 month'
    return `${Math.floor(days / 30)} months`
  }

  const loadInteractions = useCallback(
    async (before: HistoryCursor | null = null) => {
      const generation = ++loadGeneration.current
      setLoading(true)
      // Statistics are aggregated in SQLite and do not delay painting the page.
      void window.api.interactions
        .getStats()
        .then(result => {
          if (generation === loadGeneration.current) setStats(result)
        })
        .catch(error =>
          console.error('Failed to load history statistics:', error),
        )
      try {
        const page = await window.api.interactions.getPage(before)
        if (generation !== loadGeneration.current) return
        setInteractions(page.items)
        setNextCursor(page.nextCursor)
      } catch (error) {
        console.error('Failed to load interactions:', error)
      } finally {
        if (generation === loadGeneration.current) setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    const requests = { load: loadGeneration, audio: audioRequest, activeAudio }
    loadInteractions()

    // Listen for new interactions
    const handleHistoryChanged = () => {
      setPageCursors([null])
      loadInteractions()
    }

    const unsubscribeInteractionCreated = window.api.on(
      'interaction-created',
      handleHistoryChanged,
    )
    const unsubscribeHistoryPruned = window.api.on(
      IPC_EVENTS.HISTORY_RETENTION_PRUNED,
      handleHistoryChanged,
    )

    // Cleanup listener on unmount
    return () => {
      requests.load.current++
      requests.audio.current++
      if (requests.activeAudio.current) {
        disposeAudio(requests.activeAudio.current.audio)
        requests.activeAudio.current = null
      }
      unsubscribeInteractionCreated()
      unsubscribeHistoryPruned()
    }
  }, [loadInteractions])

  const formatTime = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const today = new Date()
    const yesterday = new Date()
    yesterday.setDate(today.getDate() - 1)

    const isToday = date.toDateString() === today.toDateString()
    const isYesterday = date.toDateString() === yesterday.toDateString()

    if (isToday) return 'TODAY'
    if (isYesterday) return 'YESTERDAY'

    return date
      .toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      })
      .toUpperCase()
  }

  const groupInteractionsByDate = (interactions: Interaction[]) => {
    const groups: { [key: string]: Interaction[] } = {}

    interactions.forEach(interaction => {
      const dateKey = formatDate(interaction.created_at)
      if (!groups[dateKey]) {
        groups[dateKey] = []
      }
      groups[dateKey].push(interaction)
    })

    return groups
  }

  const getDisplayText = (interaction: Interaction) => {
    // Check for errors first
    if (interaction.asr_output?.error) {
      // Prefer precise error code mapping when available
      const code = interaction.asr_output?.errorCode
      if (code === 'CLIENT_TRANSCRIPTION_QUALITY_ERROR') {
        return {
          text: 'Audio quality too low',
          isError: true,
          tooltip:
            'Audio quality was too low to generate a reliable transcript',
        }
      }
      if (
        interaction.asr_output.error.includes('No speech detected in audio.') ||
        interaction.asr_output.error.includes('Unable to transcribe audio.')
      ) {
        return {
          text: 'Audio is silent',
          isError: true,
          tooltip: "Ito didn't detect any words so the transcript is empty",
        }
      }
      return {
        text: 'Transcription failed',
        isError: true,
        tooltip: interaction.asr_output.error,
      }
    }

    // Check for empty transcript
    const transcript = interaction.asr_output?.transcript?.trim()

    if (!transcript) {
      return {
        text: 'Audio is silent.',
        isError: true,
        tooltip: "Ito didn't detect any words so the transcript is empty",
      }
    }

    // Return the actual transcript
    return {
      text: transcript,
      isError: false,
      tooltip: null,
    }
  }

  const getPolishError = (
    interaction: Interaction,
  ): { message: string; provider: string; model: string } | null => {
    if (interaction.llm_output?.errorCode === 'POLISH_LLM_FAILED') {
      return {
        message: interaction.llm_output.error || 'Polish failed',
        provider: interaction.llm_output.provider || 'unknown',
        model: interaction.llm_output.model || 'unknown',
      }
    }
    return null
  }

  const cleanupAllAudioInstances = () => {
    audioRequest.current++
    if (activeAudio.current) disposeAudio(activeAudio.current.audio)
    activeAudio.current = null
    setPlayingAudio(null)
  }

  const cleanupAudioInstance = (interactionId: string) => {
    if (
      playingAudio === interactionId ||
      activeAudio.current?.id === interactionId
    )
      cleanupAllAudioInstances()
  }

  const handleAudioPlayStop = async (interaction: Interaction) => {
    const wasPlaying = playingAudio === interaction.id
    cleanupAllAudioInstances()
    if (wasPlaying || !interaction.has_audio) return

    const request = ++audioRequest.current
    setPlayingAudio(interaction.id)
    try {
      const full = await window.api.interactions.getById(interaction.id)
      if (request !== audioRequest.current) return
      if (!full?.raw_audio) {
        setPlayingAudio(null)
        return
      }
      const wavBuffer = createStereo48kWavFromMonoPCM(
        new Uint8Array(full.raw_audio),
        interaction.sample_rate || 16000,
        48000,
      )
      const audioUrl = URL.createObjectURL(
        new Blob([wavBuffer], { type: 'audio/wav' }),
      )
      let audio: HTMLAudioElement
      try {
        audio = new Audio(audioUrl)
      } catch (error) {
        URL.revokeObjectURL(audioUrl)
        throw error
      }
      activeAudio.current = { id: interaction.id, audio }
      audio.onended = () => {
        if (request === audioRequest.current) cleanupAllAudioInstances()
      }
      audio.onerror = error => {
        console.error('Audio playback error:', error)
        if (request === audioRequest.current) cleanupAllAudioInstances()
      }
      await audio.play()
    } catch (error) {
      console.error('Failed to play audio:', error)
      if (request === audioRequest.current) cleanupAllAudioInstances()
    }
  }

  const groupedInteractions = groupInteractionsByDate(interactions)

  const toggleExpandedInteraction = (interactionId: string) => {
    setExpandedInteractionIds(prev => {
      const next = new Set(prev)
      if (next.has(interactionId)) {
        next.delete(interactionId)
      } else {
        next.add(interactionId)
      }
      return next
    })
  }

  const copyToClipboard = async (text: string, interactionId: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedItems(prev => new Set(prev).add(interactionId))
      setOpenTooltipKey(`copy:${interactionId}`) // Keep tooltip open

      // Reset the copied state after 2 seconds
      setTimeout(() => {
        setCopiedItems(prev => {
          const newSet = new Set(prev)
          newSet.delete(interactionId)
          return newSet
        })
        // Close tooltip if it's still open for this item (do not override if user hovered elsewhere)
        setOpenTooltipKey(prev =>
          prev === `copy:${interactionId}` ? null : prev,
        )
      }, 2000)
    } catch (error) {
      console.error('Failed to copy text:', error)
    }
  }

  const handleDeleteInteraction = async (interaction: Interaction) => {
    cleanupAudioInstance(interaction.id)
    setOpenTooltipKey(prev =>
      prev?.endsWith(`:${interaction.id}`) ? null : prev,
    )
    setExpandedInteractionIds(prev => {
      if (!prev.has(interaction.id)) {
        return prev
      }
      const next = new Set(prev)
      next.delete(interaction.id)
      return next
    })

    try {
      await window.api.interactions.delete(interaction.id)
      setCopiedItems(prev => {
        if (!prev.has(interaction.id)) {
          return prev
        }
        const next = new Set(prev)
        next.delete(interaction.id)
        return next
      })
      await loadInteractions(pageCursors.at(-1) ?? null)
    } catch (error) {
      console.error('Failed to delete interaction:', error)
    }
  }

  const handleClearAll = async () => {
    if (interactions.length === 0 || loading || isClearingAll) {
      return
    }

    const confirmed = confirm(
      'Clear all activity? This will permanently delete transcripts and audio from the server.',
    )
    if (!confirmed) {
      return
    }

    setIsClearingAll(true)
    setOpenTooltipKey(null)
    setCopiedItems(new Set())
    setExpandedInteractionIds(new Set())
    cleanupAllAudioInstances()

    try {
      const ids = await window.api.interactions.getIds()
      const failed: PromiseRejectedResult[] = []
      for (let i = 0; i < ids.length; i += 20) {
        const results = await Promise.allSettled(
          ids.slice(i, i + 20).map(id => window.api.interactions.delete(id)),
        )
        failed.push(
          ...results.filter(
            (result): result is PromiseRejectedResult =>
              result.status === 'rejected',
          ),
        )
      }
      if (failed.length)
        console.error('Failed to clear some interactions:', failed)
      setPageCursors([null])
      await loadInteractions()
    } catch (error) {
      console.error('Failed to clear interactions:', error)
      await loadInteractions()
    } finally {
      setIsClearingAll(false)
    }
  }

  const handleAudioDownload = async (interaction: Interaction) => {
    try {
      if (!interaction.has_audio) {
        console.warn('No audio data available for download')
        return
      }

      const full = await window.api.interactions.getById(interaction.id)
      if (!full?.raw_audio) return
      const pcmData = new Uint8Array(full.raw_audio)
      // Convert raw PCM to WAV format
      const wavBuffer = createStereo48kWavFromMonoPCM(
        pcmData,
        interaction.sample_rate || 16000,
        48000,
      )
      const audioBlob = new Blob([wavBuffer], { type: 'audio/wav' })
      const audioUrl = URL.createObjectURL(audioBlob)

      // Format filename with timestamp (YYYYMMDD_HHMMSS)
      const date = new Date(interaction.created_at)
      const timestamp = date
        .toISOString()
        .replace(/[-:]/g, '')
        .replace('T', '_')
        .slice(0, 15)
      const filename = `ito-recording-${timestamp}.wav`

      // Create temporary link and trigger download
      const link = document.createElement('a')
      link.href = audioUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      // Clean up the blob URL
      URL.revokeObjectURL(audioUrl)
    } catch (error) {
      console.error('Failed to download audio:', error)
    }
  }

  const handleRetranscribe = async (interaction: Interaction) => {
    if (!interaction.has_audio) {
      console.warn('No audio data available for this interaction')
      return
    }

    setRetranscribingIds(prev => new Set(prev).add(interaction.id))
    try {
      const result = await window.api.interactions.retranscribe(interaction.id)
      if (result?.error) {
        console.error('ReTranscribe failed:', result.error)
      }
    } catch (error) {
      console.error('Failed to ReTranscribe interaction:', error)
    } finally {
      setRetranscribingIds(prev => {
        const next = new Set(prev)
        next.delete(interaction.id)
        return next
      })
    }
  }

  const { setCurrentPage } = useMainStore()
  const { setAudioFromInteraction } = usePlaygroundStore()

  const handleSendToPlayground = async (interaction: Interaction) => {
    if (!interaction.has_audio) {
      console.warn('No audio data available for this interaction')
      return
    }

    try {
      const full = await window.api.interactions.getById(interaction.id)
      if (!full?.raw_audio) return
      const audioBuffer = new Uint8Array(full.raw_audio).buffer
      setAudioFromInteraction(
        interaction.id,
        audioBuffer,
        interaction.sample_rate || 16000,
      )
      setCurrentPage('playground')
    } catch (error) {
      console.error('Failed to load audio into Playground:', error)
    }
  }

  return (
    <div className="w-full h-full flex flex-col">
      {/* Fixed Header Content */}
      <div className="flex-shrink-0 px-24">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-medium">
              Welcome back{firstName ? `, ${firstName}!` : '!'}
            </h1>
          </div>
        </div>
        <div className="flex gap-4 w-full mb-6">
          <div className="flex w-full items-center text-sm text-gray-700 gap-2">
            <StatCard
              title="Weekly Streak"
              value={formatStreakText(stats.streakDays)}
              description={getActivityMessage(
                STREAK_MESSAGES,
                getStreakLevel(stats.streakDays),
              )}
              icon={
                <div className="p-2 bg-blue-50 rounded-md">
                  <ChartNoAxesColumn
                    className="w-6 h-6 text-blue-400 border-2 p-1 rounded-full"
                    strokeWidth={4}
                  />
                </div>
              }
            />
            <StatCard
              title="Average Speed"
              value={`${stats.averageWPM} words / minute`}
              description={getActivityMessage(
                SPEED_MESSAGES,
                getSpeedLevel(stats.averageWPM),
              )}
              icon={
                <div className="p-2 bg-green-50 rounded-md">
                  <SpeedIcon />
                </div>
              }
            />
            <StatCard
              title="Total Words"
              value={`${stats.totalWords} ${stats.totalWords === 1 ? 'word' : 'words'}`}
              description={getActivityMessage(
                TOTAL_WORDS_MESSAGES,
                getTotalWordsLevel(stats.totalWords),
              )}
              icon={
                <div className="p-2 bg-orange-50 rounded-md">
                  <TotalWordsIcon />
                </div>
              }
            />
          </div>
        </div>

        {/* Dictation Info Box */}
        <div className="bg-slate-100 rounded-xl p-6 flex items-center justify-between mb-10">
          <div>
            <div className="text-base font-medium mb-1">
              Voice dictation in any app
            </div>
            <div className="text-sm text-gray-600">
              <span key="hold-down">Hold down the trigger key </span>
              {keyboardShortcut.map((key, index) => (
                <React.Fragment key={index}>
                  <span className="bg-slate-50 px-1 py-0.5 rounded text-xs font-mono shadow-sm">
                    {getKeyDisplay(key as KeyName, platform, {
                      showDirectionalText: false,
                      format: 'label',
                    })}
                  </span>
                  <span>{index < keyboardShortcut.length - 1 && ' + '}</span>
                </React.Fragment>
              ))}
              <span key="and"> and speak into any textbox</span>
            </div>
          </div>
          <button
            className="bg-gray-900 text-white px-6 py-3 rounded-full font-semibold hover:bg-gray-800 cursor-pointer"
            onClick={() =>
              window.api?.invoke('web-open-url', EXTERNAL_LINKS.WEBSITE)
            }
          >
            Explore use cases
          </button>
        </div>

        {/* Recent Activity Header */}
        <div className="flex items-center justify-between text-sm text-muted-foreground mb-6">
          <span>Recent activity</span>
          <button
            type="button"
            className="text-xs text-gray-500 hover:text-red-600 disabled:opacity-50 disabled:hover:text-gray-500"
            onClick={handleClearAll}
            disabled={loading || interactions.length === 0 || isClearingAll}
          >
            {isClearingAll ? 'Clearing...' : 'Clear all'}
          </button>
        </div>
      </div>

      {/* Scrollable Recent Activity Section */}
      <div className="flex-1 px-24 overflow-y-auto scrollbar-hide">
        {loading ? (
          <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-gray-500">
            Loading recent activity...
          </div>
        ) : interactions.length === 0 ? (
          <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-gray-500">
            <p className="text-sm">No interactions yet</p>
            <p className="text-xs mt-1">
              Try using voice dictation by pressing{' '}
              {keyboardShortcut.join(' + ')}
            </p>
          </div>
        ) : (
          Object.entries(groupedInteractions).map(
            ([dateLabel, dateInteractions]) => (
              <div key={dateLabel} className="mb-6">
                <div className="text-xs text-gray-500 mb-4">{dateLabel}</div>
                <div className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-200">
                  {dateInteractions.map(interaction => {
                    const displayInfo = getDisplayText(interaction)
                    const isRetranscribing = retranscribingIds.has(
                      interaction.id,
                    )
                    const polishedTranscript =
                      interaction.llm_output?.polishedTranscript
                    const polishedText =
                      typeof polishedTranscript === 'string'
                        ? polishedTranscript
                        : ''
                    const hasPolishedText = polishedText.trim().length > 0
                    const isExpandable = !displayInfo.isError && hasPolishedText
                    const isExpanded =
                      isExpandable && expandedInteractionIds.has(interaction.id)
                    const polishedCopyKey = `polished:${interaction.id}`

                    return (
                      <div key={interaction.id}>
                        <div className="flex items-center justify-between px-4 py-4 gap-10 hover:bg-gray-50 transition-colors duration-200 group">
                          <div className="flex items-center gap-10">
                            <div className="text-gray-600 min-w-[60px]">
                              {formatTime(interaction.created_at)}
                            </div>
                            <div
                              className={`${displayInfo.isError ? 'text-gray-600' : 'text-gray-900'} flex items-center gap-1`}
                            >
                              <button
                                type="button"
                                className={`bg-transparent p-0 text-left ${isExpandable ? 'cursor-pointer hover:underline' : 'cursor-default'} disabled:opacity-100`}
                                onClick={() =>
                                  isExpandable &&
                                  toggleExpandedInteraction(interaction.id)
                                }
                                disabled={!isExpandable}
                                aria-expanded={
                                  isExpandable ? isExpanded : undefined
                                }
                              >
                                {displayInfo.text}
                              </button>
                              {displayInfo.tooltip && (
                                <Tooltip>
                                  <TooltipTrigger>
                                    <InfoCircle className="w-4 h-4 text-gray-400" />
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {displayInfo.tooltip}
                                  </TooltipContent>
                                </Tooltip>
                              )}
                              {getPolishError(interaction) && (
                                <Tooltip>
                                  <TooltipTrigger>
                                    <DangerTriangle className="w-4 h-4 text-amber-500" />
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    Polish failed:{' '}
                                    {getPolishError(interaction)?.message}
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          </div>

                          {/* Copy, Download, and Play buttons - only show on hover or when playing */}
                          <div
                            className={`flex items-center gap-2 ${playingAudio === interaction.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity duration-200`}
                          >
                            {/* Copy button */}
                            {!displayInfo.isError && (
                              <Tooltip
                                open={
                                  openTooltipKey === `copy:${interaction.id}`
                                }
                                onOpenChange={open => {
                                  if (open) {
                                    // Opening: exclusively show this tooltip
                                    setOpenTooltipKey(`copy:${interaction.id}`)
                                  } else {
                                    // Closing: if in copied state, keep it open until timer clears,
                                    // otherwise close normally
                                    if (!copiedItems.has(interaction.id)) {
                                      setOpenTooltipKey(prev =>
                                        prev === `copy:${interaction.id}`
                                          ? null
                                          : prev,
                                      )
                                    }
                                  }
                                }}
                              >
                                <TooltipTrigger asChild>
                                  <button
                                    className={`p-1.5 hover:bg-gray-200 rounded transition-colors cursor-pointer ${
                                      copiedItems.has(interaction.id)
                                        ? 'text-green-600'
                                        : 'text-gray-600'
                                    }`}
                                    onClick={() =>
                                      copyToClipboard(
                                        displayInfo.text,
                                        interaction.id,
                                      )
                                    }
                                  >
                                    {copiedItems.has(interaction.id) ? (
                                      <Check className="w-4 h-4" />
                                    ) : (
                                      <Copy className="w-4 h-4" />
                                    )}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" sideOffset={5}>
                                  {copiedItems.has(interaction.id)
                                    ? 'Copied 🎉'
                                    : 'Copy'}
                                </TooltipContent>
                              </Tooltip>
                            )}

                            {/* Download button */}
                            {interaction.has_audio && (
                              <Tooltip
                                open={
                                  openTooltipKey ===
                                  `download:${interaction.id}`
                                }
                                onOpenChange={open => {
                                  setOpenTooltipKey(
                                    open ? `download:${interaction.id}` : null,
                                  )
                                }}
                              >
                                <TooltipTrigger asChild>
                                  <button
                                    className="p-1.5 hover:bg-gray-200 rounded transition-colors cursor-pointer text-gray-600"
                                    onClick={() =>
                                      handleAudioDownload(interaction)
                                    }
                                  >
                                    <Download className="w-4 h-4" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" sideOffset={5}>
                                  Download audio
                                </TooltipContent>
                              </Tooltip>
                            )}

                            {interaction.has_audio && (
                              <Tooltip
                                open={
                                  openTooltipKey ===
                                  `retranscribe:${interaction.id}`
                                }
                                onOpenChange={open => {
                                  setOpenTooltipKey(
                                    open
                                      ? `retranscribe:${interaction.id}`
                                      : null,
                                  )
                                }}
                              >
                                <TooltipTrigger asChild>
                                  <button
                                    className="p-1.5 hover:bg-gray-200 rounded transition-colors cursor-pointer text-gray-600 disabled:opacity-50"
                                    onClick={() =>
                                      handleRetranscribe(interaction)
                                    }
                                    disabled={isRetranscribing || isClearingAll}
                                    aria-label="ReTranscribe"
                                  >
                                    <Refresh
                                      className={`w-4 h-4 ${
                                        isRetranscribing ? 'animate-spin' : ''
                                      }`}
                                    />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" sideOffset={5}>
                                  {isRetranscribing
                                    ? 'Retranscribing...'
                                    : 'ReTranscribe'}
                                </TooltipContent>
                              </Tooltip>
                            )}

                            {/* Send to Playground button */}
                            {interaction.has_audio && (
                              <Tooltip
                                open={
                                  openTooltipKey ===
                                  `playground:${interaction.id}`
                                }
                                onOpenChange={open => {
                                  setOpenTooltipKey(
                                    open
                                      ? `playground:${interaction.id}`
                                      : null,
                                  )
                                }}
                              >
                                <TooltipTrigger asChild>
                                  <button
                                    className="p-1.5 hover:bg-gray-200 rounded transition-colors cursor-pointer text-gray-600"
                                    onClick={() =>
                                      handleSendToPlayground(interaction)
                                    }
                                    disabled={isClearingAll}
                                    aria-label="Send to Playground"
                                  >
                                    <Flask className="w-4 h-4" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" sideOffset={5}>
                                  Send to Playground
                                </TooltipContent>
                              </Tooltip>
                            )}

                            {/* Play/Stop button with tooltip */}
                            <Tooltip
                              open={openTooltipKey === `play:${interaction.id}`}
                              onOpenChange={open => {
                                setOpenTooltipKey(
                                  open ? `play:${interaction.id}` : null,
                                )
                              }}
                            >
                              <TooltipTrigger asChild>
                                <button
                                  className={`p-1.5 hover:bg-gray-200 rounded transition-colors cursor-pointer ${
                                    playingAudio === interaction.id
                                      ? 'bg-blue-50 text-blue-600'
                                      : 'text-gray-600'
                                  }`}
                                  onClick={() =>
                                    handleAudioPlayStop(interaction)
                                  }
                                  aria-label={
                                    playingAudio === interaction.id
                                      ? 'Stop audio'
                                      : 'Play audio'
                                  }
                                  disabled={!interaction.has_audio}
                                >
                                  {playingAudio === interaction.id ? (
                                    <Stop className="w-4 h-4" />
                                  ) : (
                                    <Play className="w-4 h-4" />
                                  )}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top" sideOffset={5}>
                                {!interaction.has_audio
                                  ? 'No audio available'
                                  : playingAudio === interaction.id
                                    ? 'Stop'
                                    : 'Play'}
                              </TooltipContent>
                            </Tooltip>

                            <Tooltip
                              open={
                                openTooltipKey === `delete:${interaction.id}`
                              }
                              onOpenChange={open => {
                                setOpenTooltipKey(
                                  open ? `delete:${interaction.id}` : null,
                                )
                              }}
                            >
                              <TooltipTrigger asChild>
                                <button
                                  className="p-1.5 hover:bg-red-50 rounded transition-colors cursor-pointer text-gray-600 hover:text-red-600"
                                  onClick={() =>
                                    handleDeleteInteraction(interaction)
                                  }
                                  disabled={isClearingAll}
                                >
                                  <Trash className="w-4 h-4" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top" sideOffset={5}>
                                Delete
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </div>

                        {isExpanded && hasPolishedText && (
                          <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 text-sm text-gray-700">
                            <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-gray-400">
                              <span>Polished</span>
                              <Tooltip
                                open={
                                  openTooltipKey === `copy:${polishedCopyKey}`
                                }
                                onOpenChange={open => {
                                  if (open) {
                                    setOpenTooltipKey(`copy:${polishedCopyKey}`)
                                  } else {
                                    if (!copiedItems.has(polishedCopyKey)) {
                                      setOpenTooltipKey(prev =>
                                        prev === `copy:${polishedCopyKey}`
                                          ? null
                                          : prev,
                                      )
                                    }
                                  }
                                }}
                              >
                                <TooltipTrigger asChild>
                                  <button
                                    className={`p-1.5 hover:bg-gray-200 rounded transition-colors cursor-pointer ${
                                      copiedItems.has(polishedCopyKey)
                                        ? 'text-green-600'
                                        : 'text-gray-600'
                                    }`}
                                    onClick={() =>
                                      copyToClipboard(
                                        polishedText,
                                        polishedCopyKey,
                                      )
                                    }
                                  >
                                    {copiedItems.has(polishedCopyKey) ? (
                                      <Check className="w-3.5 h-3.5" />
                                    ) : (
                                      <Copy className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" sideOffset={5}>
                                  {copiedItems.has(polishedCopyKey)
                                    ? 'Copied 🎉'
                                    : 'Copy'}
                                </TooltipContent>
                              </Tooltip>
                            </div>
                            <div className="mt-1 whitespace-pre-wrap">
                              {polishedText}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ),
          )
        )}
        <div className="flex justify-between items-center py-4 text-sm">
          <button
            disabled={loading || pageCursors.length <= 1}
            className="disabled:opacity-40"
            onClick={() => {
              cleanupAllAudioInstances()
              const cursors = pageCursors.slice(0, -1)
              setPageCursors(cursors)
              void loadInteractions(cursors.at(-1) ?? null)
            }}
          >
            Newer
          </button>
          <span>Page {pageCursors.length}</span>
          <button
            disabled={loading || !nextCursor}
            className="disabled:opacity-40"
            onClick={() => {
              if (!nextCursor) return
              cleanupAllAudioInstances()
              setPageCursors([...pageCursors, nextCursor])
              void loadInteractions(nextCursor)
            }}
          >
            Older
          </button>
        </div>
      </div>
    </div>
  )
}
