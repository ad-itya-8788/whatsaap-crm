import { useEffect, useState } from 'react'

function initials(value) {
  return String(value || '?').trim().slice(0, 1).toUpperCase()
}

export default function ChatAvatar({ contact = null, name = '', className = '' }) {
  const [imageFailed, setImageFailed] = useState(false)
  const label = name || contact?.name || contact?.phone || '?'
  const src = contact?.avatar_url || contact?.profile_photo_url || contact?.photo_url
  const classes = `chat-avatar${className ? ` ${className}` : ''}`

  useEffect(() => setImageFailed(false), [src])

  if (src && !imageFailed) {
    return (
      <span className={classes}>
        <img className="chat-avatar-image" src={src} alt="" onError={() => setImageFailed(true)} />
      </span>
    )
  }

  return <span className={classes}>{initials(label)}</span>
}
