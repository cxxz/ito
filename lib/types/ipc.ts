import { ItoMode } from '@/app/generated/ito_pb'

// IPC Event Constants
export const IPC_EVENTS = {
  RECORDING_STATE_UPDATE: 'recording-state-update',
  PROCESSING_STATE_UPDATE: 'processing-state-update',
  POLISH_STATE_UPDATE: 'polish-state-update',
  EDITING_STATE_UPDATE: 'editing-state-update',
  VOLUME_UPDATE: 'volume-update',
  FORCE_DEVICE_LIST_RELOAD: 'force-device-list-reload',
  SETTINGS_UPDATE: 'settings-update',
  ONBOARDING_UPDATE: 'onboarding-update',
  USER_AUTH_UPDATE: 'user-auth-update',
} as const

// IPC Payload Types
export interface RecordingStatePayload {
  isRecording: boolean
  mode?: ItoMode
}

export interface ProcessingStatePayload {
  isProcessing: boolean
  mode?: ItoMode
}

export interface PolishStatePayload {
  isPolishing: boolean
}

export interface EditingStatePayload {
  isEditing: boolean
}

export interface VolumeUpdatePayload {
  volume: number
}

// Generic IPC Response Types
export type IpcResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; errorType?: string }

export type IpcResponse<T> = Promise<IpcResult<T>>
