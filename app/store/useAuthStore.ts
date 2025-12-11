import { create } from 'zustand'
import { STORE_KEYS } from '../../lib/constants/store-keys'

// Simplified auth user for self-hosted mode
interface SelfHostedUser {
  id: string
  provider: string
  lastSignInAt?: string
}

interface AuthZustandStore {
  // State - always authenticated in self-hosted mode
  isAuthenticated: boolean
  user: SelfHostedUser
  isSelfHosted: boolean
  isLoading: boolean
  error: string | null

  // Actions
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  clearAuth: () => void
}

// Self-hosted user constant
const SELF_HOSTED_USER: SelfHostedUser = {
  id: 'self-hosted',
  provider: 'self-hosted',
  lastSignInAt: new Date().toISOString(),
}

// Initialize self-hosted mode on first load
const initializeSelfHosted = () => {
  if (!window.electron?.store) return

  const currentStore = window.electron.store.get(STORE_KEYS.AUTH) || {}
  if (!currentStore.isSelfHosted) {
    window.electron.store.set(STORE_KEYS.AUTH, {
      ...currentStore,
      isSelfHosted: true,
      user: SELF_HOSTED_USER,
    })
  }
}

export const useAuthStore = create<AuthZustandStore>(set => {
  // Initialize self-hosted mode
  initializeSelfHosted()

  return {
    // Always authenticated in self-hosted mode
    isAuthenticated: true,
    user: SELF_HOSTED_USER,
    isSelfHosted: true,
    isLoading: false,
    error: null,

    setLoading: (loading: boolean) => {
      set({ isLoading: loading })
    },

    setError: (error: string | null) => {
      set({ error })
    },

    clearAuth: () => {
      // In self-hosted mode, just clear local data but stay authenticated
      if (window.electron?.store) {
        window.electron.store.set(STORE_KEYS.AUTH, {
          isSelfHosted: true,
          user: SELF_HOSTED_USER,
        })
      }
      set({
        isAuthenticated: true,
        user: SELF_HOSTED_USER,
        isSelfHosted: true,
        error: null,
      })
    },
  }
})
