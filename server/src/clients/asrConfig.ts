export interface TranscriptionOptions {
  fileType?: string
  asrModel?: string
  vocabulary?: string[]
  asrPrompt?: string
  noSpeechThreshold?: number
}
