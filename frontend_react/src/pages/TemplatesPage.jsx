import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api from '../api/client.js'
import PageHeader from '../components/common/PageHeader.jsx'
import Icon from '../components/common/Icon.jsx'
import { createIdempotencyKey, errorMessage, extractList, formatTime, placeholders, renderTemplate } from '../lib/utils.js'

const blankForm = () => ({
  name: '',
  category: 'UTILITY',
  language: 'en_US',
  body_text: '',
  header_type: '',
  header_text: '',
  header_file: null,
  header_handle: '',
  footer_text: '',
  buttons: '',
  variables: [{ key: '', value: '' }],
})

const mediaHeaderTypes = ['IMAGE', 'VIDEO', 'DOCUMENT']
const headerAccept = {
  IMAGE: 'image/jpeg,image/png',
  VIDEO: 'video/mp4,video/3gpp',
  DOCUMENT: 'application/pdf,text/plain,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

const statuses = {
  APPROVED: 'Approved',
  PENDING: 'Pending',
  REJECTED: 'Rejected',
  DISAPPROVED: 'Rejected',
  PAUSED: 'Paused',
}

function templateStatus(template) {
  return String(template?.approval_status || template?.status || 'PENDING').toUpperCase()
}

function TemplatePreview({ body, header, footer, values, mediaType, mediaUrl, mediaName }) {
  return (
    <div className="whatsapp-preview">
      <div className="preview-head">
        <span className="preview-whatsapp-icon"><Icon name="whatsapp" size={18} /></span>
        <div><strong>Your business</strong><small>WhatsApp Business</small></div>
      </div>
      <div className="preview-body">
        <div className="preview-bubble">
          {mediaUrl && mediaType === 'IMAGE' && <img className="preview-media" src={mediaUrl} alt="Template header preview" />}
          {mediaUrl && mediaType === 'VIDEO' && <video className="preview-media" src={mediaUrl} controls />}
          {mediaType && mediaHeaderTypes.includes(mediaType) && !mediaUrl && (
            <div className="template-media-preview"><Icon name={mediaType.toLowerCase()} size={20} /><span>{mediaName || 'Media header selected'}</span></div>
          )}
          {header && mediaType === 'TEXT' && <div className="preview-header">{header}</div>}
          <p>{renderTemplate(body, values) || 'Your template preview appears here.'}</p>
          {footer && <div className="preview-footer-text">{footer}</div>}
          <span className="preview-time">Now</span>
        </div>
      </div>
      <div className="preview-bar"><Icon name="eye" size={14} /><span>Message preview</span><Icon name="send" size={14} /></div>
    </div>
  )
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState([])
  const [contacts, setContacts] = useState([])
  const [form, setForm] = useState(blankForm)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [sendTarget, setSendTarget] = useState(null)
  const [sendContact, setSendContact] = useState('')
  const [sendValues, setSendValues] = useState({})
  const [sendHeaderFile, setSendHeaderFile] = useState(null)
  const [headerPreviewUrl, setHeaderPreviewUrl] = useState('')
  const sendAttempt = useRef(null)

  const load = useCallback(async () => {
    setError('')
    try {
      const [templateResult, contactResult] = await Promise.all([
        api.get('/api/app/whatsapp/templates'),
        api.get('/api/app/contacts', { params: { per_page: 100 } }).catch(() => ({ data: {} })),
      ])
      setTemplates(extractList(templateResult.data))
      setContacts(extractList(contactResult.data))
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to load message templates.'))
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!form.header_file || !['IMAGE', 'VIDEO'].includes(form.header_type)) {
      setHeaderPreviewUrl('')
      return undefined
    }

    const url = URL.createObjectURL(form.header_file)
    setHeaderPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [form.header_file, form.header_type])

  const run = async (key, action, successMessage) => {
    setBusy(key)
    setError('')
    setNotice('')
    try {
      await action()
      setNotice(successMessage)
      await load()
      return true
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to complete the request.'))
      return false
    } finally {
      setBusy('')
    }
  }

  const sampleValues = useMemo(() => form.variables.reduce((values, row) => {
    const key = String(row.key || '').trim()
    if (key) values[key] = row.value || ''
    return values
  }, {}), [form.variables])

  const updateVariable = (index, field, value) => {
    setForm((current) => ({
      ...current,
      variables: current.variables.map((row, position) => position === index ? { ...row, [field]: value } : row),
    }))
  }

  const create = async (event) => {
    event.preventDefault()
    const headerData = form.header_type === 'TEXT' && form.header_text.trim()
      ? { type: 'TEXT', text: form.header_text.trim() }
      : mediaHeaderTypes.includes(form.header_type)
        ? { type: form.header_type, handle: form.header_handle }
        : null
    const payload = {
      name: form.name.trim(),
      category: form.category,
      language: form.language.trim(),
      body_text: form.body_text.trim(),
      header_data: headerData,
      footer_text: form.footer_text.trim() || null,
      buttons: form.buttons.split('\n').map((value) => value.trim()).filter(Boolean),
      sample_values: sampleValues,
    }
    const done = await run('create', () => api.post('/api/app/whatsapp/templates', payload), 'Template created. Submit it to Meta for review.')
    if (done) setForm(blankForm())
  }

  const uploadHeader = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const type = form.header_type
    const payload = new FormData()
    payload.append('type', type)
    payload.append('file', file)
    setBusy('header-media')
    setError('')
    setNotice('')
    try {
      const { data } = await api.post('/api/app/whatsapp/templates/media', payload)
      setForm((current) => ({ ...current, header_file: file, header_handle: data.handle }))
      setNotice('Header media uploaded to Meta. Create the template to submit it for review.')
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to upload template media.'))
    } finally {
      setBusy('')
    }
  }

  const sync = () => run('sync', () => api.post('/api/app/whatsapp/templates/sync'), 'Templates synced from Meta.')

  const submitTemplate = (template) => run(
    `submit-${template.id}`,
    () => api.post(`/api/app/whatsapp/templates/${template.id}/submit`),
    `Template "${template.name}" submitted to Meta.`,
  )

  const deleteTemplate = (template) => {
    if (!window.confirm(`Delete template "${template.name}"?`)) return
    run(`delete-${template.id}`, () => api.delete(`/api/app/whatsapp/templates/${template.id}`), 'Template deleted.')
  }

  const openSend = (template) => {
    const keys = placeholders(template.body_text)
    const source = template.sample_values || {}
    const initial = keys.reduce((values, key) => {
      values[key] = source[key] ?? source[String(Number(key))] ?? ''
      return values
    }, {})
    setSendTarget(template)
    setSendContact('')
    setSendValues(initial)
    setSendHeaderFile(null)
    sendAttempt.current = null
    setError('')
    setNotice('')
  }

  const sendTemplate = async () => {
    if (!sendContact) {
      setError('Choose a contact before sending this template.')
      return
    }
    if (mediaHeaderTypes.includes(String(sendTarget.header_type).toUpperCase()) && !sendHeaderFile) {
      setError('Choose a file for this template media header.')
      return
    }
    const request = {
      templateId: sendTarget.id,
      contactId: sendContact,
      variables: sendValues,
      headerFile: sendHeaderFile
        ? `${sendHeaderFile.name}:${sendHeaderFile.size}:${sendHeaderFile.lastModified}`
        : '',
    }
    const signature = JSON.stringify(request)
    if (!sendAttempt.current || sendAttempt.current.signature !== signature) {
      sendAttempt.current = { signature, key: createIdempotencyKey() }
    }

    const sendPayload = sendHeaderFile
      ? (() => {
        const payload = new FormData()
        payload.append('contact_id', sendContact)
        Object.values(sendValues).forEach((value) => payload.append('variables[]', value))
        payload.append('header_file', sendHeaderFile)
        payload.append('idempotency_key', sendAttempt.current.key)
        return payload
      })()
      : {
        contact_id: sendContact,
        variables: sendValues,
        idempotency_key: sendAttempt.current.key,
      }

    const done = await run(
      `send-${sendTarget.id}`,
      () => api.post(`/api/app/whatsapp/templates/${sendTarget.id}/send`, sendPayload),
      'Template sent successfully.',
    )
    if (done) {
      sendAttempt.current = null
      setSendTarget(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Message Templates"
        subtitle="Create, submit and send approved WhatsApp message templates."
      />
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      <div className="templates-layout">
        <section className="card template-library">
          <header className="panel-header">
            <h2>Templates</h2>
            <button type="button" className="button button-sm button-secondary" onClick={sync} disabled={busy === 'sync'}><Icon name="sync" size={15} /> Sync from Meta</button>
          </header>
          <div className="template-list">
            {templates.map((template) => {
              const status = templateStatus(template)
              const approved = status === 'APPROVED'
              return (
                <article className="template-card" key={template.id}>
                  <header className="template-card-head">
                    <div>
                      <h3 className="template-name">{template.name}</h3>
                      <div className="template-meta">{template.language || 'en_US'} · {template.category || 'UTILITY'}</div>
                    </div>
                    <span className={`badge badge-${status.toLowerCase()}`}>{statuses[status] || status}</span>
                  </header>
                  <p className="template-preview">{renderTemplate(template.body_text, template.sample_values || {})}</p>
                  {status === 'REJECTED' && template.rejection_reason && (
                    <p className="rejection-reason"><Icon name="alert" size={14} /> {template.rejection_reason}</p>
                  )}
                  {template.last_synced_at && <div className="template-synced">Synced at {formatTime(template.last_synced_at)}</div>}
                  <footer className="template-actions">
                    {!approved && (
                      <button type="button" className="button button-sm button-secondary" onClick={() => submitTemplate(template)} disabled={busy === `submit-${template.id}`}>
                        Submit to Meta
                      </button>
                    )}
                    <button type="button" className="button button-sm button-secondary" onClick={() => openSend(template)} disabled={!approved || !contacts.length}>
                      <Icon name="send" size={14} /> Send
                    </button>
                    <button type="button" className="button button-sm button-ghost" onClick={() => deleteTemplate(template)} disabled={busy === `delete-${template.id}`} aria-label={`Delete ${template.name}`}>
                      <Icon name="trash" size={15} />
                    </button>
                  </footer>
                </article>
              )
            })}
            {!templates.length && <div className="list-placeholder">No templates yet. Create one or sync from Meta.</div>}
          </div>
        </section>

        <div className="template-side">
          <section className="card template-form">
            <header className="panel-header"><h2>Create template</h2></header>
            <form onSubmit={create}>
              <div className="form-grid">
                <div className="field">
                  <label className="field-label" htmlFor="template-name">Name</label>
                  <input id="template-name" className="input" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="template-category">Category</label>
                  <select id="template-category" className="select" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
                    <option value="UTILITY">Utility</option>
                    <option value="MARKETING">Marketing</option>
                    <option value="AUTHENTICATION">Authentication</option>
                  </select>
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="template-language">Language</label>
                  <input id="template-language" className="input" required value={form.language} onChange={(event) => setForm({ ...form, language: event.target.value })} />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="template-header-type">Header (optional)</label>
                  <select
                    id="template-header-type"
                    className="select"
                    value={form.header_type}
                    disabled={busy === 'header-media'}
                    onChange={(event) => setForm((current) => ({
                      ...current,
                      header_type: event.target.value,
                      header_text: '',
                      header_file: null,
                      header_handle: '',
                    }))}
                  >
                    <option value="">No header</option>
                    <option value="TEXT">Text</option>
                    <option value="IMAGE">Image</option>
                    <option value="VIDEO">Video</option>
                    <option value="DOCUMENT">Document</option>
                  </select>
                </div>
                {form.header_type === 'TEXT' && (
                  <div className="field">
                    <label className="field-label" htmlFor="template-header-text">Header text</label>
                    <input id="template-header-text" className="input" maxLength="60" value={form.header_text} onChange={(event) => setForm({ ...form, header_text: event.target.value })} />
                  </div>
                )}
                {mediaHeaderTypes.includes(form.header_type) && (
                  <div className="field field-full template-media-upload">
                    <label className="field-label" htmlFor="template-header-file">{form.header_type.toLowerCase()} header file</label>
                    <input
                      id="template-header-file"
                      className="input"
                      type="file"
                      accept={headerAccept[form.header_type]}
                      onChange={uploadHeader}
                      disabled={busy === 'header-media'}
                    />
                    <span className="field-hint">
                      {busy === 'header-media' ? 'Uploading to Meta...' : 'Meta App ID must be configured for resumable template uploads.'}
                    </span>
                    {form.header_file && (
                      <div className="template-media-preview">
                        {headerPreviewUrl && form.header_type === 'IMAGE'
                          ? <img src={headerPreviewUrl} alt="" />
                          : headerPreviewUrl && form.header_type === 'VIDEO'
                            ? <video src={headerPreviewUrl} controls />
                            : <Icon name={form.header_type.toLowerCase()} size={20} />}
                        <span>{form.header_file.name}</span>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Remove header file"
                          onClick={() => setForm((current) => ({ ...current, header_file: null, header_handle: '' }))}
                        >
                          <Icon name="close" size={15} />
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <div className="field field-full">
                  <label className="field-label" htmlFor="template-body">Body text</label>
                  <textarea id="template-body" className="textarea" rows="4" required value={form.body_text} onChange={(event) => setForm({ ...form, body_text: event.target.value })} />
                  <span className="field-hint">Use {'{{1}}'}, {'{{2}}'} for variables.</span>
                </div>
                <div className="field field-full">
                  <label className="field-label" htmlFor="template-footer">Footer (optional)</label>
                  <input id="template-footer" className="input" value={form.footer_text} onChange={(event) => setForm({ ...form, footer_text: event.target.value })} />
                </div>
                <div className="field field-full">
                  <label className="field-label" htmlFor="template-buttons">Buttons (one per line, optional)</label>
                  <textarea id="template-buttons" className="textarea" rows="2" value={form.buttons} onChange={(event) => setForm({ ...form, buttons: event.target.value })} />
                </div>
              </div>
              <div className="variables-editor">
                <div className="variables-head">
                  <span>Sample variables</span>
                  <button type="button" className="button button-sm button-ghost" onClick={() => setForm((current) => ({ ...current, variables: [...current.variables, { key: '', value: '' }] }))}><Icon name="plus" size={14} /> Add variable</button>
                </div>
                {form.variables.map((row, index) => (
                  <div className="var-row" key={index}>
                    <input className="input" placeholder="{{1}}" aria-label={`Variable ${index + 1} name`} value={row.key} onChange={(event) => updateVariable(index, 'key', event.target.value)} />
                    <input className="input" placeholder="Sample value" aria-label={`Variable ${index + 1} value`} value={row.value} onChange={(event) => updateVariable(index, 'value', event.target.value)} />
                    <button type="button" className="icon-button" onClick={() => setForm((current) => ({ ...current, variables: current.variables.filter((_, position) => position !== index) }))} aria-label={`Remove variable ${index + 1}`}><Icon name="close" size={14} /></button>
                  </div>
                ))}
              </div>
              <TemplatePreview
                body={form.body_text}
                header={form.header_text}
                footer={form.footer_text}
                values={sampleValues}
                mediaType={form.header_type}
                mediaUrl={headerPreviewUrl}
                mediaName={form.header_file?.name}
              />
              <button
                className="button button-primary"
                type="submit"
                disabled={busy === 'create' || busy === 'header-media' || (mediaHeaderTypes.includes(form.header_type) && !form.header_handle)}
              >
                {busy === 'create' ? 'Creating...' : 'Create template'}
              </button>
            </form>
          </section>

          {sendTarget && (
            <section className="card send-panel">
              <header className="panel-header">
                <h2>Send “{sendTarget.name}”</h2>
                <button type="button" className="icon-button" onClick={() => setSendTarget(null)} aria-label="Close send panel"><Icon name="close" size={18} /></button>
              </header>
              <div className="send-panel-body">
                <div className="field">
                  <label className="field-label" htmlFor="send-contact">Contact</label>
                  <select id="send-contact" className="select" value={sendContact} onChange={(event) => setSendContact(event.target.value)}>
                    <option value="">Choose a contact</option>
                    {contacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>{contact.name || contact.phone} · {contact.phone || 'no phone'}</option>
                    ))}
                  </select>
                </div>
                {mediaHeaderTypes.includes(String(sendTarget.header_type).toUpperCase()) && (
                  <div className="field template-media-upload">
                    <label className="field-label" htmlFor="send-template-header">Header file</label>
                    <input
                      id="send-template-header"
                      className="input"
                      type="file"
                      accept={headerAccept[String(sendTarget.header_type).toUpperCase()]}
                      onChange={(event) => setSendHeaderFile(event.target.files?.[0] || null)}
                    />
                    {sendHeaderFile && <span className="field-hint">{sendHeaderFile.name}</span>}
                  </div>
                )}
                <div className="send-vars">
                  {placeholders(sendTarget.body_text).map((key) => (
                    <div className="field" key={key}>
                      <label className="field-label" htmlFor={`send-var-${key}`}>{'{{'}{key}{'}}'}</label>
                      <input id={`send-var-${key}`} className="input" value={sendValues[key] || ''} onChange={(event) => setSendValues({ ...sendValues, [key]: event.target.value })} />
                    </div>
                  ))}
                </div>
                <button type="button" className="button button-primary" onClick={sendTemplate} disabled={!sendContact || busy === `send-${sendTarget.id}`}>
                  {busy === `send-${sendTarget.id}` ? 'Sending...' : 'Send template'}
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  )
}
