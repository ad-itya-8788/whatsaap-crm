import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client.js'
import PageHeader from '../components/common/PageHeader.jsx'
import Icon from '../components/common/Icon.jsx'
import ConfirmDialog from '../components/common/ConfirmDialog.jsx'
import ContactDetail from '../components/contacts/ContactDetail.jsx'
import { useToast } from '../components/common/ToastProvider.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { errorMessage, extractList, extractPaginator } from '../lib/utils.js'

const blankContact = { name: '', phone: '', email: '', company: '' }
const blankConsentForm = { status: '', source: '', note: '' }
const consentStatuses = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'opted_in', label: 'Opted in' },
  { value: 'opted_out', label: 'Opted out' },
]

function consentLabel(status) {
  const found = consentStatuses.find((item) => item.value === status)
  return found ? found.label : 'Unknown'
}

function fieldOptions(field) {
  if (Array.isArray(field?.options)) return field.options
  return String(field?.options || '').split(',').map((option) => option.trim()).filter(Boolean)
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function ImportResult({ result }) {
  if (!result) return null
  const errors = Array.isArray(result.errors) ? result.errors : []
  return (
    <div className="alert alert-info alert-inline import-result">
      <div>Processed {result.total ?? 0} rows · imported {result.imported ?? 0} · updated {result.updated ?? 0} · skipped {result.skipped ?? 0}</div>
      {errors.length > 0 && (
        <ul>
          {errors.slice(0, 5).map((issue, index) => (
            <li key={`${issue.row ?? index}-${index}`}>Row {issue.row ?? '?'}: {issue.message || 'Invalid row'}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function ContactsPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const readOnly = user?.role === 'viewer'
  const [contacts, setContacts] = useState([])
  const [contactStats, setContactStats] = useState(null)
  const [conversations, setConversations] = useState([])
  const [tags, setTags] = useState([])
  const [customFields, setCustomFields] = useState([])
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedTagIds, setSelectedTagIds] = useState([])
  const [consentFilter, setConsentFilter] = useState('')
  const [fieldFilterId, setFieldFilterId] = useState('')
  const [fieldFilterValue, setFieldFilterValue] = useState('')
  const [page, setPage] = useState(1)
  const [paginator, setPaginator] = useState({ currentPage: 1, lastPage: 1, total: 0 })
  const [form, setForm] = useState(blankContact)
  const [formTagIds, setFormTagIds] = useState([])
  const [customValues, setCustomValues] = useState({})
  const [consentForm, setConsentForm] = useState(blankConsentForm)
  const [editing, setEditing] = useState(null)
  const [editingContact, setEditingContact] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [detailContact, setDetailContact] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [dryRun, setDryRun] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)

  const buildParams = useCallback((withPaging = true) => {
    const params = {}
    if (debouncedSearch) params.search = debouncedSearch
    if (consentFilter) params.consent_status = consentFilter
    if (fieldFilterId && fieldFilterValue) {
      params.field_id = fieldFilterId
      params.field_value = fieldFilterValue
    }
    if (selectedTagIds.length) params['tag_ids[]'] = selectedTagIds
    if (withPaging) {
      params.page = page
      params.per_page = 25
    }
    return params
  }, [debouncedSearch, consentFilter, fieldFilterId, fieldFilterValue, selectedTagIds, page])

  const loadContacts = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/api/app/contacts', { params: buildParams() })
      setContacts(extractList(data))
      setPaginator(extractPaginator(data))
      if (data?.stats) {
        setContactStats({
          total: Number(data.stats.total ?? 0),
          opted_in: Number(data.stats.opted_in ?? 0),
          opted_out: Number(data.stats.opted_out ?? 0),
          unknown: Number(data.stats.unknown ?? 0),
        })
      }
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to load contacts.'))
    } finally {
      setLoading(false)
    }
  }, [buildParams])

  const loadMeta = useCallback(async () => {
    try {
      const [tagResult, fieldResult] = await Promise.all([
        api.get('/api/app/tags'),
        api.get('/api/app/custom-fields'),
      ])
      setTags(extractList(tagResult.data))
      setCustomFields(extractList(fieldResult.data).filter((field) => field.is_active !== false))
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to load tags and custom fields.'))
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => { loadContacts() }, [loadContacts])
  useEffect(() => { loadMeta() }, [loadMeta])

  useEffect(() => {
    api.get('/api/app/conversations')
      .then(({ data }) => setConversations(extractList(data)))
      .catch(() => {})
  }, [])

  const changeFilter = (setter, value) => {
    setter(value)
    setPage(1)
  }

  const toggleFilterTag = (id) => {
    changeFilter(
      setSelectedTagIds,
      selectedTagIds.includes(id) ? selectedTagIds.filter((tagId) => tagId !== id) : [...selectedTagIds, id],
    )
  }

  const clearFilters = () => {
    setSearch('')
    setDebouncedSearch('')
    setSelectedTagIds([])
    setConsentFilter('')
    setFieldFilterId('')
    setFieldFilterValue('')
    setPage(1)
  }

  const resetForm = () => {
    setForm(blankContact)
    setFormTagIds([])
    setCustomValues({})
    setConsentForm(blankConsentForm)
    setEditing(null)
    setEditingContact(null)
  }

  const startCreate = () => {
    resetForm()
    setShowForm(true)
    setError('')
    setNotice('')
  }

  const startEdit = (contact) => {
    setEditing(contact.id)
    setEditingContact(contact)
    setForm({
      name: contact.name || '',
      phone: contact.phone || contact.phone_normalized || '',
      email: contact.email || '',
      company: contact.company || '',
    })
    setFormTagIds((contact.tags || []).map((tag) => tag.id))
    setCustomValues({ ...(contact.custom_fields || {}) })
    setConsentForm({ status: contact.consent_status || '', source: '', note: '' })
    setShowForm(true)
    setError('')
    setNotice('')
  }

  const customFieldPayload = () => {
    const values = {}
    customFields.forEach((field) => {
      const raw = customValues[field.id] ?? ''
      if (field.type === 'checkbox') values[field.id] = Boolean(raw)
      else if (field.type === 'number') values[field.id] = raw === '' ? null : Number(raw)
      else values[field.id] = raw
    })
    return values
  }

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const custom = customFieldPayload()
      const base = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        company: form.company.trim(),
        custom_fields: custom,
      }
      let contactId = editing
      if (editing) {
        await api.patch(`/api/app/contacts/${editing}`, base)
      } else {
        const { data } = await api.post('/api/app/contacts', base)
        const created = data?.contact || data?.data || data
        contactId = created?.id
      }
      if (!contactId) throw new Error('Contact saved, but its id was missing. Tags and consent could not be synchronized.')
      await api.put(`/api/app/contacts/${contactId}/tags`, { tags: formTagIds })
      if (editing && consentForm.status && (
        consentForm.status !== editingContact?.consent_status || consentForm.source.trim() || consentForm.note.trim()
      )) {
        await api.post(`/api/app/contacts/${contactId}/consent`, {
          status: consentForm.status,
          ...(consentForm.source.trim() ? { source: consentForm.source.trim() } : {}),
          ...(consentForm.note.trim() ? { note: consentForm.note.trim() } : {}),
        })
      }
      setShowForm(false)
      resetForm()
      setNotice(editing ? 'Contact updated.' : 'Contact added.')
      toast.success(editing ? 'Contact updated.' : 'Contact added.')
      await loadContacts()
    } catch (requestError) {
      const message = errorMessage(requestError, 'Unable to save contact.')
      setError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  const remove = (contact) => {
    setError('')
    setNotice('')
    setDeleteTarget(contact)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const contact = deleteTarget
    setError('')
    setNotice('')
    try {
      await api.delete(`/api/app/contacts/${contact.id}`)
      setNotice('Contact deleted.')
      toast.success('Contact deleted.')
      setDeleteTarget(null)
      await loadContacts()
    } catch (requestError) {
      const message = errorMessage(requestError, 'Unable to delete contact.')
      setError(message)
      toast.error(message)
    }
  }

  const openChat = async (contact) => {
    setError('')
    const existing = conversations.find((item) => String(item.contact?.id ?? item.contact_id) === String(contact.id))
    if (existing) {
      navigate(`/inbox?c=${existing.id}`)
      return
    }
    try {
      const { data } = await api.post('/api/app/conversations/start', { contact_id: contact.id })
      const created = data?.conversation || data?.data || data
      if (!created?.id) throw new Error('The conversation response did not include an id.')
      setConversations((items) => [...items, created])
      navigate(`/inbox?c=${created.id}`)
    } catch (requestError) {
      const message = errorMessage(requestError, 'Unable to open a conversation for this contact.')
      setError(message)
      toast.error(message)
    }
  }

  const exportContacts = async () => {
    setExporting(true)
    setError('')
    setNotice('')
    try {
      const response = await api.get('/api/app/contacts/export', {
        params: buildParams(false),
        responseType: 'blob',
      })
      const disposition = String(response.headers?.['content-disposition'] || '')
      const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)
      const filename = match ? decodeURIComponent(match[1]) : 'contacts.csv'
      downloadBlob(new Blob([response.data], { type: 'text/csv;charset=utf-8' }), filename)
      setNotice('Contacts exported.')
      toast.success('Contacts exported.')
    } catch (requestError) {
      const message = errorMessage(requestError, 'Unable to export contacts.')
      setError(message)
      toast.error(message)
    } finally {
      setExporting(false)
    }
  }

  const downloadTemplate = () => {
    const csv = 'name,phone,email,company,tags,consent_status\n'
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'contacts-template.csv')
  }

  const uploadImport = async () => {
    if (!importFile) {
      setError('Choose a CSV file to import.')
      return
    }
    setImporting(true)
    setError('')
    setNotice('')
    setImportResult(null)
    const payload = new FormData()
    payload.append('file', importFile)
    if (dryRun) payload.append('dry_run', '1')
    try {
      const { data } = await api.post('/api/app/contacts/import', payload)
      const result = data?.data && typeof data.data === 'object' && !Array.isArray(data.data) ? data.data : data
      setImportResult(result || {})
      setNotice(dryRun ? 'Dry run completed. No changes were saved.' : 'Contacts imported.')
      toast.success(dryRun ? 'Dry run completed. No changes were saved.' : 'Contacts imported.')
      await loadContacts()
    } catch (requestError) {
      const message = errorMessage(requestError, 'Unable to import contacts.')
      setError(message)
      toast.error(message)
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Contacts"
        subtitle="Manage contacts, tags, consent and WhatsApp conversations."
        actions={
          <>
            <button type="button" className="button button-secondary" onClick={exportContacts} disabled={exporting}><Icon name="download" size={16} /> {exporting ? 'Exporting...' : 'Export'}</button>
            {!readOnly && <button type="button" className="button button-secondary" onClick={() => { setShowImport((current) => !current); setError(''); setNotice('') }}><Icon name="plus" size={16} /> Import CSV</button>}
            {!readOnly && <button type="button" className="button button-primary" onClick={startCreate}><Icon name="plus" size={16} /> Add contact</button>}
          </>
        }
      />
      <section className="contacts-stats" aria-label="Contact consent summary">
        {[
          { key: 'total', label: 'Total Contacts', icon: '#', className: 'contact-stat-total' },
          { key: 'opted_in', label: 'Opted In', icon: '✓', className: 'contact-stat-opted-in' },
          { key: 'opted_out', label: 'Opted Out', icon: '×', className: 'contact-stat-opted-out' },
          { key: 'unknown', label: 'Unknown', icon: '?', className: 'contact-stat-unknown' },
        ].map((stat) => (
          <article className={`contact-stat-card ${stat.className}`} key={stat.key}>
            <span className="stat-icon" aria-hidden="true">{stat.icon}</span>
            <div className="stat-copy">
              <span className="stat-label">{stat.label}</span>
              <strong className="stat-value">{contactStats ? contactStats[stat.key].toLocaleString() : '—'}</strong>
            </div>
          </article>
        ))}
      </section>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      {showImport && (
        <section className="card import-panel">
          <header className="panel-header">
            <h2>Import contacts</h2>
            <button type="button" className="icon-button" onClick={() => setShowImport(false)} aria-label="Close import panel"><Icon name="close" size={18} /></button>
          </header>
          <div className="form-grid">
            <div className="field">
              <label className="field-label" htmlFor="contact-import-file">CSV file</label>
              <input id="contact-import-file" className="input" type="file" accept=".csv,text/csv" onChange={(event) => setImportFile(event.target.files?.[0] || null)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="contact-import-dry-run">Validation only</label>
              <label className="checkbox-label" htmlFor="contact-import-dry-run">
                <input id="contact-import-dry-run" type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} /> Dry run (do not save)
              </label>
            </div>
          </div>
          <div className="settings-actions">
            <button type="button" className="button button-primary" onClick={uploadImport} disabled={importing || !importFile}>{importing ? 'Uploading...' : 'Upload'}</button>
            <button type="button" className="button button-secondary" onClick={downloadTemplate}><Icon name="download" size={15} /> Download template</button>
          </div>
          <ImportResult result={importResult} />
        </section>
      )}

      {showForm && (
        <section className="card contact-form">
          <header className="panel-header">
            <h2>{editing ? 'Edit contact' : 'New contact'}</h2>
            <button type="button" className="icon-button" onClick={() => setShowForm(false)} aria-label="Close form"><Icon name="close" size={18} /></button>
          </header>
          <form onSubmit={submit}>
            <div className="form-grid">
              <div className="field">
                <label className="field-label" htmlFor="contact-name">Name</label>
                <input id="contact-name" className="input" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="contact-phone">Phone</label>
                <input id="contact-phone" className="input" type="tel" required value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="contact-email">Email</label>
                <input id="contact-email" className="input" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="contact-company">Company</label>
                <input id="contact-company" className="input" value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} />
              </div>
            </div>
            <div className="field contact-tags-field">
              <span className="field-label">Tags</span>
              <div className="tag-picker">
                {tags.map((tag) => (
                  <button
                    type="button"
                    key={tag.id}
                    className={`tag-chip${formTagIds.includes(tag.id) ? ' is-selected' : ''}`}
                    style={{ backgroundColor: tag.color || '#2563eb' }}
                    aria-pressed={formTagIds.includes(tag.id)}
                    onClick={() => setFormTagIds((current) => current.includes(tag.id) ? current.filter((id) => id !== tag.id) : [...current, tag.id])}
                  >
                    {tag.name}
                  </button>
                ))}
                {!tags.length && <span className="muted">No tags available yet.</span>}
              </div>
            </div>
            {customFields.length > 0 && (
              <div className="field custom-field-section">
                <h3 className="settings-section-title">Custom fields</h3>
                <div className="custom-field-grid">
                  {customFields.map((field) => (
                    <div className="field" key={field.id}>
                      <label className="field-label" htmlFor={`custom-field-${field.id}`}>{field.label || field.name}{field.required ? ' *' : ''}</label>
                      {field.type === 'select' ? (
                        <select
                          id={`custom-field-${field.id}`}
                          className="select"
                          required={field.required}
                          value={customValues[field.id] ?? ''}
                          onChange={(event) => setCustomValues({ ...customValues, [field.id]: event.target.value })}
                        >
                          <option value="">Select...</option>
                          {fieldOptions(field).map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                      ) : field.type === 'checkbox' ? (
                        <input
                          id={`custom-field-${field.id}`}
                          type="checkbox"
                          checked={Boolean(customValues[field.id])}
                          onChange={(event) => setCustomValues({ ...customValues, [field.id]: event.target.checked })}
                        />
                      ) : (
                        <input
                          id={`custom-field-${field.id}`}
                          className="input"
                          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                          required={field.required}
                          value={customValues[field.id] ?? ''}
                          onChange={(event) => setCustomValues({ ...customValues, [field.id]: event.target.value })}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {editing && (
              <div className="field consent-editor">
                <h3 className="settings-section-title">Consent</h3>
                <div className="form-grid">
                  <div className="field">
                    <label className="field-label" htmlFor="contact-consent-status">Status</label>
                    <select id="contact-consent-status" className="select" value={consentForm.status} onChange={(event) => setConsentForm({ ...consentForm, status: event.target.value })}>
                      <option value="">Keep current status</option>
                      {consentStatuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="contact-consent-source">Source</label>
                    <input id="contact-consent-source" className="input" placeholder="e.g. website form" value={consentForm.source} onChange={(event) => setConsentForm({ ...consentForm, source: event.target.value })} />
                  </div>
                  <div className="field field-full">
                    <label className="field-label" htmlFor="contact-consent-note">Note</label>
                    <input id="contact-consent-note" className="input" value={consentForm.note} onChange={(event) => setConsentForm({ ...consentForm, note: event.target.value })} />
                  </div>
                </div>
              </div>
            )}
            <div className="settings-actions">
              <button className="button button-primary" disabled={saving}>{saving ? 'Saving...' : 'Save contact'}</button>
              <button type="button" className="button button-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </section>
      )}

      <section className="card contacts-card">
        <div className="card-toolbar">
          <div className="search-wrap search-wide">
            <Icon name="search" size={16} />
            <input
              className="input search-input"
              type="search"
              aria-label="Search contacts"
              placeholder="Search by name or phone..."
              value={search}
              onChange={(event) => changeFilter(setSearch, event.target.value)}
            />
          </div>
          <span className="muted">{paginator.total} contacts</span>
        </div>
        <div className="filter-row">
          <div className="field">
            <span className="field-label">Tags</span>
            <div className="tag-picker">
              {tags.map((tag) => (
                <button
                  type="button"
                  key={tag.id}
                  className={`tag-chip${selectedTagIds.includes(tag.id) ? ' is-selected' : ''}`}
                  style={{ backgroundColor: tag.color || '#2563eb' }}
                  aria-pressed={selectedTagIds.includes(tag.id)}
                  onClick={() => toggleFilterTag(tag.id)}
                >
                  {tag.name}
                </button>
              ))}
              {!tags.length && <span className="muted">No tags</span>}
            </div>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="contact-consent-filter">Consent</label>
            <select id="contact-consent-filter" className="select" value={consentFilter} onChange={(event) => changeFilter(setConsentFilter, event.target.value)}>
              <option value="">All</option>
              {consentStatuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="contact-field-filter">Custom field</label>
            <select id="contact-field-filter" className="select" value={fieldFilterId} onChange={(event) => changeFilter(setFieldFilterId, event.target.value)}>
              <option value="">Any field</option>
              {customFields.map((field) => <option key={field.id} value={field.id}>{field.label || field.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="contact-field-value">Field value</label>
            <input
              id="contact-field-value"
              className="input"
              placeholder="Value"
              disabled={!fieldFilterId}
              value={fieldFilterValue}
              onChange={(event) => changeFilter(setFieldFilterValue, event.target.value)}
            />
          </div>
          <button type="button" className="button button-sm button-ghost filter-clear" onClick={clearFilters}>Clear filters</button>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Name</th><th>Phone</th><th>Email / Company</th><th>WhatsApp ID</th><th>Tags</th><th>Consent</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr key={contact.id}>
                  <td>
                    <button type="button" className="link-button" onClick={() => setDetailContact(contact)}>
                      {contact.name || 'Unnamed contact'}
                    </button>
                  </td>
                  <td>{contact.phone || contact.phone_normalized || '—'}</td>
                  <td>
                    <div>{contact.email || '—'}</div>
                    {contact.company && <div className="muted">{contact.company}</div>}
                  </td>
                  <td>{contact.wa_user_id ? <span className="wa-id">{contact.wa_user_id}</span> : '—'}</td>
                  <td>
                    <div className="contact-tags">
                      {(contact.tags || []).map((tag) => (
                        <span key={tag.id} className="tag-chip" style={{ backgroundColor: tag.color || '#2563eb' }}>{tag.name}</span>
                      ))}
                      {!contact.tags?.length && '—'}
                    </div>
                  </td>
                  <td><span className={`consent-badge consent-${contact.consent_status || 'unknown'}`}>{consentLabel(contact.consent_status)}</span></td>
                  <td>
                    {!readOnly && <div className="actions-cell">
                      <button type="button" className="icon-button" onClick={() => startEdit(contact)} aria-label={`Edit ${contact.name || 'contact'}`}><Icon name="edit" size={16} /></button>
                      <button type="button" className="icon-button is-danger" onClick={() => remove(contact)} aria-label={`Delete ${contact.name || 'contact'}`}><Icon name="trash" size={16} /></button>
                    </div>}
                  </td>
                </tr>
              ))}
              {loading && <tr><td colSpan="7" className="table-empty"><span className="spinner" /> Loading contacts...</td></tr>}
              {!loading && !contacts.length && <tr><td colSpan="7" className="table-empty">{search || consentFilter || fieldFilterValue || selectedTagIds.length ? 'No contacts match these filters.' : 'No contacts yet. Add your first contact to get started.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="pagination">
          <span className="muted">{loading ? 'Loading contacts...' : `Page ${paginator.currentPage} of ${paginator.lastPage}`}</span>
          <div className="pagination-actions">
            <button type="button" className="button button-sm button-secondary" disabled={loading || page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
            <button type="button" className="button button-sm button-secondary" disabled={loading || page >= paginator.lastPage} onClick={() => setPage((value) => value + 1)}>Next</button>
          </div>
        </div>
      </section>
      {detailContact && <ContactDetail
        key={detailContact.id}
        initialContact={detailContact}
        customFields={customFields}
        readOnly={readOnly}
        onClose={() => setDetailContact(null)}
        onEdit={(contact) => { setDetailContact(null); startEdit(contact) }}
        onOpenChat={openChat}
      />}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete contact?"
        message={deleteTarget ? `${deleteTarget.name || deleteTarget.phone || 'This contact'} and its chat history will be removed. This cannot be undone.` : ''}
        confirmLabel="Delete contact"
        busy={false}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  )
}
