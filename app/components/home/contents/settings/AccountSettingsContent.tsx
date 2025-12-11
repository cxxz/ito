import { useState } from 'react'
import { useNotesStore } from '../../../../store/useNotesStore'
import { useDictionaryStore } from '../../../../store/useDictionaryStore'
import { useOnboardingStore } from '../../../../store/useOnboardingStore'
import { Button } from '../../../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../ui/dialog'
import { useAuthStore } from '@/app/store/useAuthStore'

export default function AccountSettingsContent() {
  const { clearAuth } = useAuthStore()
  const { loadNotes } = useNotesStore()
  const { loadEntries } = useDictionaryStore()
  const { resetOnboarding } = useOnboardingStore()

  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const handleDeleteLocalData = async () => {
    try {
      // Delete user data from local database
      await window.api.deleteUserData()

      // Clear KV-backed app state
      window.electron.store.set('settings', {})
      window.electron.store.set('main', {})
      window.electron.store.set('onboarding', {})

      // Clear auth state
      clearAuth()

      // Reset all stores to their initial state
      resetOnboarding()
      loadNotes()
      loadEntries()

      // Close the dialog
      setShowDeleteDialog(false)

      // Note: The app will automatically navigate to onboarding
    } catch (error) {
      console.error('Failed to delete local data:', error)
      // Still proceed with local cleanup even if deletion fails
      // Clear KV-backed app state
      window.electron.store.set('settings', {})
      window.electron.store.set('main', {})
      window.electron.store.set('onboarding', {})

      // Clear auth state
      clearAuth()

      // Reset all stores to their initial state
      resetOnboarding()
      loadNotes()
      loadEntries()

      // Close the dialog
      setShowDeleteDialog(false)
    }
  }

  return (
    <div className="h-full justify-between">
      <div className="space-y-6">
        {/* Self-hosted mode indicator */}
        <div className="flex items-center justify-between py-3">
          <label className="text-sm font-medium text-gray-900">Mode</label>
          <div className="w-80 text-sm text-gray-600 px-4 flex items-center gap-2">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
              Self-Hosted
            </span>
          </div>
        </div>

        {/* Info text */}
        <div className="text-sm text-gray-500 text-center pt-4">
          Running in self-hosted mode. All data is stored locally.
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex pt-12 w-full justify-center">
        <Button
          variant="ghost"
          size="lg"
          onClick={() => setShowDeleteDialog(true)}
          className="px-6 py-3 text-red-400 hover:text-red-200"
        >
          Delete all local data
        </Button>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-600">
              Delete All Local Data
            </DialogTitle>
            <DialogDescription className="text-gray-600">
              Are you absolutely sure you want to delete all your local data?
              This action cannot be undone and will permanently remove:
              <br />
              <br />
              • All saved notes
              <br />
              • All dictionary entries
              <br />
              • All app settings and preferences
              <br />
              • All interaction history
              <br />
              <br />
              This will reset Ito to its initial state.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-3">
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteLocalData}>
              Yes, delete everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
