import { useCallback, useEffect, useState } from 'react'
import { Link } from '@inertiajs/react'
import { usePageLocation } from '../../lib/navigation.js'
import api from '../../api/client.js'
import { useAuth } from '../../context/AuthContext.jsx'
import BrandLogo from '../common/BrandLogo.jsx'
import BrowserNotificationsListener from '../common/BrowserNotificationsListener.jsx'
import { PresenceHeartbeat } from '../common/MemberPresence.jsx'
import Icon from '../common/Icon.jsx'
import { useToast } from '../common/ToastProvider.jsx'
import { changeAppearance, useColorMode } from '../../lib/appearance.js'
import { usePoll } from '../../lib/usePoll.js'
import { errorMessage } from '../../lib/utils.js'

const mainNav = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { to: '/inbox', label: 'Inbox', icon: 'inbox', unread: true },
  { to: '/notifications', label: 'Notifications', icon: 'bell', notificationUnread: true },
  { to: '/contacts', label: 'Contacts', icon: 'contacts' },
  { to: '/broadcasts', label: 'Broadcasts', icon: 'radio' },
  { to: '/agents', label: 'AI Agents', icon: 'bot' },
]

const manageNav = [
  { to: '/settings', label: 'Settings', icon: 'settings' },
]

const pageTitles = [
  ['/dashboard', 'Dashboard'],
  ['/inbox', 'Inbox'],
  ['/notifications', 'Notifications'],
  ['/contacts', 'Contacts'],
  ['/broadcasts', 'Broadcasts'],
  ['/agents', 'AI Agents'],
  ['/workspace', 'Tags & fields'],
  ['/templates', 'Message Templates'],
  ['/reports', 'Reports'],
  ['/team', 'Team'],
  ['/settings', 'Settings'],
]

function pageTitle(pathname) {
  const exact = pageTitles.find(([path]) => path === pathname)
  if (exact) return exact[1]
  const prefix = pageTitles.find(([path]) => pathname.startsWith(path))
  return prefix ? prefix[1] : 'Dashboard'
}

function AccountAvatar({ user }) {
  const initial = String(user?.name || user?.email || 'U').trim().charAt(0).toUpperCase()
  return (
    <span className="avatar" aria-hidden="true">
      {initial}
      {user?.avatar_url && <img key={user.avatar_url} src={user.avatar_url} alt="" onError={(event) => { event.currentTarget.hidden = true }} />}
    </span>
  )
}

function AccountMenu({ user, onClose, onLogout, showIdentity = true }) {
  return (
    <div className="account-menu">
      {showIdentity && (
        <>
          <div className="account-menu-head">
            <span className="account-menu-name">{user?.name || 'Agent'}</span>
            <span className="account-menu-email">{user?.email || ''}</span>
          </div>
          <div className="account-menu-divider" />
        </>
      )}
      <Link className="account-menu-item" href="/settings?tab=profile" onClick={onClose}><Icon name="user" size={16} /> Profile</Link>
      <Link className="account-menu-item" href="/settings?tab=whatsapp" onClick={onClose}><Icon name="settings" size={16} /> Settings</Link>
      <div className="account-menu-divider" />
      <button type="button" className="account-menu-action" onClick={onLogout}><Icon name="logout" size={16} /> Sign out</button>
    </div>
  )
}

