import { useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

export default function PwaStatus() {
  const [registrationError, setRegistrationError] = useState(false)

  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error('Neera offline registration failed:', error)
      setRegistrationError(true)
    },
  })

  async function applyUpdate() {
    // Draft saving can fail, so ask the teacher to confirm their work
    // before reloading the app to activate a new version.
    const ready = window.confirm(
      'Confirm your attendance has saved successfully before updating. ' +
      'Reload Neera now?',
    )

    if (!ready) return

    try {
      await updateServiceWorker(true)
    } catch (error) {
      console.error('Neera update failed:', error)
      setRegistrationError(true)
    }
  }

  function dismiss() {
    setOfflineReady(false)
    setNeedRefresh(false)
    setRegistrationError(false)
  }

  if (!offlineReady && !needRefresh && !registrationError) {
    return null
  }

  return (
    <aside className="pwa-notice" aria-label="Neera app status">
      <p role="status">
        {registrationError
          ? 'Offline setup or updating failed. Reconnect and reload to retry.'
          : needRefresh
            ? 'A new version of Neera is available.'
            : 'Neera is ready to reopen offline in this browser.'}
      </p>

      <div className="action-buttons">
        {needRefresh && (
          <button className="primary-button" onClick={applyUpdate}>
            Update Neera
          </button>
        )}

        <button className="secondary-button" onClick={dismiss}>
          {needRefresh ? 'Later' : 'Close'}
        </button>
      </div>
    </aside>
  )
}