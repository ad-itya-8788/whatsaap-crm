import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import api from '../../api/client.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { extractPaginator } from '../../lib/utils.js'
import BrandLogo from '../common/BrandLogo.jsx'
import BrowserNotificationsListener from '../common/BrowserNotificationsListener.jsx'
import Icon from '../common/Icon.jsx'

const mainNav = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { to: '/inbox', label: 'Inbox', icon: 'inbox', unread: true },
  { to: '/notifications', label: 'Notifications', icon: 'bell', notificationUnread: true },
  { to: '/contacts', label: 'Contacts', icon: 'contacts' },
  { to: '/broadcasts', label: 'Broadcasts', icon: 'radio' },
  { to: '/automations', label: 'Automations', icon: 'bolt' },
  { to: '/flows', label: 'Flows', icon: 'workflow' },
  { to: '/agents', label: 'AI Agents', icon: 'bot' },
]

const manageNav = [
  { to: '/workspace', label: 'Tags & fields', icon: 'tag' },
  { to: '/templates', label: 'Templates', icon: 'template' },
  { to: '/reports', label: 'Reports', icon: 'chart' },
  { to: '/team', label: 'Team', icon: 'users' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
]

const pageTitles = [
  ['/dashboard', 'Dashboard'],
  ['/inbox', 'Inbox'],
  ['/notifications', 'Notifications'],
  ['/contacts', 'Contacts'],
  ['/broadcasts', 'Broadcasts'],
  ['/automations', 'Automations'],
  ['/flows', 'Flows'],
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

function useThemeMode() {
  const [mode, setMode] = useState(() => localStorage.getItem('wacrm.mode') || 'light')

  useEffect(() => {
    document.documentElement.dataset.mode = mode
    document.documentElement.dataset.theme = localStorage.getItem('wacrm.theme') || 'amber'
    localStorage.setItem('wacrm.mode', mode)
  }, [mode])

  useEffect(() => {
    const syncAppearance = (event) => {
      const nextMode = event.detail?.mode
      if (nextMode === 'light' || nextMode === 'dark') setMode(nextMode)
    }
    window.addEventListener('wacrm:theme-changed', syncAppearance)
    return () => window.removeEventListener('wacrm:theme-changed', syncAppearance)
  }, [])

  return [mode, setMode]
}

export default function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)
  const [footerMenuOpen, setFooterMenuOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [notificationUnread, setNotificationUnread] = useState(0)
  const [mode, setMode] = useThemeMode()

  const loadUnread = useCallback(async () => {
    try {
      const { data } = await api.get('/api/app/conversations', {
        params: { status: 'unread', per_page: 1 },
      })
      setUnread(extractPaginator(data).total)
    } catch {
      setUnread(0)
    }
  }, [])

  const loadNotificationUnread = useCallback(async () => {
    try {
      const { data } = await api.get('/api/app/notifications/unread-count')
      setNotificationUnread(Number(data?.count || 0))
    } catch {
      setNotificationUnread(0)
    }
  }, [])

  useEffect(() => {
    loadUnread()
    loadNotificationUnread()
    const timer = window.setInterval(() => {
      loadUnread()
      loadNotificationUnread()
    }, 60000)
    const refreshNotifications = () => loadNotificationUnread()
    window.addEventListener('wacrm:notifications-changed', refreshNotifications)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('wacrm:notifications-changed', refreshNotifications)
    }
  }, [loadUnread, loadNotificationUnread])

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
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [headerMenuOpen, footerMenuOpen])

  const onLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  const renderLink = (item) => {
    const isActive = item.to === '/dashboard'
      ? location.pathname === item.to
      : location.pathname.startsWith(item.to)

    return (
      <li key={item.to}>
        <NavLink
          to={item.to}
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
        </NavLink>
      </li>
    )
  }

  const initial = String(user?.name || user?.email || 'U').trim().charAt(0).toUpperCase()

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
          <Link to="/dashboard" aria-label="Aayojan AI CRM home">
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
          <button type="button" className="sidebar-user" onClick={() => { setFooterMenuOpen((open) => !open); setHeaderMenuOpen(false) }}>
            <span className="avatar">{initial}</span>
            <span className="sidebar-user-text">
              <span className="sidebar-user-name">{user?.name || 'Agent'}</span>
              <span className="sidebar-user-email">{user?.email || ''}</span>
            </span>
            <Icon name="more" size={16} />
          </button>
          {footerMenuOpen ? (
            <div className="account-menu">
              <div className="account-menu-head">
                <span className="account-menu-name">{user?.name || 'Agent'}</span>
                <span className="account-menu-email">{user?.email || ''}</span>
              </div>
              <div className="account-menu-divider" />
              <Link className="account-menu-item" to="/settings">
                <Icon name="settings" size={16} /> Settings
              </Link>
              <div className="account-menu-divider" />
              <button type="button" className="account-menu-action" onClick={onLogout}>
                <Icon name="logout" size={16} /> Sign out
              </button>
            </div>
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
              onClick={() => setMode((current) => (current === 'dark' ? 'light' : 'dark'))}
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
              >
                <span className="avatar">{initial}</span>
              </button>
              {headerMenuOpen ? (
                <div className="account-menu">
                  <div className="account-menu-head">
                    <span className="account-menu-name">{user?.name || 'Agent'}</span>
                    <span className="account-menu-email">{user?.email || ''}</span>
                  </div>
                  <div className="account-menu-divider" />
                  <Link className="account-menu-item" to="/settings">
                    <Icon name="settings" size={16} /> Settings
                  </Link>
                  <div className="account-menu-divider" />
                  <button type="button" className="account-menu-action" onClick={onLogout}>
                    <Icon name="logout" size={16} /> Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <BrowserNotificationsListener />
        <main className="app-content"><Outlet /></main>
      </div>
    </div>
  )
}
