import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { router, usePage } from '@inertiajs/react'
import { usePageLocation } from '../lib/navigation.js'
import api from '../api/client.js'
import PageHeader from '../components/common/PageHeader.jsx'
import Icon from '../components/common/Icon.jsx'
import ConfirmDialog from '../components/common/ConfirmDialog.jsx'
import { useToast } from '../components/common/ToastProvider.jsx'
import { createIdempotencyKey, errorMessage, extractList, placeholders, relativeTime } from '../lib/utils.js'
import TemplateCard from '../components/templates/TemplateCard.jsx'
import TemplatePreview from '../components/templates/TemplatePreview.jsx'
import TemplatePreviewModal from '../components/templates/TemplatePreviewModal.jsx'

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
  PENDING_REVIEW: 'Pending review',
  PENDING_DELETION: 'Pending deletion',
  PENDING_DELETE: 'Pending deletion',
  REJECTED: 'Rejected',
  DISAPPROVED: 'Rejected',
  PAUSED: 'Paused',
}

const pendingStatuses = new Set(['PENDING', 'IN_REVIEW', 'PENDING_REVIEW', 'PENDING_DELETION', 'PENDING_DELETE'])
const rejectedStatuses = new Set(['REJECTED', 'DISAPPROVED'])

function templateStatus(template) {
  return String(template?.approval_status || template?.status || 'PENDING').toUpperCase()
}

function isPendingStatus(status) {
  return pendingStatuses.has(status)
}

function isRejectedStatus(status) {
  return rejectedStatuses.has(status)
}

