import { useEffect, useRef, useState } from 'react'
import Recorder from 'opus-recorder'
import encoderPath from 'opus-recorder/dist/encoderWorker.min.js?url'
import Icon from '../common/Icon.jsx'
import { useToast } from '../common/ToastProvider.jsx'
import { fileSize, fileType } from './chatUtils.js'

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

export default function ChatComposer({
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
    const body = String(reply.body || '')
    onDraftChange(draft ? `${draft}\n${body}` : body)
    setOpenMenu('')
    composerRef.current?.focus()
  }

  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (!sending && !optedOut && (draft.trim() || file)) onSend()
    }
  }

  const disabled = sending || optedOut || (!draft.trim() && !file)

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
        <div className="quick-reply-menu">
          <button type="button" className={`icon-button${openMenu === 'replies' ? ' is-open' : ''}`} onClick={() => setOpenMenu((value) => value === 'replies' ? '' : 'replies')} disabled={optedOut} aria-label="Quick replies" aria-expanded={openMenu === 'replies'}>
            <Icon name="bolt" size={19} />
          </button>
          {openMenu === 'replies' && (
            <div className="quick-reply-list">
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
    </div>
  )
}
