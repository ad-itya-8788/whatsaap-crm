import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import BrandLogo from '../common/BrandLogo.jsx'
import Icon from '../common/Icon.jsx'

const baseNav = [
  { to: '/chats', label: 'Chats', icon: 'chat' },
  { to: '/contacts', label: 'Contacts', icon: 'contacts' },
  { to: '/templates', label: 'Message Templates', icon: 'template' },
  { to: '/workspace', label: 'Workspace', icon: 'tag' },
  { to: '/reports', label: 'Reports', icon: 'chart' },
]

const managerNav = [
  { to: '/team', label: 'Team', icon: 'users' },
]

export default function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const privileged = ['admin', 'owner'].includes(String(user?.role || '').toLowerCase())
  const nav = [
    ...baseNav,
    ...(privileged ? managerNav : []),
    { to: '/settings', label: 'WhatsApp Settings', icon: 'settings' },
  ]
  const onLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-shell">
      <aside className="nav-rail" aria-label="Main navigation">
        <Link className="rail-brand" to="/chats" aria-label="Aayojan AI CRM home" title="Aayojan AI CRM"><Icon name="chat" size={22} /></Link>
        <nav className="rail-links">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `rail-link${isActive ? ' is-active' : ''}`}
              aria-label={item.label}
              title={item.label}
            >
              <Icon name={item.icon} size={20} />
              <span className="rail-link-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <div className="topbar-brand"><Link to="/chats" aria-label="Aayojan AI CRM home"><BrandLogo className="topbar-logo" /></Link></div>
          <div className="topbar-user">
            <span className="topbar-name">{user?.name || user?.email || 'Agent'}</span>
            <button type="button" className="topbar-logout" onClick={onLogout} aria-label="Log out" title="Log out">
              <Icon name="logout" size={17} />
            </button>
          </div>
        </header>
        <main className="app-content"><Outlet /></main>
      </div>
    </div>
  )
}
