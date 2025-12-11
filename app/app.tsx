import { HashRouter, Routes, Route } from 'react-router-dom'
import appIcon from '@/resources/build/icon.png'
import HomeKit from '@/app/components/home/HomeKit'
import WelcomeKit from '@/app/components/welcome/WelcomeKit'
import Pill from '@/app/components/pill/Pill'
import {
  STEP_NAMES,
  STEP_NAMES_ARRAY,
  useOnboardingStore,
} from '@/app/store/useOnboardingStore'
import { WindowContextProvider } from '@/lib/window'
import { useDeviceChangeListener } from './hooks/useDeviceChangeListener'
import { verifyStoredMicrophone } from './media/microphone'
import { useEffect } from 'react'

const MainApp = () => {
  const { onboardingCompleted, onboardingStep } = useOnboardingStore()
  useDeviceChangeListener()

  useEffect(() => {
    verifyStoredMicrophone()
  }, [])

  const onboardingSetupCompleted =
    onboardingStep >= STEP_NAMES_ARRAY.indexOf(STEP_NAMES.TRY_IT_OUT)

  const shouldEnableShortcutGlobally =
    onboardingCompleted || onboardingSetupCompleted

  // If onboarding completed, show main app
  if (onboardingCompleted) {
    window.api.send(
      'electron-store-set',
      'settings.isShortcutGloballyEnabled',
      shouldEnableShortcutGlobally,
    )
    return <HomeKit />
  }

  // Onboarding not completed, show welcome flow
  window.api.send(
    'electron-store-set',
    'settings.isShortcutGloballyEnabled',
    shouldEnableShortcutGlobally,
  )
  return <WelcomeKit />
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        {/* Route for the pill window */}
        <Route
          path="/pill"
          element={
            <>
              <Pill />
            </>
          }
        />

        {/* Default route for the main application window */}
        <Route
          path="/"
          element={
            <>
              <WindowContextProvider titlebar={{ title: 'Ito', icon: appIcon }}>
                <MainApp />
              </WindowContextProvider>
            </>
          }
        />
      </Routes>
    </HashRouter>
  )
}
