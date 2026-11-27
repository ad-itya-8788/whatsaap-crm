import { Fragment, useEffect, useRef, useState } from 'react'
import Icon from '../common/Icon.jsx'
import { useToast } from '../common/ToastProvider.jsx'
import { formatDuration, formatTime, friendlyProviderMessage } from '../../lib/utils.js'
import { isIncoming, locationFromMessage, mediaItem, messageMediaType, messageText } from './chatUtils.js'
import InteractivePreview from './InteractivePreview.jsx'
import MessageReactions from './MessageReactions.jsx'

function LinkifiedText({ text }) {
  return (
    <div className="message-text">
      {String(text).split(/(https?:\/\/[^\s]+)/g).map((part, index) => (
        /^https?:\/\//.test(part)
          ? <a key={index} href={part} target="_blank" rel="noreferrer">{part}</a>
          : <Fragment key={index}>{part}</Fragment>
      ))}
    </div>
  )
}

function AudioMessage({ src, name, mediaId, onOpenMedia }) {
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [failed, setFailed] = useState(false)

  const toggle = async () => {
    const audio = audioRef.current
    if (!audio || failed) return
    if (audio.paused) {
      try { await audio.play() } catch { setFailed(true) }
    } else {
      audio.pause()
    }
  }

  const seek = (event) => {
    const audio = audioRef.current
    if (!audio || !duration) return
    const rect = event.currentTarget.getBoundingClientRect()
    audio.currentTime = Math.max(0, Math.min(duration, ((event.clientX - rect.left) / rect.width) * duration))
  }

  if (failed) {
    return (
      <div className="audio-bubble audio-bubble-error">
        <Icon name="alert" size={18} />
        <span>Audio unavailable</span>
        <a href={src} download={name || 'audio'}>Download</a>
      </div>
    )
  }

  const progress = duration ? Math.min(100, (current / duration) * 100) : 0
  const bars = Array.from({ length: 28 }, (_, index) => 18 + ((index * 37 + String(mediaId || '').length * 11) % 46))

  return (
    <div className="audio-bubble">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime || 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrent(0) }}
        onError={() => setFailed(true)}
      />
      <button type="button" className="audio-play" onClick={toggle} aria-label={playing ? 'Pause audio' : 'Play audio'} title={playing ? 'Pause audio' : 'Play audio'}>
        <Icon name={playing ? 'pause' : 'play'} size={16} />
      </button>
      <div className="audio-wave" onClick={seek} role="presentation">
        {bars.map((height, index) => (
          <span key={index} className={index / bars.length * 100 <= progress ? 'is-played' : ''} style={{ height: `${height}%` }} />
        ))}
      </div>
      <span className="audio-time">{formatDuration(current)} / {formatDuration(duration)}</span>
      <button type="button" className="icon-button audio-expand" onClick={() => onOpenMedia(mediaId)} aria-label="Open audio viewer" title="Open audio viewer"><Icon name="fit" size={15} /></button>
    </div>
  )
}

function MessageStatus({ status }) {
  const value = String(status || '').toLowerCase()
  const icons = { failed: 'alert', pending: 'clock', queued: 'clock', sending: 'clock', sent: 'check', delivered: 'checks', read: 'checks' }
  const icon = icons[value]
  if (!icon) return null
  return (
    <span className={`status-label status-${value}`} title={value.charAt(0).toUpperCase() + value.slice(1)}>
      <Icon name={icon} size={value === 'failed' ? 14 : 15} />
    </span>
  )
}

