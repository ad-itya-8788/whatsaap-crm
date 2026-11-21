import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import Icon from '../common/Icon.jsx'

const nav = [
  { to: '/chats', label: 'Chats', icon: 'chat' },
  { to: '/contacts', label: 'Contacts', icon: 'contacts' },
  { to: '/templates', label: 'Message Templates', icon: 'template' },
  { to: '/settings', label: 'WhatsApp Settings', icon: 'settings' },
]

export default function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const onLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-shell">
      <aside className="nav-rail" aria-label="Main navigation">
        <div className="rail-brand"><Icon name="chat" size={22} /></div>
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
          <span className="topbar-brand">WhatsApp CRM</span>
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
