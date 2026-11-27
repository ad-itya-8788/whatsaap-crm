import { useEffect, useRef, useState } from 'react'
import { ListFilter } from 'lucide-react'
import Icon from '../common/Icon.jsx'
import ChatAvatar from './ChatAvatar.jsx'
import { hasWhatsApp } from './chatUtils.js'
import { relativeTime } from '../../lib/utils.js'

const statusTabs = [
  { value: 'all', label: 'All' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'expiring', label: 'Expiring' },
  { value: 'unread', label: 'Unread' },
  { value: 'open', label: 'Open' },
  { value: 'pending', label: 'Pending' },
  { value: 'closed', label: 'Closed' },
]

export default function ConversationList({
  total = 0,
  conversations = [],
  agents = [],
  selectedId,
  loading = false,
  loadingMore = false,
  hasMore = false,
  error = '',
  filters,
  onFilterChange,
  onSelect,
  onLoadMore,
  onRetry,
  canDeleteConversations = false,
  onDeleteConversation,
  onTransferConversation,
}) {
  const [openMenuId, setOpenMenuId] = useState(null)
  const [transferId, setTransferId] = useState(null)
  const searchRef = useRef(null)
  const canManage = canDeleteConversations && (onDeleteConversation || onTransferConversation)

  useEffect(() => {
    if (!openMenuId && !transferId) return undefined
    const closeOnOutsideClick = (event) => {
      if (!event.target.closest?.('.chat-item-actions')) {
        setOpenMenuId(null)
        setTransferId(null)
      }
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setOpenMenuId(null)
        setTransferId(null)
      }
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [openMenuId, transferId])

  const closeMenus = () => {
    setOpenMenuId(null)
    setTransferId(null)
  }

  useEffect(() => {
    const focusSearch = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return
      if (!searchRef.current?.getClientRects().length) return
      event.preventDefault()
      searchRef.current.focus()
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  const quickFilters = [
    { label: 'All', status: 'all', assigned: 'all' },
    { label: 'Unread', status: 'unread', assigned: 'all' },
    { label: 'Assigned', status: 'all', assigned: 'me' },
    { label: 'Closed', status: 'closed', assigned: 'all' },
  ]
  const unreadCount = filters.status === 'unread' && filters.assignee === 'all' ? total
    : filters.status === 'all' && filters.assignee === 'all' && !hasMore
      ? conversations.filter((conversation) => Number(conversation.unread_count) > 0).length
      : 0

  return (
    <section className="chat-list-panel" aria-label="Conversations">
      <header className="chat-list-head">
        <div className="chat-list-title-row">
          <h2>Conversations <span>({total})</span></h2>
          <details className="inbox-list-filters">
            <summary className="icon-button" aria-label="More conversation filters" title="More conversation filters"><ListFilter size={19} strokeWidth={1.8} aria-hidden="true" /></summary>
            <div className="inbox-filter-menu">
              <label>Status<select className="select" value={filters.status} onChange={(event) => onFilterChange('status', event.target.value)}>
                {statusTabs.map((tab) => <option key={tab.value} value={tab.value}>{tab.label}</option>)}
              </select></label>
              <label>Assignee<select className="select" value={filters.assignee} onChange={(event) => onFilterChange('assignee', event.target.value)}>
                <option value="all">All assignees</option>
                <option value="unassigned">Unassigned</option>
                <option value="me">Assigned to me</option>
                {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </select></label>
            </div>
          </details>
        </div>
        <div className="search-wrap">
          <Icon name="search" size={16} />
          <input
            className="input search-input"
            ref={searchRef}
            type="search"
            aria-label="Search conversations"
            placeholder="Search conversations…"
            value={filters.query}
            onChange={(event) => onFilterChange('query', event.target.value)}
          />
        </div>
        <div className="chat-status-tabs" role="group" aria-label="Quick conversation filters">
          {quickFilters.map((tab) => {
            const active = filters.status === tab.status && filters.assignee === tab.assigned
            return (
            <button
              type="button"
              aria-pressed={active}
              key={tab.label}
              title={tab.assigned === 'me' ? 'Assigned to me' : undefined}
              className={`chat-status-tab${active ? ' is-active' : ''}`}
              onClick={() => {
                onFilterChange('assignee', tab.assigned)
                if (filters.status !== tab.status) onFilterChange('status', tab.status)
              }}
            >
              {tab.label}
              {tab.status === 'unread' && unreadCount > 0 && <span className="unread-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
            </button>
            )
          })}
        </div>
      </header>

      {error && (
        <div className="alert alert-error alert-inline chat-list-error">
          <span>{error}</span>
          <button type="button" className="button button-sm button-secondary" onClick={onRetry}>Retry</button>
        </div>
      )}

      <div className="chat-list">
        {loading && Array.from({ length: 6 }, (_, index) => (
          <div className="chat-item chat-skeleton" key={index} aria-hidden="true">
            <span className="skeleton-avatar" />
            <span className="chat-item-main"><span className="skeleton-line" /><span className="skeleton-line short" /></span>
          </div>
        ))}
        {!loading && conversations.map((conversation) => {
          const unread = Number(conversation.unread_count || 0)
          const active = String(conversation.id) === String(selectedId)
          return (
            <div className={`chat-item-row${active ? ' is-active' : ''}`} key={conversation.id}>
              <button
                type="button"
                className={`chat-item${active ? ' is-active' : ''}`}
                aria-current={active || undefined}
                onClick={() => onSelect(conversation.id)}
              >
                <ChatAvatar contact={conversation.contact} channel={hasWhatsApp(conversation)} />
                <span className="chat-item-main">
                  <span className="chat-item-top">
                    <span className="chat-name">{conversation.contact?.name || conversation.contact?.phone || 'Unknown contact'}</span>
                    <span className="chat-time">{relativeTime(conversation.last_message_at)}</span>
                  </span>
                  <span className="chat-item-bottom">
                    <span className="chat-preview">{conversation.last_message_text || 'No messages yet'}</span>
                    {unread > 0 && <span className="unread-badge">{unread > 99 ? '99+' : unread}</span>}
                  </span>
                  <span className="chat-item-meta">
                    {conversation.contact?.phone && <span className="chat-phone">{conversation.contact.phone}</span>}
                    <span className={`conversation-status status-${String(conversation.status || 'open')}`}>{String(conversation.status || 'open')}</span>
                    {conversation.assignedAgent && <span className="chat-assignee">{conversation.assignedAgent.name}</span>}
                    {hasWhatsApp(conversation) && <span className="conn-badge" title="Linked to a WhatsApp number"><Icon name="whatsapp" size={12} /> WhatsApp</span>}
                  </span>
                </span>
              </button>
              {canManage && (
                <div className="chat-item-actions">
                  <button
                    type="button"
                    className="chat-item-menu-button"
                    aria-label={`Actions for ${conversation.contact?.name || conversation.contact?.phone || 'this contact'}`}
                    aria-expanded={String(openMenuId) === String(conversation.id)}
                    title="Conversation actions"
                    onClick={() => {
                      setTransferId(null)
                      setOpenMenuId((current) => String(current) === String(conversation.id) ? null : conversation.id)
                    }}
                  >
                    <Icon name="moreVertical" size={16} />
                  </button>
                  {String(openMenuId) === String(conversation.id) && (
                    <div className="chat-item-menu" role="menu">
                      {onTransferConversation && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => setTransferId(conversation.id)}
                        >
                          <Icon name="users" size={14} /> Transfer to
                        </button>
                      )}
                      {canDeleteConversations && onDeleteConversation && (
                        <button
                          type="button"
                          role="menuitem"
                          className="is-danger"
                          onClick={() => { closeMenus(); onDeleteConversation(conversation) }}
                        >
                          <Icon name="trash" size={14} /> Delete conversation
                        </button>
                      )}
                      {String(transferId) === String(conversation.id) && (
                        <div className="chat-item-transfer">
                          <div className="chat-item-transfer-title">Transfer to</div>
                          {agents.length === 0 && <div className="chat-item-transfer-empty">No teammates available</div>}
                          {agents.map((agent) => (
                            <button
                              type="button"
                              key={agent.id}
                              onClick={() => { closeMenus(); onTransferConversation(conversation, agent.id) }}
                            >
                              <Icon name="user" size={13} /> {agent.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {!loading && !error && !conversations.length && (
          <div className="list-placeholder"><Icon name="chat" size={22} /><span>No conversations match these filters.</span></div>
        )}
        {hasMore && (
          <button type="button" className="button button-sm button-secondary chat-load-more" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading...' : 'Load more conversations'}
          </button>
        )}
      </div>
    </section>
  )
}