export default function MessageBubble({ message, incoming, mediaItems = [], onOpenMedia, onReply, onRetry, onReact, onDelete, reactions = [], retrying = false, grouped = false }) {
  const toast = useToast()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  const text = messageText(message)
  const mediaType = messageMediaType(message)
  const item = mediaItem(message)
  const mediaIndex = item ? mediaItems.findIndex((entry) => entry.id === item.id) : -1
  const openMedia = () => { if (mediaIndex >= 0) onOpenMedia(mediaIndex) }
  const location = message?.content_type === 'location' ? locationFromMessage(message) : null
  const interactive = message?.interactive_payload
  const quote = message?.replyTo || message?.reply_to
  const failed = String(message?.status || '').toLowerCase() === 'failed'
  const errorTitle = String(message?.error_title || '').trim()
  const errorDetails = String(message?.error_details || '').trim()
  const technicalDetails = [
    errorTitle,
    errorDetails && errorDetails !== errorTitle && errorDetails,
    message?.error_code && `Error code: ${message.error_code}`,
  ].filter(Boolean).join('\n')
  const hasFailureReason = failed && (errorTitle || errorDetails || message?.error_code)

  useEffect(() => {
    if (!menuOpen) return undefined
    const close = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false)
    }
    const onKey = (event) => { if (event.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const copy = async () => {
    setMenuOpen(false)
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Message copied.')
    } catch {
      toast.error('Copy failed. Your browser blocked clipboard access.')
    }
  }

  const copyLocation = async () => {
    setMenuOpen(false)
    try {
      await navigator.clipboard.writeText(`${location.lat}, ${location.lng}`)
      toast.success('Coordinates copied.')
    } catch {
      toast.error('Copy failed. Your browser blocked clipboard access.')
    }
  }

  const canRetry = failed && !incoming && Boolean(onRetry) && message?.content_type !== 'template'

  return (
    <div className={`message${incoming ? ' in' : ' out'}${failed ? ' is-failed' : ''}${grouped ? ' is-grouped' : ''}`}>
      {quote && (
        <div className="message-quote">
          <strong>{quote.sender_type === 'agent' ? 'You' : 'Contact'}</strong>
          <span>{messageText(quote) || quote.filename || 'Attachment'}</span>
        </div>
      )}
      {item && mediaType === 'image' && (
        <button type="button" className="message-media-button" onClick={openMedia} aria-label="Open image">
          <img className={`message-media message-image${message?.content_type === 'sticker' ? ' is-sticker' : ''}`} src={item.src} alt={item.name} loading="lazy" onError={openMedia} />
        </button>
      )}
      {item && mediaType === 'video' && (
        <div className="message-video">
          <video className="message-media" src={item.src} controls preload="metadata" />
          <button type="button" className="message-media-open" onClick={openMedia}>Open in viewer</button>
        </div>
      )}
      {item && mediaType === 'audio' && <AudioMessage src={item.src} name={item.name} mediaId={item.id} onOpenMedia={onOpenMedia} />}
      {item && mediaType === 'document' && (
        <div className="message-file">
          <Icon name="file" size={20} />
          <div className="message-file-info">
            <span>{item.name}</span>
            <small>{String(item.mime || 'Document').split('/').pop()}</small>
          </div>
          <button type="button" className="icon-button" onClick={openMedia} aria-label="Open document" title="Open document"><Icon name="eye" size={16} /></button>
          <a className="icon-button" href={item.src} download={item.name} aria-label="Download document" title="Download document"><Icon name="download" size={16} /></a>
        </div>
      )}
      {message?.content_type === 'reaction' && <div className="message-reaction"><span>{text}</span><small>Reaction</small></div>}
      {location && (
        <div className="message-location">
          <Icon name="pin" size={18} />
          <div><strong>{location.name || 'Location'}</strong><span>{location.address || `${location.lat}, ${location.lng}`}</span></div>
          <button type="button" className="icon-button" onClick={copyLocation} aria-label="Copy coordinates" title="Copy coordinates"><Icon name="copy" size={15} /></button>
        </div>
      )}
      {message?.template_name && <div className="message-template-badge">Template · {message.template_name}</div>}
      {message?.interactive_reply_id && <div className="message-button-reply"><Icon name="reply" size={12} /> Button reply · {message.interactive_reply_id}</div>}
      {interactive ? <InteractivePreview payload={interactive} /> : null}
      {text && message?.content_type !== 'reaction' && !location && !interactive && <LinkifiedText text={text} />}
      {reactions.length > 0 && <MessageReactions message={message} reactions={reactions} onReact={onReact} canReact={Boolean(onReact)} />}
      {hasFailureReason && (
        <div className="message-error-reason" title={technicalDetails}>
          <Icon name="alert" size={14} />
          <div>
            <strong>{friendlyProviderMessage(message?.error_code, errorTitle) || 'Message could not be delivered.'}</strong>
            {message?.error_code && <small>Error code: {message.error_code}</small>}
          </div>
        </div>
      )}
      <div className="message-meta">
        {!incoming && message?.ai_generated && <span title="Generated by the AI assistant">AI</span>}
        <span>{formatTime(message?.provider_timestamp || message?.created_at)}</span>
        {!incoming && <MessageStatus status={message?.status} />}
        {canRetry && (
          <button type="button" className="message-retry" onClick={() => onRetry(message)} disabled={retrying}>
            {retrying ? 'Retrying...' : 'Retry'}
          </button>
        )}
        <div className="message-action-wrap" ref={menuRef}>
          <button type="button" className="message-action" onClick={() => setMenuOpen((value) => !value)} aria-label="Message actions" title="Message actions" aria-expanded={menuOpen}>
            <Icon name="more" size={15} />
          </button>
          {menuOpen && (
            <div className="message-action-menu">
              {onReact && <MessageReactions message={message} canReact showPicker onReact={(target, emoji) => {
                setMenuOpen(false)
                onReact(target, emoji)
              }} />}
              {text && <button type="button" onClick={copy}><Icon name="copy" size={14} /> Copy text</button>}
              {onReply && <button type="button" onClick={() => { setMenuOpen(false); onReply(message) }}><Icon name="reply" size={14} /> Reply</button>}
              {item && <button type="button" onClick={() => { setMenuOpen(false); openMedia() }}><Icon name="eye" size={14} /> Open attachment</button>}
              {item && <a href={item.src} download={item.name}><Icon name="download" size={14} /> Download</a>}
              {onDelete && <button type="button" onClick={() => { setMenuOpen(false); onDelete(message) }}><Icon name="trash" size={14} /> Delete from CRM</button>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
