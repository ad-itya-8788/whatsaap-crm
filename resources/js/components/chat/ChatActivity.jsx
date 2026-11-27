import Icon from '../common/Icon.jsx'

export default function ChatActivity({ ai = false, children }) {
  return (
    <div className="chat-activity" role="status" aria-live="polite" aria-atomic="true">
      <Icon name={ai ? 'bot' : 'chat'} size={15} />
      <span>{children}</span>
      <span className="chat-activity-dots" aria-hidden="true"><i /><i /><i /></span>
    </div>
  )
}
