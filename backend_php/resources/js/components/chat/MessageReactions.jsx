import Icon from '../common/Icon.jsx'
import { REACTION_EMOJIS } from '../../lib/whatsappPayloads.js'

export default function MessageReactions({ message, reactions = [], onReact, canReact = false, showPicker = false }) {
  const grouped = (Array.isArray(reactions) ? reactions : []).reduce((result, reaction) => {
    const emoji = String(reaction.emoji || '')
    if (!emoji) return result
    const current = result[emoji] || { emoji, count: 0, mine: false }
    current.count += 1
    if (reaction.actor_type === 'agent') current.mine = true
    result[emoji] = current
    return result
  }, {})

  const chips = Object.values(grouped)

  return (
    <div className="message-reactions">
      {chips.map((chip) => (
        <button
          type="button"
          key={chip.emoji}
          className={`message-reaction-chip${chip.mine ? ' is-mine' : ''}`}
          onClick={() => onReact?.(message, chip.emoji)}
          disabled={!canReact || !onReact}
          title={chip.mine ? 'Remove your reaction' : 'React'}
        >
          <span>{chip.emoji}</span><small>{chip.count}</small>
        </button>
      ))}
      {showPicker && canReact && onReact && (
        <div className="message-reaction-picker">
          <Icon name="emoji" size={13} />
          {REACTION_EMOJIS.map((emoji) => (
            <button type="button" key={emoji} onClick={() => onReact(message, emoji)}>{emoji}</button>
          ))}
        </div>
      )}
    </div>
  )
}