function statusTone(status) {
  if (status === 'APPROVED') return 'approved'
  if (isPendingStatus(status)) return 'pending'
  if (isRejectedStatus(status)) return 'rejected'
  if (status === 'PAUSED') return 'paused'
  if (status === 'DRAFT') return 'draft'
  return 'neutral'
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
    buttons: Array.isArray(template.buttons)
      ? template.buttons.map((button) => (typeof button === 'string' ? button : button?.text || button?.title || '')).filter(Boolean).join('\n')
      : '',
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

const visitTemplates = (url, options) => router.visit(url, { preserveState: true, ...options })

export default function TemplatesPage() {
  const { pathname, search } = usePageLocation()
  const { templateId } = usePage().props
  const revisionId = new URLSearchParams(search).get('revision')
  const isEditor = pathname === '/templates/create' || Boolean(templateId)
  const editorRoute = templateId ? `edit:${templateId}` : `create:${revisionId || ''}`
  const toast = useToast()
  const canManage = true
  const [templates, setTemplates] = useState([])
  const [contacts, setContacts] = useState([])
  const revisionSource = revisionId ? templates.find((item) => String(item.id) === revisionId) : null
  const [form, setForm] = useState(blankForm)
  const [editingId, setEditingId] = useState(null)
  const [query, setQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [languageFilter, setLanguageFilter] = useState('')
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
  const [previewTarget, setPreviewTarget] = useState(null)
  const sendAttempt = useRef(null)
  const initializedEditorRoute = useRef('')

  const load = useCallback(async ({ initial = false } = {}) => {
    if (initial) setLoading(true)
    setError('')
    try {
      const [templateResult, contactResult] = await Promise.all([
        api.get('/api/app/whatsapp/templates'),
        api.get('/api/app/whatsapp/template-contacts').catch(() => ({ data: {} })),
      ])
      setTemplates(extractList(templateResult.data))
      setContacts(extractList(contactResult.data))
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to load message templates.'))
    } finally {
      if (initial) setLoading(false)
    }
  }, [])

  useEffect(() => { load({ initial: true }) }, [load])

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(searchInput.trim()), 200)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    if (!isEditor) {
      initializedEditorRoute.current = ''
      setEditingId(null)
      return
    }

    if (initializedEditorRoute.current === editorRoute) return

    if (!templateId) {
      if (revisionId && !revisionSource) {
        if (!loading && !error) visitTemplates('/templates', { replace: true })
        return
      }
      initializedEditorRoute.current = editorRoute
      setForm(revisionSource
        ? { ...formFromTemplate(revisionSource), name: revisionTemplateName(revisionSource.name, templates) }
        : blankForm())
      setEditingId(null)
      setSendTarget(null)
      setError('')
      setNotice('')
      return
    }

    const template = templates.find((item) => String(item.id) === String(templateId))

    if (template) {
      initializedEditorRoute.current = editorRoute
      if (templateStatus(template) === 'APPROVED') {
        setError('Approved templates cannot be edited.')
        visitTemplates('/templates', { replace: true })
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
      visitTemplates('/templates', { replace: true })
    }
  }, [editorRoute, error, isEditor, loading, revisionId, revisionSource, templateId, templates])

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

  const summary = useMemo(() => ({
    total: templates.length,
    approved: templates.filter((template) => templateStatus(template) === 'APPROVED').length,
    pending: templates.filter((template) => isPendingStatus(templateStatus(template))).length,
    rejected: templates.filter((template) => isRejectedStatus(templateStatus(template))).length,
  }), [templates])

  const categoryOptions = useMemo(() => [...new Set([
    ...categories,
    ...templates.map((template) => String(template.category || '').toUpperCase()).filter(Boolean),
  ])], [templates])

  const languageOptions = useMemo(() => {
    const languages = ['en_US', ...templates.map((template) => String(template.language || '').trim()).filter(Boolean)]
    return [...new Set(languages)]
  }, [templates])

  const filteredTemplates = useMemo(() => {
    const search = query.trim().toLowerCase()

    return templates.filter((template) => {
      const status = templateStatus(template)
      const matchesSearch = !search
        || String(template.name || '').toLowerCase().includes(search)
        || String(template.body_text || '').toLowerCase().includes(search)
      const matchesCategory = !categoryFilter || String(template.category || '').toUpperCase() === categoryFilter
      const matchesLanguage = !languageFilter || String(template.language || '').trim() === languageFilter
      const matchesStatus = !statusFilter
        || (statusFilter === 'PENDING' ? isPendingStatus(status)
          : statusFilter === 'REJECTED' ? isRejectedStatus(status)
            : status === statusFilter)

      return matchesSearch && matchesCategory && matchesLanguage && matchesStatus
    })
  }, [templates, query, categoryFilter, languageFilter, statusFilter])

  const activePreview = useMemo(() => {
    if (!previewTarget) return null
    return templates.find((item) => String(item.id) === String(previewTarget.id)) || previewTarget
  }, [previewTarget, templates])

  const statusTabs = [
    { label: 'All Templates', value: '', count: summary.total },
    { label: 'Approved', value: 'APPROVED', count: summary.approved },
    { label: 'Pending', value: 'PENDING', count: summary.pending },
    { label: 'Rejected', value: 'REJECTED', count: summary.rejected },
  ]

  const summaryCards = [
    { label: 'Total Templates', value: summary.total, icon: 'template', tone: 'primary' },
    { label: 'Approved Templates', value: summary.approved, icon: 'checkCircle', tone: 'success' },
    { label: 'Pending Review', value: summary.pending, icon: 'clock', tone: 'warning' },
    { label: 'Rejected Templates', value: summary.rejected, icon: 'alertCircle', tone: 'danger' },
  ]

  const emptyState = !templates.length
    ? { title: 'No templates yet', description: 'Create a template or sync from Meta to get started.' }
    : statusFilter === 'APPROVED' && !summary.approved
      ? { title: 'No approved templates', description: 'Submit a draft for review or sync approved templates from Meta.' }
      : { title: 'No matching templates', description: 'Try a different search or filter.' }

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
    visitTemplates(`/templates/${template.id}/edit`)
  }

  const createRevision = (template) => {
    if (!canManage) return
    visitTemplates(`/templates/create?revision=${encodeURIComponent(template.id)}`)
  }

  const openPreview = (template) => {
    setPreviewTarget(template)
    setError('')
    setNotice('')
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
      visitTemplates('/templates')
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
    setPreviewTarget(null)
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
        visitTemplates('/templates')
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
    setPreviewTarget(null)
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
          ? revisionSource
            ? `Create a new draft based on ${revisionSource.name}; it will need Meta approval.`
            : 'Create your template and preview it as you work.'
          : 'Create, review, and send WhatsApp message templates.'}
        actions={isEditor ? (
          <button type="button" className="button button-secondary" onClick={() => visitTemplates('/templates')}>
            Back to templates
          </button>
        ) : (
          <>
            <button type="button" className="button button-secondary" onClick={sync} disabled={busy === 'sync' || !canManage}>
              <Icon name="sync" size={16} /> Sync from Meta
            </button>
            <button type="button" className="button button-primary" onClick={() => visitTemplates('/templates/create')} disabled={!canManage}>
              <Icon name="plus" size={16} /> New Template
            </button>
          </>
        )}
      />
      {!canManage && <div className="alert alert-info">Only administrators can create, submit, sync, send, or delete message templates.</div>}
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      {!isEditor && (
        <div className="template-summary" aria-label="Template summary">
          {summaryCards.map((card) => (
            <article className="template-stat" key={card.label}>
              <span className={`template-stat-icon tone-${card.tone}`}><Icon name={card.icon} size={18} /></span>
              <div className="template-stat-copy">
                <span className="template-stat-label">{card.label}</span>
                <strong className="template-stat-value">{card.value}</strong>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className={`templates-layout${isEditor ? ' template-editor-layout' : ''}${sendTarget && !isEditor ? ' has-send-target' : ''}`}>
        {!isEditor && (
          <section className="card template-library">
            <header className="panel-header template-library-header">
              <h2>Template library <span className="template-count">{templates.length}</span></h2>
            </header>
            <div className="template-tabs-wrap">
              <div className="tabs template-status-tabs" role="tablist" aria-label="Filter templates by status">
                {statusTabs.map((tab) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={statusFilter === tab.value}
                    key={tab.label}
                    className={`tab template-status-tab${statusFilter === tab.value ? ' is-active' : ''}`}
                    onClick={() => setStatusFilter(tab.value)}
                  >
                    {tab.label}<span className="tab-count">{tab.count}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="template-tools">
              <label className="search-wrap">
                <Icon name="search" size={16} />
                <input
                  className="input search-input"
                  type="search"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Search name or message..."
                  aria-label="Search templates"
                />
              </label>
              <select className="select" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Filter by category">
                <option value="">All categories</option>
                {categoryOptions.map((category) => <option value={category} key={category}>{category}</option>)}
              </select>
              <select className="select" value={languageFilter} onChange={(event) => setLanguageFilter(event.target.value)} aria-label="Filter by language">
                <option value="">All languages</option>
                {languageOptions.map((language) => <option value={language} key={language}>{language}</option>)}
              </select>
            </div>
            <div className="template-list">
              {loading && (
                <div className="template-loading">
                  <div className="inline-loading template-loading-label"><span className="spinner spinner-sm" /> Loading templates...</div>
                  <div className="template-card-grid" aria-hidden="true">
                    {Array.from({ length: 6 }, (_, index) => (
                      <div className="template-card template-card-skeleton" key={index}>
                        <div className="skeleton skeleton-line short" />
                        <div className="skeleton skeleton-line full" />
                        <div className="skeleton skeleton-block" />
                        <div className="skeleton skeleton-line short" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!loading && !!filteredTemplates.length && (
                <div className="template-card-grid">
                  {filteredTemplates.map((template) => {
                    const status = templateStatus(template)
                    return (
                      <TemplateCard
                        key={template.id}
                        template={template}
                        statusLabel={statuses[status] || status}
                        statusTone={statusTone(status)}
                        canManage={canManage}
                        hasContacts={contacts.length > 0}
                        busy={busy}
                        isEditing={editingId === template.id}
                        onPreview={openPreview}
                        onSend={openSend}
                        onRevision={createRevision}
                        onSubmit={submitTemplate}
                        onEdit={openEdit}
                        onDelete={deleteTemplate}
                      />
                    )
                  })}
                </div>
              )}
              {!loading && !filteredTemplates.length && (
                <div className="empty-state">
                  <Icon name="template" size={20} />
                  <strong>{emptyState.title}</strong>
                  <p>{emptyState.description}</p>
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
                              aria-label="Remove header file" title="Remove header file"
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
                {editingId && <button type="button" className="button button-secondary" onClick={() => visitTemplates('/templates')}>Cancel edit</button>}
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
                <button type="button" className="icon-button" onClick={() => setSendTarget(null)} aria-label="Close send panel" title="Close send panel"><Icon name="close" size={18} /></button>
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

      <TemplatePreviewModal
        template={activePreview}
        statusLabel={activePreview ? statuses[templateStatus(activePreview)] || templateStatus(activePreview) : ''}
        statusTone={activePreview ? statusTone(templateStatus(activePreview)) : 'neutral'}
        canManage={canManage}
        hasContacts={contacts.length > 0}
        busy={busy}
        onClose={() => setPreviewTarget(null)}
        onSend={openSend}
        onRevision={createRevision}
        onSubmit={submitTemplate}
        onEdit={openEdit}
        onDelete={deleteTemplate}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete message template?"
        message={deleteTarget ? `“${deleteTarget.name}” will be removed from Aayojan AI Ping. This does not delete it from Meta.` : ''}
        confirmLabel="Delete template"
        busy={busy.startsWith('delete-')}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  )
}
