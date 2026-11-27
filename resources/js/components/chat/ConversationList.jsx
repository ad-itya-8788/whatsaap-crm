import { useEffect, useState } from 'react'
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

  return (
    <section className="chat-list-panel" aria-label="Conversations">
      <header className="chat-list-head">
        <div className="chat-list-title-row">
          <h1>Chats</h1>
          <span className="chat-list-count">{conversations.length}</span>
        </div>
        <div className="search-wrap">
          <Icon name="search" size={16} />
          <input
            className="input search-input"
            type="search"
            aria-label="Search conversations"
            placeholder="Search name, phone or message..."
            value={filters.query}
            onChange={(event) => onFilterChange('query', event.target.value)}
          />
        </div>
        <div className="chat-status-tabs" role="tablist" aria-label="Conversation status">
          {statusTabs.map((tab) => (
            <button
              type="button"
              role="tab"
              aria-selected={filters.status === tab.value}
              key={tab.value}
              className={`chat-status-tab${filters.status === tab.value ? ' is-active' : ''}`}
              onClick={() => onFilterChange('status', tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <select
          className="select select-sm"
          aria-label="Filter by assignee"
          value={filters.assignee}
          onChange={(event) => onFilterChange('assignee', event.target.value)}
        >
          <option value="all">All assignees</option>
          <option value="unassigned">Unassigned</option>
          <option value="me">Assigned to me</option>
          {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
        </select>
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
            <div className="chat-item-row" key={conversation.id}>
              <button
                type="button"
                className={`chat-item${active ? ' is-active' : ''}`}
                onClick={() => onSelect(conversation.id)}
              >
                <ChatAvatar contact={conversation.contact} />
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
                    <Icon name="more" size={16} />
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
