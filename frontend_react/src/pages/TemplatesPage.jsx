import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import api from '../api/client.js'
import PageHeader from '../components/common/PageHeader.jsx'
import Icon from '../components/common/Icon.jsx'
import ConfirmDialog from '../components/common/ConfirmDialog.jsx'
import { useToast } from '../components/common/ToastProvider.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { createIdempotencyKey, errorMessage, extractList, formatTime, isAdmin, placeholders, relativeTime, renderTemplate } from '../lib/utils.js'

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
  variables: [],
})

const mediaHeaderTypes = ['IMAGE', 'VIDEO', 'DOCUMENT']
const categories = ['UTILITY', 'MARKETING', 'AUTHENTICATION']
const headerAccept = {
  IMAGE: 'image/jpeg,image/png',
  VIDEO: 'video/mp4,video/3gpp',
  DOCUMENT: 'application/pdf,text/plain,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

const statuses = {
  DRAFT: 'Draft',
  APPROVED: 'Approved',
  PENDING: 'Pending',
  IN_REVIEW: 'In review',
  REJECTED: 'Rejected',
  DISAPPROVED: 'Rejected',
  PAUSED: 'Paused',
}

function templateStatus(template) {
  return String(template?.approval_status || template?.status || 'PENDING').toUpperCase()
}

function variableRows(body, source = {}) {
  const keys = placeholders(body)

  return keys.map((key, index) => {
    const value = Array.isArray(source)
      ? source[index]
      : source[key] ?? source[String(Number(key))] ?? source[`{{${key}}}`]

    return { key, value: value == null ? '' : String(value) }
  })
}

function previewValues(body, values) {
  return placeholders(body).reduce((result, key, index) => {
    const value = values[key] ?? values[String(Number(key))]
    result[key] = String(value || (index === 0 ? 'Sample name' : `Sample ${index + 1}`))
    return result
  }, {})
}

function formFromTemplate(template) {
  const headerType = String(template.header_type || '').toUpperCase()

  return {
    name: template.name || '',
    category: String(template.category || 'UTILITY').toUpperCase(),
    language: template.language || 'en_US',
    body_text: template.body_text || '',
    header_type: headerType,
    header_text: template.header_content || '',
    header_file: null,
    header_handle: template.header_handle || '',
    footer_text: template.footer_text || '',
    buttons: Array.isArray(template.buttons) ? template.buttons.join('\n') : '',
    variables: variableRows(template.body_text || '', template.sample_values || {}),
  }
}

function revisionTemplateName(name, templates) {
  const base = String(name || 'template').replace(/_v\d+$/, '') || 'template'
  const existingNames = new Set(templates.map((template) => String(template.name || '').toLowerCase()))
  let version = 2
  let candidate = ''

  do {
    const suffix = `_v${version}`
    candidate = `${base.slice(0, 255 - suffix.length)}${suffix}`
    version += 1
  } while (existingNames.has(candidate.toLowerCase()))

  return candidate
}

function TemplatePreview({ name, category, language, body, header, footer, values, mediaType, mediaUrl, mediaName, buttons }) {
  const sampleValues = previewValues(body, values)
  const actionButtons = buttons.split('\n').map((value) => value.trim()).filter(Boolean)

  return (
    <section className="template-preview-card" aria-label="Live WhatsApp template preview">
      <div className="template-preview-title">
        <div>
          <h3>Live preview</h3>
          <p>{name || 'Template name'} · {category} · {language}</p>
        </div>
        <span className="preview-live"><span /> Live</span>
      </div>
      <div className="whatsapp-preview">
        <div className="preview-head">
          <span className="preview-whatsapp-icon"><Icon name="whatsapp" size={18} /></span>
          <div><strong>Aayojan AI CRM</strong><small>business account</small></div>
        </div>
        <div className="preview-body">
          <div className="preview-bubble">
            {header && mediaType === 'TEXT' && <div className="preview-header">{header}</div>}
            {mediaType === 'IMAGE' && mediaUrl && <img className="preview-media" src={mediaUrl} alt="Template header preview" />}
            {mediaType === 'VIDEO' && mediaUrl && <video className="preview-media" src={mediaUrl} controls />}
            {mediaHeaderTypes.includes(mediaType) && !mediaUrl && (
              <div className="preview-document">
                <Icon name={mediaType.toLowerCase()} size={20} />
                <span>{mediaName || `${mediaType.toLowerCase()} header`}</span>
              </div>
            )}
            <p>{renderTemplate(body, sampleValues) || 'Your template message will appear here.'}</p>
            {footer && <div className="preview-footer-text">{footer}</div>}
            <span className="preview-time">{formatTime(new Date())}</span>
          </div>
          {!!actionButtons.length && (
            <div className="preview-buttons">
              {actionButtons.slice(0, 3).map((label, index) => (
                <div className="preview-action" key={`${label}-${index}`}>{label}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export default function TemplatesPage() {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const { templateId } = useParams()
  const isEditor = location.pathname === '/templates/create' || Boolean(templateId)
  const editorRoute = templateId ? `edit:${templateId}` : 'create'
  const toast = useToast()
  const canManage = isAdmin(user)
  const [templates, setTemplates] = useState([])
  const [contacts, setContacts] = useState([])
  const [form, setForm] = useState(blankForm)
  const [editingId, setEditingId] = useState(null)
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [sendTarget, setSendTarget] = useState(null)
  const [sendContact, setSendContact] = useState('')
  const [sendValues, setSendValues] = useState({})
  const [sendHeaderFile, setSendHeaderFile] = useState(null)
  const [headerPreviewUrl, setHeaderPreviewUrl] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const sendAttempt = useRef(null)
  const initializedEditorRoute = useRef('')

  const load = useCallback(async () => {
    setLoading(true)
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
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!isEditor) {
      initializedEditorRoute.current = ''
      setEditingId(null)
      return
    }

    if (initializedEditorRoute.current === editorRoute) return

    if (!templateId) {
      initializedEditorRoute.current = editorRoute
      const revisionSource = location.state?.revisionOf
      setForm(revisionSource
        ? { ...formFromTemplate(revisionSource), name: revisionTemplateName(revisionSource.name, templates) }
        : blankForm())
      setEditingId(null)
      setSendTarget(null)
      setError('')
      setNotice('')
      return
    }

    const template = location.state?.template
      || templates.find((item) => String(item.id) === String(templateId))

    if (template) {
      initializedEditorRoute.current = editorRoute
      if (templateStatus(template) === 'APPROVED') {
        setError('Approved templates cannot be edited.')
        navigate('/templates', { replace: true })
        return
      }
      setForm(formFromTemplate(template))
      setEditingId(template.id)
      setSendTarget(null)
      setError('')
      setNotice('')
    } else if (!loading && !error) {
      initializedEditorRoute.current = editorRoute
      setError('Template not found.')
      navigate('/templates', { replace: true })
    }
  }, [editorRoute, error, isEditor, loading, location.state, navigate, templateId, templates])

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
      toast.success(successMessage)
      await load()
      return true
    } catch (requestError) {
      const message = errorMessage(requestError, 'Unable to complete the request.')
      setError(message)
      toast.error(message)
      return false
    } finally {
      setBusy('')
    }
  }

  const sampleValues = useMemo(() => form.variables.reduce((values, row) => {
    if (row.key) values[row.key] = row.value || ''
    return values
  }, {}), [form.variables])

  const filteredTemplates = useMemo(() => {
    const search = query.trim().toLowerCase()

    return templates.filter((template) => {
      const status = templateStatus(template)
      const matchesSearch = !search
        || String(template.name || '').toLowerCase().includes(search)
        || String(template.body_text || '').toLowerCase().includes(search)
      const matchesCategory = !categoryFilter || String(template.category || '').toUpperCase() === categoryFilter
      const matchesStatus = !statusFilter || status === statusFilter

      return matchesSearch && matchesCategory && matchesStatus
    })
  }, [templates, query, categoryFilter, statusFilter])

  const updateVariable = (key, value) => {
    setForm((current) => ({
      ...current,
      variables: current.variables.map((row) => row.key === key ? { ...row, value } : row),
    }))
  }

  const updateBody = (body_text) => {
    setForm((current) => {
      const currentValues = current.variables.reduce((values, row) => {
        values[row.key] = row.value
        return values
      }, {})

      return {
        ...current,
        body_text,
        variables: variableRows(body_text, currentValues),
      }
    })
  }

  const addVariable = () => {
    setForm((current) => {
      const keys = placeholders(current.body_text)
      const numericKeys = keys.map(Number).filter(Number.isInteger)
      let nextKey = Math.max(0, ...numericKeys) + 1
      while (keys.includes(String(nextKey))) nextKey += 1
      const separator = current.body_text && !/\s$/.test(current.body_text) ? ' ' : ''

      return {
        ...current,
        body_text: `${current.body_text}${separator}{{${nextKey}}}`,
        variables: [...current.variables, { key: String(nextKey), value: '' }],
      }
    })
  }

  const openEdit = (template) => {
    navigate(`/templates/${template.id}/edit`, { state: { template } })
  }

  const createRevision = (template) => {
    if (!canManage) return
    navigate('/templates/create', { state: { revisionOf: template } })
  }

  const saveTemplate = async (event) => {
    event.preventDefault()
    if (!canManage) return
    const buttonLabels = form.buttons.split('\n').map((value) => value.trim()).filter(Boolean)
    if (buttonLabels.length > 3) {
      setError('WhatsApp templates can have up to 3 quick-reply buttons.')
      return
    }

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
      buttons: buttonLabels,
      sample_values: sampleValues,
    }
    const isEditing = editingId !== null
    const done = await run(
      isEditing ? `update-${editingId}` : 'create',
      () => isEditing
        ? api.patch(`/api/app/whatsapp/templates/${editingId}`, payload)
        : api.post('/api/app/whatsapp/templates', payload),
      isEditing ? 'Template updated.' : 'Template created. Submit it to Meta for review.',
    )
    if (done) {
      setForm(blankForm())
      setEditingId(null)
      navigate('/templates')
    }
  }

  const uploadHeader = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !canManage) return

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
      setNotice('Header media uploaded to Meta.')
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to upload template media.'))
    } finally {
      setBusy('')
    }
  }

  const sync = () => {
    if (!canManage) return Promise.resolve(false)
    return run('sync', () => api.post('/api/app/whatsapp/templates/sync'), 'Templates synced from Meta.')
  }

  const submitTemplate = (template) => {
    if (!canManage) return Promise.resolve(false)
    return run(
      `submit-${template.id}`,
      () => api.post(`/api/app/whatsapp/templates/${template.id}/submit`),
      `Template "${template.name}" submitted to Meta.`,
    )
  }

  const deleteTemplate = (template) => {
    if (!canManage) return
    setError('')
    setNotice('')
    setDeleteTarget(template)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const template = deleteTarget
    const done = await run(`delete-${template.id}`, async () => {
      await api.delete(`/api/app/whatsapp/templates/${template.id}`)
      if (editingId === template.id) {
        setForm(blankForm())
        setEditingId(null)
        navigate('/templates')
      }
    }, 'Template deleted.')
    if (done) setDeleteTarget(null)
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
    if (!canManage) return
    if (!sendTarget) {
      setError('Choose a template before sending.')
      return
    }
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
        title={isEditor ? (editingId ? 'Edit template' : 'Create template') : 'Message Templates'}
        subtitle={isEditor
          ? location.state?.revisionOf
            ? `Create a new draft based on ${location.state.revisionOf.name}; it will need Meta approval.`
            : 'Create your template and preview it as you work.'
          : 'Create, submit and send approved WhatsApp message templates.'}
        actions={isEditor ? (
          <button type="button" className="button button-secondary" onClick={() => navigate('/templates')}>
            Back to templates
          </button>
        ) : (
          <button type="button" className="button button-primary" onClick={() => navigate('/templates/create')} disabled={!canManage}>
            <Icon name="plus" size={15} /> New template
          </button>
        )}
      />
      {!canManage && <div className="alert alert-info">Only administrators can create, submit, sync, send, or delete message templates.</div>}
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      <div className={`templates-layout${isEditor ? ' template-editor-layout' : ''}${sendTarget && !isEditor ? ' has-send-target' : ''}`}>
        {!isEditor && (
        <section className="card template-library">
          <header className="panel-header">
            <h2>Templates <span className="template-count">{templates.length}</span></h2>
            <button type="button" className="button button-sm button-secondary" onClick={sync} disabled={busy === 'sync' || !canManage}><Icon name="sync" size={15} /> Sync from Meta</button>
          </header>
          <div className="template-tools">
            <label className="search-wrap">
              <Icon name="search" size={16} />
              <input
                className="input search-input"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name or message..."
                aria-label="Search templates"
              />
            </label>
            <select className="select" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Filter by category">
              <option value="">All categories</option>
              {categories.map((category) => <option value={category} key={category}>{category}</option>)}
            </select>
            <select className="select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by approval status">
              <option value="">All statuses</option>
              {Object.entries(statuses).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </div>
          <div className="template-list">
            {loading && <div className="list-placeholder"><span className="spinner" /> Loading templates...</div>}
            {!loading && filteredTemplates.map((template) => {
              const status = templateStatus(template)
              const approved = status === 'APPROVED'
              return (
                <article className={`template-card${editingId === template.id ? ' is-editing' : ''}`} key={template.id}>
                  <header className="template-card-head">
                    <div>
                      <h3 className="template-name">{template.name}</h3>
                      <div className="template-meta">
                        {template.category || 'UTILITY'} · {template.language || 'en_US'}
                        {template.quality_score && ` · Quality ${template.quality_score.toLowerCase()}`}
                      </div>
                    </div>
                    <span className={`badge badge-${status.toLowerCase()}`}>{statuses[status] || status}</span>
                  </header>
                  <p className="template-preview">{renderTemplate(template.body_text, previewValues(template.body_text, template.sample_values || {}))}</p>
                  {status === 'REJECTED' && template.rejection_reason && (
                    <p className="rejection-reason"><Icon name="alert" size={14} /> {template.rejection_reason}</p>
                  )}
                  <div className="template-synced">
                    Updated {relativeTime(template.updated_at || template.last_synced_at) || 'recently'}
                  </div>
                  <footer className="template-actions">
                    {approved && (
                      <button type="button" className="button button-sm button-ghost" onClick={() => createRevision(template)} disabled={!canManage}>
                        Create revision
                      </button>
                    )}
                    {!approved && (
                      <button type="button" className="button button-sm button-secondary" onClick={() => submitTemplate(template)} disabled={busy === `submit-${template.id}` || !canManage}>
                        Submit to Meta
                      </button>
                    )}
                    {!approved && (
                      <button type="button" className="button button-sm button-ghost" onClick={() => openEdit(template)} disabled={busy !== '' || !canManage}>
                        <Icon name="edit" size={14} /> Edit
                      </button>
                    )}
                    <button type="button" className="button button-sm button-secondary" onClick={() => openSend(template)} disabled={!approved || !contacts.length || !canManage}>
                      <Icon name="send" size={14} /> Send
                    </button>
                    <button type="button" className="button button-sm button-ghost" onClick={() => deleteTemplate(template)} disabled={busy === `delete-${template.id}` || !canManage} aria-label={`Delete ${template.name}`}>
                      <Icon name="trash" size={15} />
                    </button>
                  </footer>
                </article>
              )
            })}
            {!loading && !filteredTemplates.length && (
              <div className="list-placeholder">
                {templates.length ? 'No templates match these filters.' : 'No templates yet. Create one or sync from Meta.'}
              </div>
            )}
          </div>
          {!loading && templates.length > 0 && (
            <div className="template-list-footer">Showing {filteredTemplates.length} of {templates.length} templates</div>
          )}
        </section>
        )}

        {isEditor && (
          <div className="template-editor-preview">
            <TemplatePreview
              name={form.name}
              category={form.category}
              language={form.language}
              body={form.body_text}
              header={form.header_text}
              footer={form.footer_text}
              values={sampleValues}
              mediaType={form.header_type}
              mediaUrl={headerPreviewUrl}
              mediaName={form.header_file?.name || (form.header_handle ? 'Previously uploaded media' : '')}
              buttons={form.buttons}
            />
          </div>
        )}
        <div className="template-side">
          {isEditor && (
          <section className="card template-form">
            <header className="panel-header template-form-header">
              <div>
                <h2>{editingId ? 'Edit template' : 'Create template'}</h2>
                <p>{editingId ? `Editing ${form.name}` : 'Build and preview your WhatsApp message.'}</p>
              </div>
              {editingId && <span className="badge badge-pending">Draft changes</span>}
            </header>
            <form onSubmit={saveTemplate}>
              <section className="template-form-section">
                <h3>Template details</h3>
                <div className="form-grid">
                  <div className="field">
                    <label className="field-label" htmlFor="template-name">Template name</label>
                    <input
                      id="template-name"
                      className="input"
                      required
                      pattern="[a-z0-9_]+"
                      title="Use lowercase letters, numbers, and underscores only."
                      value={form.name}
                      onChange={(event) => setForm({ ...form, name: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="template-category">Category</label>
                    <select id="template-category" className="select" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
                      {categories.map((category) => <option value={category} key={category}>{category}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="template-language">Language</label>
                    <input id="template-language" className="input" required value={form.language} onChange={(event) => setForm({ ...form, language: event.target.value })} />
                    <span className="field-hint">Example: en_US</span>
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="template-header-type">Header type <span className="muted">(optional)</span></label>
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
                    <div className="field field-full">
                      <label className="field-label" htmlFor="template-header-text">Header text</label>
                      <input id="template-header-text" className="input" maxLength="60" value={form.header_text} onChange={(event) => setForm({ ...form, header_text: event.target.value })} />
                    </div>
                  )}
                  {mediaHeaderTypes.includes(form.header_type) && (
                    <div className="field field-full template-media-upload">
                      <label className="field-label" htmlFor="template-header-file">{form.header_type.toLowerCase()} header media</label>
                      <input
                        id="template-header-file"
                        className="input"
                        type="file"
                        accept={headerAccept[form.header_type]}
                        onChange={uploadHeader}
                        disabled={busy === 'header-media' || !canManage}
                      />
                      <span className="field-hint">
                        {busy === 'header-media' ? 'Uploading to Meta...' : 'Choose a file and upload it to Meta before saving.'}
                      </span>
                      {(form.header_file || form.header_handle) && (
                        <div className="template-media-preview">
                          {headerPreviewUrl && form.header_type === 'IMAGE'
                            ? <img src={headerPreviewUrl} alt="Selected header" />
                            : headerPreviewUrl && form.header_type === 'VIDEO'
                              ? <video src={headerPreviewUrl} controls />
                              : <Icon name={form.header_type.toLowerCase()} size={20} />}
                          <span>{form.header_file?.name || 'Previously uploaded Meta media'}</span>
                          {form.header_file && (
                            <button
                              type="button"
                              className="icon-button"
                              aria-label="Remove header file"
                              onClick={() => setForm((current) => ({ ...current, header_file: null, header_handle: '' }))}
                            >
                              <Icon name="close" size={15} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>

              <section className="template-form-section">
                <h3>Message content</h3>
                <div className="field">
                  <label className="field-label" htmlFor="template-body">Message body</label>
                  <textarea id="template-body" className="textarea" rows="4" maxLength="4096" required value={form.body_text} onChange={(event) => updateBody(event.target.value)} />
                  <span className="field-hint">Use placeholders such as {'{{1}}'} and {'{{2}}'}.</span>
                </div>
                <div className="form-grid">
                  <div className="field">
                    <label className="field-label" htmlFor="template-footer">Footer <span className="muted">(optional)</span></label>
                    <input id="template-footer" className="input" maxLength="2048" value={form.footer_text} onChange={(event) => setForm({ ...form, footer_text: event.target.value })} />
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="template-buttons">Buttons <span className="muted">(optional)</span></label>
                    <textarea id="template-buttons" className="textarea" rows="2" maxLength="400" value={form.buttons} onChange={(event) => setForm({ ...form, buttons: event.target.value })} placeholder="One button label per line" />
                    <span className="field-hint">Up to 3 quick-reply buttons.</span>
                  </div>
                </div>
              </section>

              <section className="variables-editor">
                <div className="variables-head">
                  <div>
                    <strong>Variables &amp; sample values</strong>
                    <p>These values appear only in the preview.</p>
                  </div>
                  <button type="button" className="button button-sm button-secondary" onClick={addVariable} disabled={!canManage}><Icon name="plus" size={14} /> Add variable</button>
                </div>
                {form.variables.length ? form.variables.map((row) => (
                  <div className="var-row" key={row.key}>
                    <span className="variable-token">{`{{${row.key}}}`}</span>
                    <input className="input" placeholder={row.key === '1' ? 'Sample name' : 'Sample value'} aria-label={`Sample value for variable ${row.key}`} value={row.value} onChange={(event) => updateVariable(row.key, event.target.value)} />
                  </div>
                )) : <p className="variables-empty">Add a placeholder to the body to provide its sample value.</p>}
              </section>

              <div className="template-form-actions">
                {editingId && <button type="button" className="button button-secondary" onClick={() => navigate('/templates')}>Cancel edit</button>}
                <button
                  className="button button-primary"
                  type="submit"
                  disabled={
                    busy === 'create'
                    || busy === `update-${editingId}`
                    || busy === 'header-media'
                    || !canManage
                    || (mediaHeaderTypes.includes(form.header_type) && !form.header_handle)
                  }
                >
                  {busy === 'create' || busy === `update-${editingId}`
                    ? 'Saving...'
                    : editingId ? 'Update template' : 'Create template'}
                </button>
              </div>
            </form>
          </section>
          )}

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
                <button type="button" className="button button-primary" onClick={sendTemplate} disabled={!sendContact || busy === `send-${sendTarget.id}` || !canManage}>
                  {busy === `send-${sendTarget.id}` ? 'Sending...' : 'Send template'}
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete message template?"
        message={deleteTarget ? `“${deleteTarget.name}” will be removed from Aayojan AI CRM. This does not delete it from Meta.` : ''}
        confirmLabel="Delete template"
        busy={busy.startsWith('delete-')}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  )
}
