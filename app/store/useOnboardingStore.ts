import { create } from 'zustand'
import { STORE_KEYS } from '../../lib/constants/store-keys'

// Onboarding category constants (simplified for self-hosted)
export const ONBOARDING_CATEGORIES = {
  PERMISSIONS: 'permissions',
  SET_UP: 'set-up',
  TRY_IT: 'try-it',
} as const

// Export the type so it can be used in other files
export type OnboardingCategory =
  (typeof ONBOARDING_CATEGORIES)[keyof typeof ONBOARDING_CATEGORIES]

interface OnboardingState {
  onboardingStep: number
  totalOnboardingSteps: number
  onboardingCompleted: boolean
  onboardingCategory: OnboardingCategory
  incrementOnboardingStep: () => void
  decrementOnboardingStep: () => void
  setOnboardingCompleted: () => void
  resetOnboarding: () => void
  initializeOnboarding: () => void
}

// Step name constants (simplified - no auth steps)
export const STEP_NAMES = {
  DATA_CONTROL: 'data_control',
  PERMISSIONS: 'permissions',
  MICROPHONE_TEST: 'microphone_test',
  KEYBOARD_TEST: 'keyboard_test',
  GOOD_TO_GO: 'good_to_go',
  INTRODUCING_INTELLIGENT_MODE: 'introducing_intelligent_mode',
  ANY_APP: 'any_app',
  TRY_IT_OUT: 'try_it_out',
}

// Order here matters for onboarding flow (no auth steps)
export const STEP_NAMES_ARRAY = [
  STEP_NAMES.DATA_CONTROL,
  STEP_NAMES.PERMISSIONS,
  STEP_NAMES.MICROPHONE_TEST,
  STEP_NAMES.KEYBOARD_TEST,
  STEP_NAMES.GOOD_TO_GO,
  STEP_NAMES.INTRODUCING_INTELLIGENT_MODE,
  STEP_NAMES.ANY_APP,
  STEP_NAMES.TRY_IT_OUT,
]

const getOnboardingCategory = (onboardingStep: number): OnboardingCategory => {
  if (onboardingStep < 1) return ONBOARDING_CATEGORIES.PERMISSIONS
  if (onboardingStep < 5) return ONBOARDING_CATEGORIES.SET_UP
  return ONBOARDING_CATEGORIES.TRY_IT
}

export const getOnboardingCategoryIndex = (
  onboardingCategory: OnboardingCategory,
): number => {
  if (onboardingCategory === ONBOARDING_CATEGORIES.PERMISSIONS) return 0
  if (onboardingCategory === ONBOARDING_CATEGORIES.SET_UP) return 1
  return 2
}

// Initialize from electron store
const getInitialState = () => {
  const storedOnboarding = window.electron.store.get(STORE_KEYS.ONBOARDING)

  return {
    onboardingStep: storedOnboarding?.onboardingStep ?? 0,
    onboardingCompleted: storedOnboarding?.onboardingCompleted ?? false,
  }
}

// Sync to electron store
const syncToStore = (state: Partial<OnboardingState>) => {
  if ('onboardingStep' in state || 'onboardingCompleted' in state) {
    const currentStore = window.electron.store.get(STORE_KEYS.ONBOARDING) || {}
    window.electron.store.set(STORE_KEYS.ONBOARDING, {
      ...currentStore,
      onboardingStep: state.onboardingStep ?? currentStore.onboardingStep,
      onboardingCompleted:
        state.onboardingCompleted ?? currentStore.onboardingCompleted,
    })

    window.api.notifyOnboardingUpdate(state)
  }
}

export const useOnboardingStore = create<OnboardingState>(set => {
  const initialState = getInitialState()
  const totalOnboardingSteps = STEP_NAMES_ARRAY.length

  return {
    onboardingStep: initialState.onboardingStep,
    totalOnboardingSteps,
    onboardingCompleted: initialState.onboardingCompleted,
    onboardingCategory: getOnboardingCategory(initialState.onboardingStep),
    incrementOnboardingStep: () =>
      set(state => {
        const onboardingStep = Math.min(
          state.onboardingStep + 1,
          state.totalOnboardingSteps,
        )
        const onboardingCategory = getOnboardingCategory(onboardingStep)
        const newState = {
          onboardingStep,
          onboardingCategory,
        }

        syncToStore(newState)
        return newState
      }),
    decrementOnboardingStep: () =>
      set(state => {
        const onboardingStep = Math.max(state.onboardingStep - 1, 0)
        const onboardingCategory = getOnboardingCategory(onboardingStep)
        const newState = {
          onboardingStep,
          onboardingCategory,
        }

        syncToStore(newState)
        return newState
      }),
    setOnboardingCompleted: () =>
      set(() => {
        const newState = { onboardingCompleted: true }
        syncToStore(newState)
        return newState
      }),
    resetOnboarding: () =>
      set(() => {
        const newState = { onboardingStep: 0, onboardingCompleted: false }
        syncToStore(newState)
        return newState
      }),
    initializeOnboarding: () => {
      // No-op in self-hosted mode (no analytics)
    },
  }
})
