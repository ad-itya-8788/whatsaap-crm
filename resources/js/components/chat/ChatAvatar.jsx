import { useEffect, useState } from 'react'
import Icon from '../common/Icon.jsx'

function initials(value) {
  return String(value || '?').trim().split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0]).join('').toUpperCase() || '?'
}

export default function ChatAvatar({ contact = null, name = '', className = '', channel = false }) {
  const [imageFailed, setImageFailed] = useState(false)
  const label = name || contact?.name || contact?.phone || '?'
  const src = contact?.avatar_url || contact?.profile_photo_url || contact?.photo_url
  const classes = `chat-avatar${className ? ` ${className}` : ''}`

  useEffect(() => setImageFailed(false), [src])

  return (
    <span className={classes}>
      {src && !imageFailed ? <img className="chat-avatar-image" src={src} alt="" onError={() => setImageFailed(true)} /> : initials(label)}
      {channel && <span className="inbox-avatar-channel" title="WhatsApp"><Icon name="whatsapp" size={11} /></span>}
    </span>
  )
}
