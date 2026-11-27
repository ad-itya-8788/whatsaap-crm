import { useEffect, useRef, useState } from 'react'
import Recorder from 'opus-recorder'
import encoderPath from 'opus-recorder/dist/encoderWorker.min.js?url'
import api from '../../api/client.js'
import Icon from '../common/Icon.jsx'
import { useToast } from '../common/ToastProvider.jsx'
import { errorMessage } from '../../lib/utils.js'
import { fileSize, fileType } from './chatUtils.js'
import TemplatePicker from './TemplatePicker.jsx'
import InteractiveBuilder from './InteractiveBuilder.jsx'
import ChatActivity from './ChatActivity.jsx'

const ACCEPT = 'image/jpeg,image/png,video/mp4,video/3gpp,audio/aac,audio/amr,audio/mpeg,audio/mp4,audio/ogg,audio/opus,application/pdf,text/plain,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation'
const LIMITS = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
}
const ALLOWED = {
  image: ['image/jpeg', 'image/png'],
  video: ['video/mp4', 'video/3gpp'],
  audio: ['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/opus'],
  document: [
    'application/pdf', 'text/plain', 'text/csv', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
}
const EMOJIS = ['😀', '😂', '😍', '👍', '🙏', '🎉', '✅', '👋', '❤️', '🔥', '😊', '🤝', '📌', '⏰', '📎', '🙂']
const ACCEPT_BY_KIND = {
  gallery: 'image/jpeg,image/png',
  camera: 'image/jpeg,image/png',
  video: 'video/mp4,video/3gpp',
  audio: 'audio/aac,audio/amr,audio/mpeg,audio/mp4,audio/ogg,audio/opus',
  document: 'application/pdf,text/plain,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation',
}
const ATTACHMENT_OPTIONS = [
  { label: 'Photos', icon: 'image', kind: 'gallery', tone: 'photo' },
  { label: 'Camera', icon: 'camera', kind: 'camera', tone: 'camera' },
  { label: 'Videos', icon: 'video', kind: 'video', tone: 'video' },
  { label: 'Audio', icon: 'audio', kind: 'audio', tone: 'audio' },
  { label: 'Documents', icon: 'document', kind: 'document', tone: 'document' },
  { label: 'Voice note', icon: 'mic', kind: 'voice', tone: 'voice' },
  { label: 'Interactive', icon: 'chat', kind: 'interactive', tone: 'interactive' },
  { label: 'Templates', icon: 'template', kind: 'template', tone: 'template' },
  { label: 'Quick replies', icon: 'bolt', kind: 'replies', tone: 'replies' },
]

export default function ChatComposer(props) {
  const [savedReplies, setSavedReplies] = useState([])
  const quickReplies = [...new Map([
    ...(props.quickReplies || []),
    ...savedReplies,
  ].map((reply) => [reply.id, reply])).values()]

  return (
    <ConversationComposer
      key={props.conversationId}
      {...props}
      quickReplies={quickReplies}
      onQuickReplySaved={(reply) => setSavedReplies((current) => [...current, reply])}
    />
  )
}

function ConversationComposer({
  draft,
  onDraftChange,
  onTyping,
  onSend,
  sending = false,
  file = null,
  onFileSelect,
  onFileRemove,
  uploadProgress = 0,
  quickReplies = [],
  conversationId = null,
  windowOpen = true,
  readOnly = false,
  onSendInteractive,
  onSendTemplate,
  onQuickReplySaved,
}) {
  const toast = useToast()
  const fileInputRef = useRef(null)
  const composerRef = useRef(null)
  const popoverRef = useRef(null)
  const recorderRef = useRef(null)
  const timerRef = useRef(null)
  const draftRequest = useRef(null)
  const [preview, setPreview] = useState('')
  const [openMenu, setOpenMenu] = useState('')
  const [recording, setRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [localError, setLocalError] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [dialog, setDialog] = useState(null)
  useEffect(() => () => draftRequest.current?.abort(), [])
  const [savingReply, setSavingReply] = useState(false)

  useEffect(() => {
    if (!file) {
      setPreview('')
      return undefined
    }
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file)
      setPreview(url)
      return () => URL.revokeObjectURL(url)
    }
    setPreview('')
    return undefined
  }, [file])

  useEffect(() => {
    const input = composerRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`
  }, [draft])

  useEffect(() => {
    if (!openMenu) return undefined
    const close = (event) => {
      if (!popoverRef.current?.contains(event.target)) setOpenMenu('')
    }
    const onKey = (event) => { if (event.key === 'Escape') setOpenMenu('') }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [openMenu])

  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current)
    const recorder = recorderRef.current
    if (!recorder) return
    recorder.ondataavailable = null
    recorder.onstop = null
    if (recorder.state === 'recording' || recorder.state === 'paused') recorder.stop()
  }, [])

  const validateFile = (selected) => {
    const type = fileType(selected)
    const mime = String(selected.type || '').toLowerCase().split(';')[0].trim()
    if (!ALLOWED[type].includes(mime)) {
      setLocalError(`This ${type} format is not accepted by WhatsApp. Use a supported file type.`)
      return false
    }
    if (selected.size > LIMITS[type]) {
      setLocalError(`${type === 'document' ? 'Documents' : 'Files'} must be ${fileSize(LIMITS[type])} or smaller.`)
      return false
    }
    setLocalError('')
    return true
  }

  const chooseFile = (selected) => {
    if (!selected || !validateFile(selected)) return
    onFileSelect(selected)
    setOpenMenu('')
  }

  const openFilePicker = (kind) => {
    const input = fileInputRef.current
    if (!input) return
    input.accept = ACCEPT_BY_KIND[kind] || ACCEPT
    if (kind === 'camera') input.setAttribute('capture', 'environment')
    else input.removeAttribute('capture')
    setOpenMenu('')
    input.click()
  }

  const startRecording = async () => {
    if (!Recorder.isRecordingSupported()) {
      toast.error('Audio recording is not supported by this browser. You can attach an audio file instead.')
      return
    }
    try {
      const recorder = new Recorder({
        encoderPath,
        encoderApplication: 2048,
        encoderBitRate: 64000,
        encoderSampleRate: 48000,
        numberOfChannels: 1,
        mediaTrackConstraints: { echoCancellation: true, noiseSuppression: true },
      })
      recorder.ondataavailable = (data) => {
        const blob = new Blob([data], { type: 'audio/ogg;codecs=opus' })
        const voiceNote = new File([blob], 'voice-note.ogg', { type: 'audio/ogg;codecs=opus' })
        recorderRef.current = null
        setRecording(false)
        if (blob.size > 0) chooseFile(voiceNote)
        else toast.error('The recording was empty. Please try again.')
      }
      recorder.onstop = () => {
        if (timerRef.current) window.clearInterval(timerRef.current)
        setRecording(false)
      }
      recorderRef.current = recorder
      await recorder.start()
      setRecordSeconds(0)
      setRecording(true)
      timerRef.current = window.setInterval(() => setRecordSeconds((value) => value + 1), 1000)
    } catch {
      recorderRef.current = null
      toast.error('Microphone access was denied or unavailable.')
    }
  }

  const stopRecording = () => {
    const recorder = recorderRef.current
    if (!recorder) return
    if (timerRef.current) window.clearInterval(timerRef.current)
    setRecording(false)
    try {
      recorder.stop()
    } catch {
      recorderRef.current = null
      toast.error('Could not finish the recording. Please try again.')
    }
  }

  const openAttachmentOption = (kind) => {
    if (kind === 'voice') {
      setOpenMenu('')
      if (recording) stopRecording()
      else startRecording()
      return
    }
    if (kind === 'interactive' && onSendInteractive) {
      setOpenMenu('')
      setDialog({ type: 'interactive' })
      return
    }
    if (kind === 'template' && onSendTemplate) {
      setOpenMenu('')
      setDialog({ type: 'template' })
      return
    }
    if (kind === 'replies') {
      setOpenMenu('replies')
      return
    }
    openFilePicker(kind)
  }

  const insertEmoji = (emoji) => {
    onDraftChange(`${draft}${emoji}`)
    setOpenMenu('')
    composerRef.current?.focus()
  }

  const insertReply = (reply) => {
    setOpenMenu('')
    if (reply.kind === 'interactive' && reply.interactive_payload) {
      setDialog({ type: 'interactive', payload: reply.interactive_payload })
      return
    }
    const body = String(reply.body || '')
    onDraftChange(draft ? `${draft}\n${body}` : body)
    composerRef.current?.focus()
  }

  const saveInteractiveReply = async (payload) => {
    if (savingReply) return
    const title = window.prompt('Name this quick reply')?.trim()
    if (!title) return
    setSavingReply(true)
    try {
      const { data } = await api.post('/api/app/quick-replies', {
        title,
        kind: 'interactive',
        interactive_payload: payload,
      })
      onQuickReplySaved(data)
      toast.success('Quick reply saved.')
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to save quick reply.'))
    } finally {
      setSavingReply(false)
    }
  }

  const draftWithAi = async () => {
    if (!conversationId || draftRequest.current) return
    const controller = new AbortController()
    draftRequest.current = controller
    setDrafting(true)
    try {
      const { data } = await api.post('/api/app/ai/draft', { conversation_id: conversationId }, { signal: controller.signal })
      if (controller.signal.aborted) return
      const body = String(data.content || '').trim()
      if (!body) throw new Error('The AI returned an empty draft. Please try again.')
      onDraftChange((current) => current.trim() ? `${current.trimEnd()}\n${body}` : body)
      composerRef.current?.focus()
      toast.success('Draft added. Review it before sending.')
    } catch (error) {
      if (!controller.signal.aborted) toast.error(errorMessage(error, 'Unable to create an AI draft.'))
    } finally {
      draftRequest.current = null
      if (!controller.signal.aborted) setDrafting(false)
    }
  }

  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !window.matchMedia?.('(pointer: coarse)').matches) {
      event.preventDefault()
      if (!sending && (draft.trim() || file)) onSend()
    }
  }

  const disabled = sending || drafting
  const templatePicker = (
    <TemplatePicker
      open={dialog?.type === 'template'}
      sending={sending}
      onClose={() => setDialog(null)}
      onSend={async (template, values) => {
        if (await onSendTemplate?.(template, values)) setDialog(null)
      }}
    />
  )

  if (readOnly) return <div className="composer"><span className="muted">Read-only access</span></div>
  if (!windowOpen) {
    return (
      <div className="composer composer-window-closed">
        <span className="muted">The 24-hour messaging window has closed.</span>
        {onSendTemplate && (
          <button type="button" className="button button-sm button-secondary" onClick={() => setDialog({ type: 'template' })}>
            <Icon name="template" size={16} /> Send a template
          </button>
        )}
        {templatePicker}
      </div>
    )
  }

  return (
    <div className="composer" ref={popoverRef}>
      {localError && <div className="composer-validation">{localError}</div>}
      {file && (
        <div className="composer-attachment">
          {preview ? <img src={preview} alt="" className="composer-attachment-thumb" /> : <Icon name={fileType(file)} size={20} />}
          <span className="composer-attachment-name">{file.name}</span>
          <span className="composer-attachment-size">{fileSize(file.size)}</span>
          <button type="button" className="icon-button" onClick={onFileRemove} aria-label="Remove attachment" title="Remove attachment"><Icon name="close" size={16} /></button>
        </div>
      )}
      {uploadProgress > 0 && uploadProgress < 100 && (
        <div className="upload-progress"><span style={{ width: `${uploadProgress}%` }} /></div>
      )}
      {recording && (
        <div className="recording-bar">
          <Icon name="mic" size={16} /> Recording {recordSeconds}s
          <button type="button" className="button button-sm button-secondary" onClick={stopRecording}>Stop & attach</button>
        </div>
      )}
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept={ACCEPT}
        onChange={(event) => {
          const selected = event.target.files?.[0]
          event.target.value = ''
          if (selected) chooseFile(selected)
        }}
      />
      {drafting && <ChatActivity ai>AI assistant is drafting a reply</ChatActivity>}
      <form className="composer-row" onSubmit={(event) => {
        event.preventDefault()
        if ((draft.trim() || file) && !sending) onSend()
      }}>
        <button type="button" className={`icon-button${openMenu === 'emoji' ? ' is-open' : ''}`} onClick={() => setOpenMenu((value) => value === 'emoji' ? '' : 'emoji')} aria-label="Emoji picker" title="Emoji picker" aria-expanded={openMenu === 'emoji'}>
          <Icon name="emoji" size={19} />
        </button>
        <div className="composer-attach-wrap">
          <button
            type="button"
            className={`icon-button composer-attach${openMenu === 'attachments' ? ' is-open' : ''}`}
            onClick={() => setOpenMenu((value) => value === 'attachments' ? '' : 'attachments')}
            aria-label="Attach a file"
            aria-haspopup="menu"
            aria-expanded={openMenu === 'attachments'}
            title="Attach a file"
          >
            <Icon name="paperclip" size={21} />
          </button>
          {openMenu === 'attachments' && (
            <div className="attachment-sheet" role="menu" aria-label="Attachment options">
              {ATTACHMENT_OPTIONS
                .filter((option) => option.kind !== 'interactive' || onSendInteractive)
                .filter((option) => option.kind !== 'template' || onSendTemplate)
                .map((option) => (
                  <button
                    type="button"
                    key={option.kind}
                    className="attachment-option"
                    onClick={() => openAttachmentOption(option.kind)}
                  >
                    <span className={`attachment-icon tone-${option.tone}`}><Icon name={option.icon} size={18} /></span>
                    <span>{option.label}</span>
                  </button>
                ))}
            </div>
          )}
        </div>
        <button type="button" className={`icon-button${openMenu === 'replies' ? ' is-open' : ''}`} onClick={() => setOpenMenu((value) => value === 'replies' ? '' : 'replies')} aria-label="Templates and quick replies" title="Templates and quick replies" aria-expanded={openMenu === 'replies'}>
          <Icon name="template" size={17} />
        </button>
        <textarea
          ref={composerRef}
          className="composer-input"
          rows="1"
          aria-label="Message"
          placeholder="Type a message..."
          value={draft}
          onChange={(event) => {
            onDraftChange(event.target.value)
            onTyping?.(event.target.value)
          }}
          onKeyDown={onKeyDown}
        />
        {conversationId && (
          <button type="button" className="icon-button composer-ai" onClick={draftWithAi} disabled={drafting} aria-label="Draft with AI" title={drafting ? 'Drafting...' : 'Draft a reply with AI'}>
            <Icon name="zap" size={18} />
          </button>
        )}
        {openMenu === 'emoji' && (
          <div className="emoji-picker">
            {EMOJIS.map((emoji) => <button type="button" key={emoji} onClick={() => insertEmoji(emoji)}>{emoji}</button>)}
          </div>
        )}
        {openMenu === 'replies' && (
          <div className="quick-reply-list quick-reply-list-inline">
            {onSendInteractive && (
              <button type="button" className="quick-reply-item" onClick={() => { setOpenMenu(''); setDialog({ type: 'interactive' }) }}>
                <strong>Interactive message</strong>
              </button>
            )}
            {onSendTemplate && (
              <button type="button" className="quick-reply-item" onClick={() => { setOpenMenu(''); setDialog({ type: 'template' }) }}>
                <strong>Send a template</strong>
              </button>
            )}
            <div className="quick-reply-heading">Quick replies</div>
            {quickReplies.map((reply) => (
              <button type="button" className="quick-reply-item" key={reply.id} onClick={() => insertReply(reply)}>
                <strong>{reply.title}</strong>
                <span>{reply.body}</span>
              </button>
            ))}
            {!quickReplies.length && <div className="list-placeholder">No quick replies yet.</div>}
          </div>
        )}
        <button
          className={`composer-send${!draft.trim() && !file ? ' is-voice' : ''}${recording ? ' is-recording' : ''}`}
          type={draft.trim() || file ? 'submit' : 'button'}
          onClick={!draft.trim() && !file ? () => openAttachmentOption('voice') : undefined}
          disabled={disabled}
          aria-label={recording ? 'Stop recording and attach' : draft.trim() || file ? 'Send message' : 'Record a voice note'}
          title={recording ? 'Stop recording and attach' : draft.trim() || file ? 'Send message' : 'Record a voice note'}
        >
          <Icon name={recording ? 'pause' : draft.trim() || file ? 'send' : 'mic'} size={18} />
        </button>
      </form>
      <div className="composer-actions">
        <span className="composer-hint">Enter to send · Shift + Enter for a new line</span>
        <span className="composer-hint">Images 5 MB · video/audio 16 MB · documents 100 MB</span>
      </div>
      {templatePicker}
      <InteractiveBuilder
        open={dialog?.type === 'interactive'}
        initialPayload={dialog?.payload}
        sending={sending || savingReply}
        onClose={() => setDialog(null)}
        onSave={saveInteractiveReply}
        onSend={async (payload) => {
          if (await onSendInteractive?.(payload)) setDialog(null)
        }}
      />
    </div>
  )
}
