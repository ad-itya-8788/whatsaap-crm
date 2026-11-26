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
  onSend,
  sending = false,
  optedOut = false,
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
  const [preview, setPreview] = useState('')
  const [openMenu, setOpenMenu] = useState('')
  const [recording, setRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [localError, setLocalError] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [dialog, setDialog] = useState(null)
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
    if (!conversationId || drafting) return
    setDrafting(true)
    try {
      const { data } = await api.post('/api/app/ai/draft', { conversation_id: conversationId })
      const body = String(data.content || '').trim()
      if (!body) throw new Error('The AI returned an empty draft. Please try again.')
      onDraftChange(draft ? `${draft.trimEnd()}\n${body}` : body)
      composerRef.current?.focus()
      toast.success('Draft added. Review it before sending.')
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to create an AI draft.'))
    } finally {
      setDrafting(false)
    }
  }

  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !window.matchMedia?.('(pointer: coarse)').matches) {
      event.preventDefault()
      if (!sending && !optedOut && (draft.trim() || file)) onSend()
    }
  }

  const disabled = sending || drafting || optedOut || (!draft.trim() && !file)
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
  if (optedOut) return null
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
          <button type="button" className="icon-button" onClick={onFileRemove} aria-label="Remove attachment"><Icon name="close" size={16} /></button>
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
      <form className="composer-row" onSubmit={(event) => { event.preventDefault(); onSend() }}>
        <button type="button" className="icon-button composer-attach" onClick={() => fileInputRef.current?.click()} aria-label="Attach a file" title="Attach image, video, audio, or document">
          <Icon name="paperclip" size={20} />
        </button>
        <button type="button" className={`icon-button${openMenu === 'emoji' ? ' is-open' : ''}`} onClick={() => setOpenMenu((value) => value === 'emoji' ? '' : 'emoji')} aria-label="Emoji picker" aria-expanded={openMenu === 'emoji'}>
          <Icon name="emoji" size={20} />
        </button>
        <button type="button" className={`icon-button${recording ? ' is-recording' : ''}`} onClick={recording ? stopRecording : startRecording} aria-label={recording ? 'Stop recording' : 'Record audio'}>
          <Icon name="mic" size={20} />
        </button>
        {conversationId && (
          <button type="button" className="icon-button" onClick={draftWithAi} disabled={optedOut || drafting} aria-label="Draft with AI" title={drafting ? 'Drafting...' : 'Draft a reply with AI'}>
            <Icon name="bot" size={19} />
          </button>
        )}
        <div className="quick-reply-menu">
          <button type="button" className={`icon-button${openMenu === 'replies' ? ' is-open' : ''}`} onClick={() => setOpenMenu((value) => value === 'replies' ? '' : 'replies')} disabled={optedOut} aria-label="More message options" aria-expanded={openMenu === 'replies'}>
            <Icon name="plus" size={19} />
          </button>
          {openMenu === 'replies' && (
            <div className="quick-reply-list">
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
        </div>
        {openMenu === 'emoji' && (
          <div className="emoji-picker">
            {EMOJIS.map((emoji) => <button type="button" key={emoji} onClick={() => insertEmoji(emoji)}>{emoji}</button>)}
          </div>
        )}
        <textarea
          ref={composerRef}
          className="composer-input"
          rows="1"
          aria-label="Message"
          placeholder={optedOut ? 'This contact opted out of messages' : 'Type a message...'}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={optedOut}
        />
        <button className="button button-primary composer-send" type="submit" disabled={disabled}>
          <Icon name="send" size={16} /> <span>{sending ? 'Sending...' : 'Send'}</span>
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
