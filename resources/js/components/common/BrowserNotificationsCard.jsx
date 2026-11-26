import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { useToast } from './ToastProvider.jsx'
import {
  BROWSER_NOTIFY_EVENT,
  isEnabled,
  notificationsSupported,
  permission,
  requestPermission,
  setEnabled,
  showNotification,
} from '../../lib/browserNotifications.js'

export default function BrowserNotificationsCard() {
  const toast = useToast()
  const [enabled, setEnabledState] = useState(isEnabled)
  const [currentPermission, setCurrentPermission] = useState(permission)

  useEffect(() => {
    const sync = () => {
      setEnabledState(isEnabled())
      setCurrentPermission(permission())
    }
    window.addEventListener(BROWSER_NOTIFY_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(BROWSER_NOTIFY_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const toggle = async () => {
    if (enabled) {
      setEnabled(false)
      setEnabledState(false)
      toast.success('Browser notifications turned off.')
      return
    }

    const result = await requestPermission()
    setCurrentPermission(result)

    if (result !== 'granted') {
      toast.error('Browser permission is required before browser alerts can be shown.')
      return
    }

    setEnabled(true)
    setEnabledState(true)
    toast.success('Browser notifications turned on.')
  }

  const sendTest = async () => {
    const notification = await showNotification('Aayojan AI CRM', 'Browser notifications are working.', '/notifications')
    if (!notification) toast.error('Allow browser notifications first.')
    else toast.success('Test notification sent.')
  }

  return (
    <section className="card appearance-card">
      <header className="panel-header"><h2>Browser notifications</h2></header>
      <div className="appearance-body">
        {!notificationsSupported() ? (
          <div className="alert alert-info">This browser does not support browser notifications.</div>
        ) : null}
        <div className="appearance-row">
          <div>
            <h3 className="settings-section-title">Device alerts</h3>
            <p className="field-hint">Show a notification for new customer messages while the CRM is open on this device.</p>
            <p className="field-hint">Permission: {currentPermission}</p>
          </div>
          <button
            type="button"
            className={`button ${enabled ? 'button-secondary' : 'button-primary'}`}
            onClick={toggle}
            disabled={!notificationsSupported() || currentPermission === 'denied'}
          >
            <Icon name={enabled ? 'bell' : 'check'} size={14} /> {enabled ? 'Turn off' : 'Turn on'}
          </button>
        </div>
        {currentPermission === 'denied' ? (
          <div className="alert alert-error">Notifications are blocked in your browser settings. Allow this site, then reload.</div>
        ) : null}
        <button type="button" className="button button-secondary" onClick={sendTest} disabled={!enabled}>Send test</button>
      </div>
    </section>
  )
}
