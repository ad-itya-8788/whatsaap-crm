import { useEffect, useRef, useState } from 'react'
import api from '../../api/client.js'
import { useToast } from '../common/ToastProvider.jsx'
import Icon from '../common/Icon.jsx'
import TemplatePicker from '../chat/TemplatePicker.jsx'
import { createIdempotencyKey, errorMessage, formatDate } from '../../lib/utils.js'
import { templateMessagePayload } from '../../lib/whatsappPayloads.js'

const tabs = ['Details', 'Tags', 'Notes', 'Custom fields']

export default function ContactDetail({ initialContact, customFields, onClose, onEdit, onOpenChat, readOnly }) {
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

  useEffect(() => {
    const element = dialog.current
    element.showModal()
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
          <div>
            <h2 id="contact-sheet-title">{contact.name || 'Unnamed contact'}</h2>
            {phone && <button className="link-button" type="button" onClick={copyPhone}>{phone} <Icon name="copy" size={14} /></button>}
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={sending || noteBusy || openingChat} aria-label="Close contact"><Icon name="close" /></button>
        </div>
        {!readOnly && <div className="contact-sheet-actions">
          <button type="button" className="button button-sm button-primary" disabled={contact.consent_status === 'opted_out'} onClick={() => setPickerOpen(true)}><Icon name="template" size={16} /> Send template</button>
          <button type="button" className="button button-sm button-secondary" disabled={openingChat} onClick={async () => {
            setOpeningChat(true)
            try { await onOpenChat(contact) } finally { setOpeningChat(false) }
          }}><Icon name="chat" size={16} /> Open inbox</button>
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
          <dl className="contact-detail-list">
            {[['Name', contact.name], ['Phone', phone], ['Email', contact.email], ['Company', contact.company]].map(([label, value]) => (
              <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>
            ))}
          </dl>
        )}
        {tab === 'Tags' && (
          <div className="contact-tags">
            {contact.tags?.map((tag) => <span className="tag-chip" key={tag.id} style={{ backgroundColor: tag.color || '#2563eb' }}>{tag.name}</span>)}
            {!contact.tags?.length && <p className="muted">No tags</p>}
          </div>
        )}
        {tab === 'Custom fields' && (
          customFields.length ? <dl className="contact-detail-list">
            {customFields.map((field) => {
              const value = contact.custom_fields?.[field.id]
              return <div key={field.id}><dt>{field.label || field.name}</dt><dd>{value == null || value === '' ? '—' : String(value)}</dd></div>
            })}
          </dl> : <p className="muted">No custom fields</p>
        )}
        {tab !== 'Notes' && !readOnly && <button className="button button-secondary button-sm" type="button" onClick={() => onEdit(contact)}><Icon name="edit" size={16} /> Edit contact</button>}
        {tab === 'Notes' && (
          <>
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
                  {!readOnly && confirmNoteId !== note.id && <button type="button" className="icon-button is-danger" aria-label="Delete note" onClick={() => setConfirmNoteId(note.id)}><Icon name="trash" size={16} /></button>}
                </div>
                <p>{note.body}</p>
                {confirmNoteId === note.id && <div className="contact-sheet-actions">
                  <button type="button" className="button button-sm button-secondary" disabled={noteBusy} onClick={() => setConfirmNoteId(null)}>Cancel</button>
                  <button type="button" className="button button-sm button-danger" disabled={noteBusy} onClick={() => deleteNote(note.id)}>Delete note</button>
                </div>}
              </article>
            ))}
          </>
        )}
      </div>
      {pickerOpen && <TemplatePicker open onClose={() => setPickerOpen(false)} onSend={sendTemplate} sending={sending} />}
    </dialog>
  )
}
