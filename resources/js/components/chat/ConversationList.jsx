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
  can = () => false,
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
}) {
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
          {statusTabs.filter((tab) => tab.value === 'all' || can('conversations.filter_' + tab.value)).map((tab) => (
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
          {(can('conversations.view_all') || can('conversations.view_unassigned')) && <option value="unassigned">Unassigned</option>}
          {(can('conversations.view_all') || can('conversations.view_assigned')) && <option value="me">Assigned to me</option>}
          {(can('conversations.view_all') || can('conversations.view_others')) && agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
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
            <button
              type="button"
              key={conversation.id}
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
