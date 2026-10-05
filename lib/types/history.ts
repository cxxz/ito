import type { Interaction } from '../main/sqlite/models'

export type HistoryItem = Omit<Interaction, 'raw_audio'> & {
  has_audio: boolean
}
export type HistoryCursor = { createdAt: string; id: string }
export type HistoryPage = {
  items: HistoryItem[]
  nextCursor: HistoryCursor | null
}
export type HistoryStats = {
  streakDays: number
  totalWords: number
  weeklyWords: number
  averageWPM: number
}
