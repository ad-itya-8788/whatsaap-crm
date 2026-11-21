import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '../api/client.js'
import PageHeader from '../components/common/PageHeader.jsx'
import Icon from '../components/common/Icon.jsx'
import { errorMessage, extractList, formatTime, placeholders, renderTemplate } from '../lib/utils.js'

const blankForm = () => ({
  name: '',
  category: 'UTILITY',
  language: 'en_US',
  body_text: '',
  header_text: '',
  footer_text: '',
  buttons: '',
  variables: [{ key: '', value: '' }],
})

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

function TemplatePreview({ body, header, footer, values }) {
  return (
    <div className="whatsapp-preview">
      <div className="preview-head">
        <Icon name="chat" size={17} />
        <div><strong>Your business</strong><small>WhatsApp Business</small></div>
      </div>
      <div className="preview-body">
        <div className="preview-bubble">
          {header && <div className="preview-header">{header}</div>}
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
    const payload = {
      name: form.name.trim(),
      category: form.category,
      language: form.language.trim(),
      body_text: form.body_text.trim(),
      header_data: form.header_text.trim() ? { type: 'TEXT', text: form.header_text.trim() } : null,
      footer_text: form.footer_text.trim() || null,
      buttons: form.buttons.split('\n').map((value) => value.trim()).filter(Boolean),
      sample_values: sampleValues,
    }
    const done = await run('create', () => api.post('/api/app/whatsapp/templates', payload), 'Template created. Submit it to Meta for review.')
    if (done) setForm(blankForm())
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
    setError('')
    setNotice('')
  }

  const sendTemplate = async () => {
    if (!sendContact) {
      setError('Choose a contact before sending this template.')
      return
    }
    const done = await run(
      `send-${sendTarget.id}`,
      () => api.post(`/api/app/whatsapp/templates/${sendTarget.id}/send`, { contact_id: sendContact, variables: sendValues }),
      'Template sent successfully.',
    )
    if (done) setSendTarget(null)
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
                  <label className="field-label" htmlFor="template-header">Header (optional)</label>
                  <input id="template-header" className="input" value={form.header_text} onChange={(event) => setForm({ ...form, header_text: event.target.value })} />
                </div>
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
              <TemplatePreview body={form.body_text} header={form.header_text} footer={form.footer_text} values={sampleValues} />
              <button className="button button-primary" type="submit" disabled={busy === 'create'}>{busy === 'create' ? 'Creating...' : 'Create template'}</button>
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
