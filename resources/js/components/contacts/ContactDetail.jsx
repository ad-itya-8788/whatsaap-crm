import { hasModuleAccess } from '../../lib/moduleAccess.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { useEffect, useRef, useState } from 'react'
import api from '../../api/client.js'
import { useToast } from '../common/ToastProvider.jsx'
import Icon from '../common/Icon.jsx'
import TemplatePicker from '../chat/TemplatePicker.jsx'
import { createIdempotencyKey, errorMessage, formatDate } from '../../lib/utils.js'
import { templateMessagePayload } from '../../lib/whatsappPayloads.js'

const tabs = ['Details', 'Tags', 'Notes', 'Custom fields']

function parseDate(value) {
  if (!value) return null
  const text = String(value)
  const date = new Date(/^\d{4}-\d{2}-\d{2} /.test(text) ? text.replace(' ', 'T') : text)
  return Number.isNaN(date.getTime()) ? null : date
}

function displayDate(value) {
  const date = parseDate(value)
  return date ? date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '—'
}

function dateTitle(value) {
  const date = parseDate(value)
  return date ? formatDate(date) : ''
}

function tagStyle(tag) {
  return tag?.color ? { backgroundColor: tag.color } : undefined
}

export default function ContactDetail({ initialContact, customFields, onClose, onEdit, onOpenChat, readOnly }) {
  const { user } = useAuth()
  const canOpenInbox = hasModuleAccess(user, 'inbox')
  const toast = useToast()
  const dialog = useRef(null)
  const attempt = useRef(null)
  const [contact, setContact] = useState(initialContact)
  const [tab, setTab] = useState('Details')
  const [notes, setNotes] = useState([])
  const [draft, setDraft] = useState('')
  const [confirmNoteId, setConfirmNoteId] = useState(null)
  const [noteBusy, setNoteBusy] = useState(false)
  const [notesLoading, setNotesLoading] = useState(true)
  const [error, setError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [openingChat, setOpeningChat] = useState(false)
  const contactPath = '/api/app/contacts/' + initialContact.id
  const phone = contact.phone || contact.phone_normalized
  const conversationId = contact.conversation_id ?? initialContact.conversation_id
  const lastInteractionAt = contact.last_interaction_at ?? initialContact.last_interaction_at
  const initial = String(contact.name || phone || '?').trim().charAt(0).toUpperCase() || '?'

  useEffect(() => {
    const element = dialog.current
    if (!element.open) element.showModal()
    return () => element.close()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const options = { signal: controller.signal }
    api.get(contactPath, options).then(({ data }) => setContact(data)).catch((err) => {
      if (!controller.signal.aborted) setError(errorMessage(err, 'Unable to load contact details.'))
    })
    api.get(contactPath + '/notes', options).then(({ data }) => setNotes(data)).catch((err) => {
      if (!controller.signal.aborted) toast.error(errorMessage(err, 'Unable to load notes.'))
    }).finally(() => {
      if (!controller.signal.aborted) setNotesLoading(false)
    })
    return () => controller.abort()
  }, [contactPath, toast])

  const saveNote = async (event) => {
    event.preventDefault()
    if (!draft.trim() || noteBusy) return
    setNoteBusy(true)
    try {
      const { data } = await api.post(contactPath + '/notes', { body: draft.trim() })
      setNotes((items) => [data, ...items])
      setDraft('')
    } catch (err) {
      toast.error(errorMessage(err, 'Unable to add note.'))
    } finally {
      setNoteBusy(false)
    }
  }

  const deleteNote = async (id) => {
    setNoteBusy(true)
    try {
      await api.delete(contactPath + '/notes/' + id)
      setNotes((items) => items.filter((note) => note.id !== id))
      setConfirmNoteId(null)
    } catch (err) {
      toast.error(errorMessage(err, 'Unable to delete note.'))
    } finally {
      setNoteBusy(false)
    }
  }

  const sendTemplate = async (template, values) => {
    if (sending) return
    setSending(true)
    const signature = JSON.stringify([template.id, values.body, values.headerText, values.buttonParams, values.headerFile?.name, values.headerFile?.lastModified])
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: createIdempotencyKey() }
    try {
      const { data: conversation } = await api.post('/api/app/conversations/start', { contact_id: contact.id })
      await api.post('/api/app/conversations/' + conversation.id + '/messages', templateMessagePayload(template, values, attempt.current.key))
      attempt.current = null
      setPickerOpen(false)
      toast.success('Template sent.')
    } catch (err) {
      if (err.response?.data?.data?.status === 'failed') attempt.current = null
      toast.error(errorMessage(err, 'Unable to send template.'))
    } finally {
      setSending(false)
    }
  }

  const copyPhone = async () => {
    try {
      await navigator.clipboard.writeText(phone)
      toast.success('Phone number copied.')
    } catch {
      toast.error('Unable to copy phone number.')
    }
  }

  return (
    <dialog
      ref={dialog}
      className="contact-sheet"
      aria-labelledby="contact-sheet-title"
      onCancel={(event) => {
        event.preventDefault()
        if (sending || noteBusy || openingChat) return
        if (pickerOpen) setPickerOpen(false)
        else onClose()
      }}
    >
      <header className="contact-sheet-header">
        <div className="contact-sheet-title">
          <span className="contact-avatar contact-sheet-avatar" aria-hidden="true">{initial}</span>
          <div className="contact-sheet-heading">
            <h2 id="contact-sheet-title">{contact.name || 'Unnamed contact'}</h2>
            {phone && <button className="link-button contact-sheet-phone" type="button" onClick={copyPhone} title="Copy phone number">{phone} <Icon name="copy" size={14} /></button>}
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={sending || noteBusy || openingChat} aria-label="Close contact"><Icon name="close" size={18} /></button>
        </div>
        {!readOnly && <div className="contact-sheet-actions">
          <button type="button" className="button button-sm button-secondary" onClick={() => onEdit(contact)}><Icon name="edit" size={15} /> Edit</button>
          {canOpenInbox && <button type="button" className="button button-sm button-secondary" onClick={() => setPickerOpen(true)}><Icon name="template" size={15} /> Send template</button>}
          {canOpenInbox && <button type="button" className="button button-sm button-primary" disabled={openingChat} onClick={async () => {
            setOpeningChat(true)
            try { await onOpenChat?.(contact) } finally { setOpeningChat(false) }
          }}><Icon name="chat" size={15} /> Open inbox</button>}
        </div>}
      </header>
      <nav className="contact-sheet-tabs" aria-label="Contact information">
        {tabs.map((label) => (
          <button className="button button-ghost button-sm" type="button" key={label} aria-pressed={tab === label} onClick={() => setTab(label)}>{label}</button>
        ))}
      </nav>
      <div className="contact-sheet-content">
        {error && <div className="alert alert-error">{error}</div>}
        {tab === 'Details' && (
          <>
            <section className="contact-detail-section">
              <h3>Contact information</h3>
              <dl className="contact-detail-list">
                <div><dt>Name</dt><dd>{contact.name || '—'}</dd></div>
                {parseDate(contact.created_at) && <div><dt>Added</dt><dd title={dateTitle(contact.created_at)}>{displayDate(contact.created_at)}</dd></div>}
              </dl>
            </section>
            <section className="contact-detail-section">
              <h3>WhatsApp phone</h3>
              {phone ? (
                <div className="contact-detail-phone">
                  <span className="contact-detail-phone-value">{phone}</span>
                  <button type="button" className="icon-button icon-button-sm" onClick={copyPhone} aria-label="Copy phone number" title="Copy phone number"><Icon name="copy" size={14} /></button>
                </div>
              ) : <p className="muted">No phone number on file.</p>}
              {contact.wa_user_id && <dl className="contact-detail-list"><div><dt>WhatsApp ID</dt><dd className="wa-id">{contact.wa_user_id}</dd></div></dl>}
            </section>
            {(contact.email || contact.company) && (
              <section className="contact-detail-section">
                <h3>Email & company</h3>
                <dl className="contact-detail-list">
                  {contact.email && <div><dt>Email</dt><dd>{contact.email}</dd></div>}
                  {contact.company && <div><dt>Company</dt><dd>{contact.company}</dd></div>}
                </dl>
              </section>
            )}
            {(conversationId || lastInteractionAt) && (
              <section className="contact-detail-section">
                <h3>Conversation information</h3>
                <dl className="contact-detail-list">
                  {conversationId && <div><dt>Conversation ID</dt><dd>{String(conversationId)}</dd></div>}
                  {lastInteractionAt && <div><dt>Last interaction</dt><dd title={dateTitle(lastInteractionAt)}>{displayDate(lastInteractionAt)}</dd></div>}
                </dl>
              </section>
            )}
          </>
        )}
        {tab === 'Tags' && (
          <section className="contact-detail-section">
            <h3>Tags</h3>
            <div className="contact-tags">
              {contact.tags?.map((tag) => <span className="tag-chip" key={tag.id} style={tagStyle(tag)}>{tag.name}</span>)}
              {!contact.tags?.length && <p className="muted">No tags</p>}
            </div>
          </section>
        )}
        {tab === 'Custom fields' && (
          <section className="contact-detail-section">
            <h3>Custom fields</h3>
            {customFields.length ? <dl className="contact-detail-list">
              {customFields.map((field) => {
                const value = contact.custom_fields?.[field.id]
                return <div key={field.id}><dt>{field.label || field.name}</dt><dd>{value == null || value === '' ? '—' : String(value)}</dd></div>
              })}
            </dl> : <p className="muted">No custom fields</p>}
          </section>
        )}
        {tab === 'Notes' && (
          <section className="contact-detail-section">
            <h3>Notes</h3>
            {!readOnly && <form className="contact-note-form" onSubmit={saveNote}>
              <label className="field-label" htmlFor="contact-note">Add a note</label>
              <textarea id="contact-note" className="input" rows={3} maxLength={5000} value={draft} onChange={(event) => setDraft(event.target.value)} />
              <button type="submit" className="button button-sm button-primary" disabled={noteBusy || notesLoading || !draft.trim()}>Add note</button>
            </form>}
            {notesLoading && <p className="muted">Loading notes…</p>}
            {!notesLoading && !notes.length && <p className="muted">No notes yet.</p>}
            {notes.map((note) => (
              <article className="contact-note" key={note.id}>
                <div className="contact-sheet-title">
                  <small className="muted">{note.user?.name || 'Team member'} · {formatDate(note.created_at)}</small>
                  {!readOnly && confirmNoteId !== note.id && <button type="button" className="icon-button icon-button-sm is-danger" aria-label="Delete note" onClick={() => setConfirmNoteId(note.id)}><Icon name="trash" size={14} /></button>}
                </div>
                <p>{note.body}</p>
                {confirmNoteId === note.id && <div className="contact-sheet-actions">
                  <button type="button" className="button button-sm button-secondary" disabled={noteBusy} onClick={() => setConfirmNoteId(null)}>Cancel</button>
                  <button type="button" className="button button-sm button-danger" disabled={noteBusy} onClick={() => deleteNote(note.id)}>Delete note</button>
                </div>}
              </article>
            ))}
          </section>
        )}
      </div>
      {pickerOpen && <TemplatePicker open onClose={() => setPickerOpen(false)} onSend={sendTemplate} sending={sending} />}
    </dialog>
  )
}
