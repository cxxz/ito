import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/app/components/ui/button'
import type { ServerConnectionSettings } from '@/lib/types/serverConnection'

export default function ServerSettingsContent() {
  const [settings, setSettings] = useState<ServerConnectionSettings | null>(
    null,
  )
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<'save' | 'test' | 'reset' | null>(null)
  const [message, setMessage] = useState<{
    text: string
    error: boolean
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.serverConnection
      .get()
      .then(result => {
        if (cancelled) return
        setSettings(result)
        setBaseUrl(result.baseUrl)
      })
      .catch(() => {
        if (!cancelled)
          setMessage({
            text: 'Could not load server settings. Reopen this tab to try again.',
            error: true,
          })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const busy = loading || pending !== null
  const sameServer =
    baseUrl.trim().replace(/\/+$/, '') === settings?.baseUrl.replace(/\/+$/, '')
  const canKeepKey = sameServer && Boolean(settings?.hasApiKey)
  const canSubmit =
    !busy && Boolean(baseUrl.trim()) && (Boolean(apiKey.trim()) || canKeepKey)

  const applySettings = (next: ServerConnectionSettings) => {
    setSettings(next)
    setBaseUrl(next.baseUrl)
    setApiKey('')
    setShowKey(false)
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return
    setPending('save')
    setMessage(null)
    try {
      const result = await window.api.serverConnection.save({ baseUrl, apiKey })
      if (result.success) {
        applySettings(result.data)
        setMessage({
          text: 'Server settings saved. New requests will use this connection.',
          error: false,
        })
      } else setMessage({ text: result.error, error: true })
    } catch {
      setMessage({
        text: 'Could not save server settings. Please try again.',
        error: true,
      })
    } finally {
      setPending(null)
    }
  }

  const testConnection = async () => {
    setPending('test')
    setMessage(null)
    try {
      const result = await window.api.serverConnection.test({ baseUrl, apiKey })
      setMessage({
        text: result.success
          ? 'Connected successfully. The API key was accepted.'
          : result.error,
        error: !result.success,
      })
    } catch {
      setMessage({
        text: 'Could not test the connection. Please try again.',
        error: true,
      })
    } finally {
      setPending(null)
    }
  }

  const reset = async () => {
    setPending('reset')
    setMessage(null)
    try {
      const result = await window.api.serverConnection.reset()
      if (result.success) {
        applySettings(result.data)
        setMessage({
          text:
            result.data.baseUrl && result.data.hasApiKey
              ? 'Default connection restored.'
              : 'Defaults restored. Enter a server URL and API key to connect.',
          error: false,
        })
      } else setMessage({ text: result.error, error: true })
    } catch {
      setMessage({
        text: 'Could not restore defaults. Please try again.',
        error: true,
      })
    } finally {
      setPending(null)
    }
  }

  return (
    <form
      onSubmit={save}
      className="mx-auto max-w-xl space-y-6"
      aria-busy={busy}
    >
      <div>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-medium">Server connection</h2>
          {settings && (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
              {settings.usingDefaults
                ? 'Default connection'
                : 'Saved on this device'}
            </span>
          )}
        </div>
        <p className="mt-2 text-sm text-gray-600">
          Choose the Ito server used for dictation. Notes, dictionary, and
          history sync with this server.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="ito-server-url" className="block text-sm font-medium">
          Server URL
        </label>
        <input
          id="ito-server-url"
          type="url"
          value={baseUrl}
          onChange={event => {
            setBaseUrl(event.target.value)
            setMessage(null)
          }}
          placeholder="https://ito.example.com"
          autoComplete="off"
          spellCheck={false}
          required
          disabled={busy}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
          aria-describedby="ito-server-url-hint"
        />
        <p id="ito-server-url-hint" className="text-xs text-gray-600">
          Include http:// or https:// and a port if your server needs one.
        </p>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="ito-server-api-key"
          className="block text-sm font-medium"
        >
          API key
        </label>
        <div className="flex gap-2">
          <input
            id="ito-server-api-key"
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={event => {
              setApiKey(event.target.value)
              setMessage(null)
            }}
            placeholder={
              canKeepKey ? 'API key configured' : 'Enter your server API key'
            }
            autoComplete="new-password"
            spellCheck={false}
            required={!canKeepKey}
            disabled={busy}
            className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
            aria-describedby="ito-server-key-hint"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowKey(!showKey)}
            disabled={busy || !apiKey}
            aria-label={showKey ? 'Hide API key' : 'Show API key'}
          >
            {showKey ? 'Hide' : 'Show'}
          </Button>
        </div>
        <p id="ito-server-key-hint" className="text-xs text-gray-600">
          {canKeepKey
            ? 'Leave blank to keep the current key, or enter a replacement.'
            : 'Enter the API key configured on this server.'}{' '}
          Saved keys are encrypted on this device.
        </p>
      </div>

      {message && (
        <div
          role={message.error ? 'alert' : 'status'}
          className={`rounded-lg border px-3 py-2 text-sm ${message.error ? 'border-red-200 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-800'}`}
        >
          {message.text}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!canSubmit}>
          {pending === 'save' ? 'Saving…' : 'Save connection'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!canSubmit}
          onClick={testConnection}
        >
          {pending === 'test' ? 'Testing…' : 'Test connection'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy || !settings || settings.usingDefaults}
          onClick={reset}
        >
          {pending === 'reset' ? 'Restoring…' : 'Use defaults'}
        </Button>
      </div>
      <p className="text-xs text-gray-500">
        {loading
          ? 'Loading server settings…'
          : 'Changes apply without restarting Ito. Finish any active dictation before saving.'}
      </p>
    </form>
  )
}