export default function AppLayout({ children }) {
  const { user, logout } = useAuth()
  const toast = useToast()
  const location = usePageLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)
  const [footerMenuOpen, setFooterMenuOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [notificationUnread, setNotificationUnread] = useState(0)
  const mode = useColorMode()

  const loadUnread = useCallback(async (signal) => {
    const { data } = await api.get('/api/app/inbox/unread-count', { signal, timeout: 10000 })
    setUnread(Number(data?.count || 0))
  }, [])

  const loadNotificationUnread = useCallback(async (signal) => {
    const { data } = await api.get('/api/app/notifications/unread-count', { signal, timeout: 10000 })
    setNotificationUnread(Number(data?.count || 0))
  }, [])

  usePoll(loadUnread, 60_000, { enabled: Boolean(user), event: 'wacrm:inbox-changed' })
  usePoll(loadNotificationUnread, 60_000, { enabled: Boolean(user), event: 'wacrm:notifications-changed' })

  useEffect(() => {
    setDrawerOpen(false)
    setHeaderMenuOpen(false)
    setFooterMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!drawerOpen) return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event) => {
      if (event.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [drawerOpen])

  useEffect(() => {
    if (!headerMenuOpen && !footerMenuOpen) return undefined
    const close = (event) => {
      if (!event.target.closest('.account-menu-wrap') && !event.target.closest('.sidebar-footer')) {
        setHeaderMenuOpen(false)
        setFooterMenuOpen(false)
      }
    }
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      setHeaderMenuOpen(false)
      setFooterMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [headerMenuOpen, footerMenuOpen])

  const onLogout = async () => {
    try {
      await logout()
    } catch (requestError) {
      toast.error(errorMessage(requestError, 'Unable to sign out.'))
    }
  }

  const renderLink = (item) => {
    const isActive = item.to === '/dashboard'
      ? location.pathname === item.to
      : location.pathname.startsWith(item.to)

    return (
      <li key={item.to}>
        <Link
          href={item.to}
          aria-current={isActive ? 'page' : undefined}
          className={`sidebar-link${isActive ? ' is-active' : ''}`}
        >
          <Icon name={item.icon} size={16} />
          <span className="sidebar-link-label">{item.label}</span>
          {item.unread && unread > 0 && !isActive ? (
            <span className="nav-dot" aria-label={`${unread} unread conversations`} />
          ) : null}
          {item.notificationUnread && notificationUnread > 0 ? (
            <span className="nav-count" aria-label={`${notificationUnread} unread notifications`}>
              {notificationUnread > 9 ? '9+' : notificationUnread}
            </span>
          ) : null}
        </Link>
      </li>
    )
  }

  return (
    <div className="app-shell">
      <button
        type="button"
        className={`sidebar-backdrop${drawerOpen ? ' is-open' : ''}`}
        aria-label="Close navigation"
        tabIndex={drawerOpen ? 0 : -1}
        onClick={() => setDrawerOpen(false)}
      />

      <aside className={`app-sidebar${drawerOpen ? ' is-open' : ''}`} aria-label="Main navigation">
        <div className="sidebar-brand">
          <Link href="/dashboard" aria-label="Aayojan AI CRM home">
            <BrandLogo className="brand-logo sidebar-logo" />
          </Link>
          <button type="button" className="sidebar-close" onClick={() => setDrawerOpen(false)} aria-label="Close navigation">
            <Icon name="close" size={20} />
          </button>
        </div>

        <nav className="sidebar-nav">
          <ul className="sidebar-section">{mainNav.map(renderLink)}</ul>
          <div className="sidebar-section-divider" />
          <ul className="sidebar-section">{manageNav.map(renderLink)}</ul>
        </nav>

        <div className="sidebar-footer">
          <button type="button" className="sidebar-user" aria-expanded={footerMenuOpen} onClick={() => { setFooterMenuOpen((open) => !open); setHeaderMenuOpen(false) }}>
            <AccountAvatar user={user} />
            <span className="sidebar-user-text">
              <span className="sidebar-user-name">{user?.name || 'Agent'}</span>
              <span className="sidebar-user-email">{user?.email || ''}</span>
            </span>
          </button>
          {footerMenuOpen ? (
            <AccountMenu user={user} onClose={() => setFooterMenuOpen(false)} onLogout={onLogout} showIdentity={false} />
          ) : null}
        </div>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <div className="topbar-start">
            <button
              type="button"
              className="topbar-menu-btn"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
            >
              <Icon name="menu" size={20} />
            </button>
            <h1 className="topbar-title">{pageTitle(location.pathname)}</h1>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="mode-toggle"
              onClick={() => changeAppearance({ mode: mode === 'dark' ? 'light' : 'dark' })}
              aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={mode === 'dark' ? 'Light mode' : 'Dark mode'}
            >
              <Icon name={mode === 'dark' ? 'sun' : 'moon'} size={18} />
            </button>
            <div className="account-menu-wrap">
              <button
                type="button"
                className="topbar-avatar"
                onClick={() => { setHeaderMenuOpen((open) => !open); setFooterMenuOpen(false) }}
                aria-label="Open account menu"
                aria-expanded={headerMenuOpen}
              >
                <AccountAvatar user={user} />
                <span className="topbar-account-name">{user?.name || 'Agent'}</span>
              </button>
              {headerMenuOpen ? (
                <AccountMenu user={user} onClose={() => setHeaderMenuOpen(false)} onLogout={onLogout} />
              ) : null}
            </div>
          </div>
        </header>
        <BrowserNotificationsListener />
        <PresenceHeartbeat userId={user?.id} />
        <main className="app-content">
          {children}
        </main>
      </div>
    </div>
  )
}
