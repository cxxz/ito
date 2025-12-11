// No-op analytics module for self-hosted version
// All analytics tracking is disabled

export const ANALYTICS_EVENTS = {
  // Onboarding events
  ONBOARDING_STEP_VIEWED: 'onboarding_step_viewed',
  ONBOARDING_STEP_COMPLETED: 'onboarding_step_completed',
  ONBOARDING_COMPLETED: 'onboarding_completed',

  // Recording events
  RECORDING_STARTED: 'recording_started',
  RECORDING_COMPLETED: 'recording_completed',
  MANUAL_RECORDING_STARTED: 'manual_recording_started',
  MANUAL_RECORDING_COMPLETED: 'manual_recording_completed',
  MANUAL_RECORDING_ABANDONED: 'manual_recording_abandoned',

  // Settings events
  SETTING_CHANGED: 'setting_changed',
  MICROPHONE_CHANGED: 'microphone_changed',
  KEYBOARD_SHORTCUTS_CHANGED: 'keyboard_shortcuts_changed',
} as const

// No-op analytics class
class NoOpAnalytics {
  track(_event: string, _properties?: Record<string, any>): void {
    // No-op
  }

  trackOnboarding(_event: string, _properties?: Record<string, any>): void {
    // No-op
  }

  trackSettings(_event: string, _properties?: Record<string, any>): void {
    // No-op
  }

  identifyUser(
    _userId: string,
    _properties?: Record<string, any>,
    _provider?: string,
  ): void {
    // No-op
  }

  resetUser(): void {
    // No-op
  }

  updateUserProperties(_properties: Record<string, any>): void {
    // No-op
  }
}

export const analytics = new NoOpAnalytics()

export function updateAnalyticsFromSettings(_shareAnalytics: boolean): void {
  // No-op
}
