import { hasModuleAccess } from '../lib/moduleAccess.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { router } from '@inertiajs/react'
import api from '../api/client.js'
import PageHeader from '../components/common/PageHeader.jsx'
import Icon from '../components/common/Icon.jsx'
import ConfirmDialog from '../components/common/ConfirmDialog.jsx'
import ContactDetail from '../components/contacts/ContactDetail.jsx'
import { useToast } from '../components/common/ToastProvider.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { errorMessage, extractList, extractPaginator, formatDate } from '../lib/utils.js'

const blankContact = { name: '', phone: '', email: '', company: '' }
const emptySummary = { total: 0, with_conversation: 0, recently_added: 0, tags: 0 }

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

function getCount(value) {
  const count = Number(value ?? 0)
  return Number.isFinite(count) && count >= 0 ? count : 0
}

function tagStyle(tag) {
  const color = tag?.color
  if (!color) return undefined

  const match = color.match(/^#([a-f\d]{3}|[a-f\d]{6})$/i)
  if (!match) return { backgroundColor: color }

  const hex = match[1].length === 3
    ? [...match[1]].map((channel) => channel + channel).join('')
    : match[1]
  const channels = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
  const luminance = channels
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0)

  return {
    backgroundColor: color,
    color: luminance > 0.179 ? '#111827' : '#ffffff',
  }
}

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

function contactInitial(contact) {
  const source = String(contact?.name || contact?.phone || contact?.phone_normalized || '?').trim()
  return source ? source.charAt(0).toUpperCase() : '?'
}

function contactLabel(contact) {
  return contact?.name || contact?.phone || contact?.phone_normalized || 'contact'
}

function ImportResult({ result }) {
  if (!result) return null
  const errors = Array.isArray(result.errors) ? result.errors : []
  return (
    <div className="alert alert-info alert-inline import-result">
      <div className="import-result-counts">
        <span>Processed <strong>{getCount(result.total)}</strong></span>
        <span>Imported <strong>{getCount(result.imported)}</strong></span>
        <span>Updated <strong>{getCount(result.updated)}</strong></span>
        <span>Skipped <strong>{getCount(result.skipped)}</strong></span>
      </div>
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
  const toast = useToast()
  const { user } = useAuth()
  const readOnly = false
  const [contacts, setContacts] = useState([])
  const [summary, setSummary] = useState(emptySummary)
  const [tags, setTags] = useState([])
  const [customFields, setCustomFields] = useState([])
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedTagIds, setSelectedTagIds] = useState([])
  const [fieldFilterId, setFieldFilterId] = useState('')
  const [fieldFilterValue, setFieldFilterValue] = useState('')
  const [page, setPage] = useState(1)
  const [paginator, setPaginator] = useState({ currentPage: 1, lastPage: 1, total: 0 })
  const [form, setForm] = useState(blankContact)
  const [formTagIds, setFormTagIds] = useState([])
  const [customValues, setCustomValues] = useState({})
  const [editing, setEditing] = useState(null)
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
  const [deleting, setDeleting] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const [actionMenu, setActionMenu] = useState(null)
  const headerCheckbox = useRef(null)

  const buildParams = useCallback((withPaging = true) => {
    const params = {}
    if (debouncedSearch) params.search = debouncedSearch
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
  }, [debouncedSearch, fieldFilterId, fieldFilterValue, selectedTagIds, page])

  const contactsRequest = useRef(null)

  const loadContacts = useCallback(async () => {
    contactsRequest.current?.abort()
    const controller = new AbortController()
    contactsRequest.current = controller
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/api/app/contacts', { params: buildParams(), signal: controller.signal })
      if (controller.signal.aborted) return
      setContacts(extractList(data))
      setPaginator(extractPaginator(data))
      setSummary({
        total: getCount(data?.summary?.total),
        with_conversation: getCount(data?.summary?.with_conversation),
        recently_added: getCount(data?.summary?.recently_added),
        tags: getCount(data?.summary?.tags),
      })
    } catch (requestError) {
      if (requestError.code !== 'ERR_CANCELED') setError(errorMessage(requestError, 'Unable to load contacts.'))
    } finally {
      if (contactsRequest.current === controller) setLoading(false)
    }
  }, [buildParams])

  const loadMeta = useCallback(async (signal) => {
    try {
      const [tagResult, fieldResult] = await Promise.all([
        api.get('/api/app/tags', { signal }),
        api.get('/api/app/custom-fields', { signal }),
      ])
      setTags(extractList(tagResult.data))
      setCustomFields(extractList(fieldResult.data).filter((field) => field.is_active !== false))
    } catch (requestError) {
      if (requestError.code !== 'ERR_CANCELED') setError(errorMessage(requestError, 'Unable to load tags and custom fields.'))
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
      setSelectedIds([])
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    const timer = window.setTimeout(loadContacts, 0)
    return () => {
      window.clearTimeout(timer)
      contactsRequest.current?.abort()
      contactsRequest.current = null
    }
  }, [loadContacts])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => loadMeta(controller.signal), 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [loadMeta])

  useEffect(() => {
    if (!showForm) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !saving) setShowForm(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showForm, saving])

  useEffect(() => {
    if (!actionMenu) return undefined
    const close = (event) => {
      if (event.type === 'keydown') {
        if (event.key === 'Escape') setActionMenu(null)
        return
      }
      if (event.target instanceof Element && event.target.closest('.contacts-action-menu, .contacts-more-button')) return
      setActionMenu(null)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [actionMenu])

  const selectedOnPage = contacts.filter((contact) => selectedIds.includes(contact.id))
  const allOnPageSelected = contacts.length > 0 && selectedOnPage.length === contacts.length
  const someOnPageSelected = selectedOnPage.length > 0 && !allOnPageSelected

  useEffect(() => {
    if (headerCheckbox.current) headerCheckbox.current.indeterminate = someOnPageSelected
  }, [someOnPageSelected, contacts])

  const changeFilter = (setter, value) => {
    setter(value)
    setPage(1)
    setSelectedIds([])
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
    setFieldFilterId('')
    setFieldFilterValue('')
    setPage(1)
    setSelectedIds([])
  }

  const goToPage = (nextPage) => {
    setPage(nextPage)
    setSelectedIds([])
  }

  const toggleSelectAll = () => {
    setSelectedIds(allOnPageSelected ? [] : contacts.map((contact) => contact.id))
  }

  const toggleSelect = (id) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id])
  }

  const resetForm = () => {
    setForm(blankContact)
    setFormTagIds([])
    setCustomValues({})
    setEditing(null)
  }

  const startCreate = () => {
    resetForm()
    setShowForm(true)
    setError('')
    setNotice('')
    setActionMenu(null)
  }

  const startEdit = (contact) => {
    setEditing(contact.id)
    setForm({
      name: contact.name || '',
      phone: contact.phone || contact.phone_normalized || '',
      email: contact.email || '',
      company: contact.company || '',
    })
    setFormTagIds((contact.tags || []).map((tag) => tag.id))
    setCustomValues({ ...(contact.custom_fields || {}) })
    setShowForm(true)
    setError('')
    setNotice('')
    setActionMenu(null)
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
    if (saving) return
    const wasEditing = Boolean(editing)
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
      if (!contactId) throw new Error('Contact saved, but its id was missing. Tags could not be synchronized.')
      await api.put(`/api/app/contacts/${contactId}/tags`, { tags: formTagIds })
      setShowForm(false)
      resetForm()
      setNotice(wasEditing ? 'Contact updated.' : 'Contact added.')
      toast.success(wasEditing ? 'Contact updated.' : 'Contact added.')
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
    setDeleteTarget({ kind: 'single', contact })
    setActionMenu(null)
  }

  const requestBulkDelete = () => {
    if (readOnly || !selectedIds.length || deleting) return
    setError('')
    setNotice('')
    setDeleteTarget({ kind: 'bulk', ids: [...selectedIds] })
  }

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return
    const target = deleteTarget
    setDeleting(true)
    setError('')
    setNotice('')
    let failureMessage = ''
    try {
      if (target.kind === 'bulk') {
        const results = await Promise.allSettled(target.ids.map((id) => api.delete(`/api/app/contacts/${id}`)))
        const failedIds = target.ids.filter((id, index) => results[index].status === 'rejected')
        const deleted = target.ids.length - failedIds.length
        setSelectedIds(failedIds)
        if (deleted > 0) {
          const message = `Deleted ${deleted} contact${deleted === 1 ? '' : 's'}.`
          setNotice(message)
          toast.success(message)
        }
        if (failedIds.length) {
          failureMessage = `Could not delete ${failedIds.length} selected contact${failedIds.length === 1 ? '' : 's'}.`
          toast.error(failureMessage)
        }
      } else {
        const contact = target.contact
        await api.delete(`/api/app/contacts/${contact.id}`)
        setSelectedIds((current) => current.filter((id) => id !== contact.id))
        setNotice('Contact deleted.')
        toast.success('Contact deleted.')
      }
      setDeleteTarget(null)
      await loadContacts()
      if (failureMessage) setError(failureMessage)
    } catch (requestError) {
      const message = errorMessage(requestError, 'Unable to delete contact.')
      setError(message)
      toast.error(message)
    } finally {
      setDeleting(false)
    }
  }

  const openChat = async (contact) => {
    setError('')
    if (contact.conversation_id) {
      router.visit(`/inbox?c=${contact.conversation_id}`)
      return
    }
    try {
      const { data } = await api.post('/api/app/conversations/start', { contact_id: contact.id })
      const created = data?.conversation || data?.data || data
      if (!created?.id) throw new Error('The conversation response did not include an id.')
      router.visit(`/inbox?c=${created.id}`)
    } catch (requestError) {
      const message = errorMessage(requestError, 'Unable to open a conversation for this contact.')
      setError(message)
      toast.error(message)
    }
  }

  const copyPhone = async (contact) => {
    const value = contact.phone || contact.phone_normalized
    if (!value) {
      toast.error('No phone number to copy.')
      return
    }
    try {
      await navigator.clipboard.writeText(value)
      toast.success('Phone number copied.')
    } catch {
      toast.error('Unable to copy phone number.')
    }
  }

  const openActionMenu = (event, contact) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const width = 184
    const height = readOnly ? 88 : 200
    setActionMenu({
      contact,
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
      top: Math.min(rect.bottom + 6, Math.max(8, window.innerHeight - height - 8)),
    })
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
    const csv = 'name,phone,email,company,tags\n'
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

  const hasFilters = Boolean(search || fieldFilterId || fieldFilterValue || selectedTagIds.length)
  const loadFailed = Boolean(error && !contacts.length && !loading)
  const columnCount = readOnly ? 8 : 9

  return (
    <>
      <PageHeader
        title="Contacts"
        subtitle="Manage contacts, tags and WhatsApp conversations."
        actions={
          <>
            <button type="button" className="button button-secondary" onClick={exportContacts} disabled={exporting}><Icon name="download" size={16} /> {exporting ? 'Exporting...' : 'Export'}</button>
            {!readOnly && <button type="button" className="button button-secondary" onClick={() => { setShowImport((current) => !current); setError(''); setNotice('') }}><Icon name="file" size={16} /> Import CSV</button>}
            {!readOnly && <button type="button" className="button button-primary" onClick={startCreate}><Icon name="plus" size={16} /> Add contact</button>}
          </>
        }
      />
      <section className="contacts-stats" aria-label="Contact summary">
        {[
          { key: 'total', label: 'Total Contacts', icon: 'contacts', value: summary.total },
          { key: 'conversations', label: 'Contacts With Conversations', icon: 'chat', value: summary.with_conversation },
          { key: 'recent', label: 'Added Last 7 Days', icon: 'plus', value: summary.recently_added },
          { key: 'tags', label: 'Contact Tags', icon: 'tag', value: summary.tags },
        ].map((card) => (
          <article className="contact-stat-card" key={card.key}>
            <span className="stat-icon" aria-hidden="true"><Icon name={card.icon} size={17} /></span>
            <div className="stat-copy">
              <span className="stat-label">{card.label}</span>
              <strong className="stat-value">{card.value.toLocaleString()}</strong>
            </div>
          </article>
        ))}
      </section>
      {error && !showForm && <div className="alert alert-error">{error}</div>}
      {notice && !showForm && <div className="alert alert-success">{notice}</div>}

      {showImport && (
        <section className="card import-panel">
          <header className="panel-header">
            <h2>Import contacts</h2>
            <button type="button" className="icon-button" onClick={() => setShowImport(false)} aria-label="Close import panel"><Icon name="close" size={18} /></button>
          </header>
          <div className="import-panel-body">
            <label className="contacts-file-drop" htmlFor="contact-import-file">
              <Icon name="file" size={22} />
              <strong className="text-truncate">{importFile ? importFile.name : 'Choose a CSV file'}</strong>
              <span className="muted">.csv or .txt · max 2 MB</span>
              <input id="contact-import-file" className="visually-hidden" type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(event) => setImportFile(event.target.files?.[0] || null)} />
            </label>
            <div className="import-options">
              <label className="checkbox-label" htmlFor="contact-import-dry-run">
                <input id="contact-import-dry-run" type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} /> Dry run (validate without saving)
              </label>
              <button type="button" className="button button-sm button-secondary" onClick={downloadTemplate}><Icon name="download" size={15} /> Download template</button>
            </div>
            <div className="settings-actions">
              <button type="button" className="button button-primary" onClick={uploadImport} disabled={importing || !importFile}>
                {importing && <span className="spinner spinner-sm" />}
                {importing ? 'Uploading...' : 'Upload'}
              </button>
            </div>
            <ImportResult result={importResult} />
          </div>
        </section>
      )}

      {showForm && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setShowForm(false) }}>
          <div className="contacts-form-dialog" role="dialog" aria-modal="true" aria-labelledby="contact-form-title">
            <header className="panel-header">
              <h2 id="contact-form-title">{editing ? 'Edit contact' : 'New contact'}</h2>
              <button type="button" className="icon-button" onClick={() => setShowForm(false)} disabled={saving} aria-label="Close form"><Icon name="close" size={18} /></button>
            </header>
            <form onSubmit={submit}>
              <div className="contacts-form-body">
                {error && <div className="alert alert-error">{error}</div>}
                <section className="contacts-form-section">
                  <h3>Contact details</h3>
                  <div className="form-grid">
                    <div className="field">
                      <label className="field-label" htmlFor="contact-name">Name <span className="contacts-required" aria-hidden="true">*</span></label>
                      <input id="contact-name" className="input" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
                    </div>
                    <div className="field">
                      <label className="field-label" htmlFor="contact-phone">Phone <span className="contacts-required" aria-hidden="true">*</span></label>
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
                </section>
                <section className="contacts-form-section">
                  <h3>Tags</h3>
                  <div className="tag-picker">
                    {tags.map((tag) => (
                      <button
                        type="button"
                        key={tag.id}
                        className={`tag-chip${formTagIds.includes(tag.id) ? ' is-selected' : ''}`}
                        style={tagStyle(tag)}
                        aria-pressed={formTagIds.includes(tag.id)}
                        onClick={() => setFormTagIds((current) => current.includes(tag.id) ? current.filter((id) => id !== tag.id) : [...current, tag.id])}
                      >
                        {tag.name}
                      </button>
                    ))}
                    {!tags.length && <span className="muted">No tags available yet.</span>}
                  </div>
                </section>
                {customFields.length > 0 && (
                  <section className="contacts-form-section">
                    <h3>Custom fields</h3>
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
                  </section>
                )}
              </div>
              <footer className="contacts-form-footer">
                <button type="button" className="button button-secondary" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button>
                <button className="button button-primary" disabled={saving}>
                  {saving && <span className="spinner spinner-sm" />}
                  {saving ? 'Saving...' : 'Save contact'}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      <section className="card contacts-card">
        <div className="card-toolbar contacts-toolbar">
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
          <span className="muted contacts-count">{paginator.total} contacts</span>
          {!readOnly && selectedIds.length > 0 && (
            <div className="bulk-actions">
              <span className="bulk-count">{selectedIds.length} selected</span>
              <button type="button" className="button button-sm button-danger" onClick={requestBulkDelete} disabled={deleting}><Icon name="trash" size={15} /> Delete selected</button>
              <button type="button" className="button button-sm button-ghost" onClick={() => setSelectedIds([])} disabled={deleting}>Clear selection</button>
            </div>
          )}
        </div>
        <div className="filter-row">
          <div className="field contacts-filter-tags">
            <span className="field-label">Tags</span>
            <div className="tag-picker">
              {tags.map((tag) => (
                <button
                  type="button"
                  key={tag.id}
                  className={`tag-chip${selectedTagIds.includes(tag.id) ? ' is-selected' : ''}`}
                  style={tagStyle(tag)}
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
          <table className="data-table contacts-table">
            <thead>
              <tr>
                {!readOnly && <th className="contacts-select-cell" scope="col"><input ref={headerCheckbox} type="checkbox" checked={allOnPageSelected} onChange={toggleSelectAll} aria-label={allOnPageSelected ? 'Clear page selection' : 'Select all contacts on this page'} /></th>}
                <th scope="col">Name</th>
                <th scope="col">Phone</th>
                <th scope="col">Email / Company</th>
                <th scope="col" className="col-tags">Tags</th>
                <th scope="col" className="col-wa">WhatsApp ID</th>
                <th scope="col" className="col-last">Last interaction</th>
                <th scope="col" className="col-created">Created</th>
                <th scope="col" className="contacts-actions-heading">Actions</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => {
                const selected = selectedIds.includes(contact.id)
                const phone = contact.phone || contact.phone_normalized || ''
                const visibleTags = (contact.tags || []).slice(0, 2)
                const hiddenTags = Math.max(0, (contact.tags || []).length - visibleTags.length)
                return (
                  <tr key={contact.id} className={selected ? 'is-selected' : ''}>
                    {!readOnly && <td className="contacts-select-cell"><input type="checkbox" checked={selected} onChange={() => toggleSelect(contact.id)} aria-label={`Select ${contactLabel(contact)}`} /></td>}
                    <td>
                      <button type="button" className="contact-name-button" onClick={() => setDetailContact(contact)} title={`View ${contactLabel(contact)}`}>
                        <span className="contact-avatar" aria-hidden="true">{contactInitial(contact)}</span>
                        <span className="contact-name-text text-truncate">{contact.name || 'Unnamed contact'}</span>
                      </button>
                    </td>
                    <td className="contacts-phone-cell"><span className="text-truncate" title={phone || undefined}>{phone || '—'}</span></td>
                    <td>
                      <div className="contact-secondary-cell">
                        <span className="text-truncate" title={contact.email || undefined}>{contact.email || '—'}</span>
                        {contact.company && <span className="muted text-truncate" title={contact.company}>{contact.company}</span>}
                      </div>
                    </td>
                    <td className="col-tags">
                      <div className="contact-tags">
                        {visibleTags.map((tag) => <span className="tag-chip" key={tag.id} style={tagStyle(tag)} title={tag.name}>{tag.name}</span>)}
                        {hiddenTags > 0 && <span className="tag-chip tag-chip-more" title={(contact.tags || []).map((tag) => tag.name).join(', ')}>+{hiddenTags}</span>}
                        {!visibleTags.length && '—'}
                      </div>
                    </td>
                    <td className="col-wa"><span className="wa-id text-truncate" title={contact.wa_user_id || undefined}>{contact.wa_user_id || '—'}</span></td>
                    <td className="col-last"><span className="text-truncate" title={dateTitle(contact.last_interaction_at) || undefined}>{displayDate(contact.last_interaction_at)}</span></td>
                    <td className="col-created"><span className="text-truncate" title={dateTitle(contact.created_at) || undefined}>{displayDate(contact.created_at)}</span></td>
                    <td className="contacts-actions-cell">
                      <div className="actions-cell">
                        {hasModuleAccess(user, 'inbox') && <button type="button" className="icon-button" onClick={() => openChat(contact)} aria-label={`Open conversation with ${contactLabel(contact)}`} title="Open conversation"><Icon name="chat" size={16} /></button>}
                        {!readOnly && <button type="button" className="icon-button" onClick={() => startEdit(contact)} aria-label={`Edit ${contactLabel(contact)}`} title="Edit contact"><Icon name="edit" size={16} /></button>}
                        <button type="button" className="icon-button contacts-more-button" onClick={(event) => openActionMenu(event, contact)} aria-haspopup="menu" aria-expanded={actionMenu?.contact?.id === contact.id} aria-label={`More actions for ${contactLabel(contact)}`} title="More actions"><Icon name="more" size={16} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {loading && (
                <>
                  <tr><td className="contacts-loading-status" colSpan={columnCount}><span className="spinner" /> Loading contacts...</td></tr>
                  {Array.from({ length: 3 }).map((_, index) => (
                    <tr className="contacts-loading-row" key={`skeleton-${index}`}>
                      {Array.from({ length: columnCount }).map((__, cellIndex) => (
                        <td key={`skeleton-cell-${cellIndex}`}><span className="skeleton" style={{ width: `${52 + ((index + cellIndex) % 3) * 14}%` }} /></td>
                      ))}
                    </tr>
                  ))}
                </>
              )}
              {!loading && !contacts.length && (
                <tr>
                  <td className="table-empty" colSpan={columnCount}>
                    <div className="empty-state">
                      <Icon name={loadFailed ? 'alert' : 'contacts'} size={20} />
                      <strong>{loadFailed ? 'Contacts could not be loaded' : hasFilters ? 'No matching contacts' : 'No contacts yet'}</strong>
                      <p>{loadFailed ? error : hasFilters ? 'Try changing or clearing your filters.' : 'Add your first contact to start tracking conversations.'}</p>
                      {loadFailed && <button type="button" className="button button-sm button-secondary" onClick={loadContacts}><Icon name="refresh" size={15} /> Retry</button>}
                      {!loadFailed && hasFilters && <button type="button" className="button button-sm button-secondary" onClick={clearFilters}>Clear filters</button>}
                      {!loadFailed && !hasFilters && !readOnly && <button type="button" className="button button-sm button-primary" onClick={startCreate}><Icon name="plus" size={15} /> Add contact</button>}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="pagination">
          <span className="muted">{loading ? 'Loading contacts...' : `Page ${paginator.currentPage} of ${paginator.lastPage}`}</span>
          <div className="pagination-actions">
            <button type="button" className="button button-sm button-secondary" disabled={loading || page <= 1} onClick={() => goToPage(page - 1)}>Previous</button>
            <button type="button" className="button button-sm button-secondary" disabled={loading || page >= paginator.lastPage} onClick={() => goToPage(page + 1)}>Next</button>
          </div>
        </div>
      </section>

      {actionMenu && (
        <div
          className="contacts-action-menu"
          role="menu"
          aria-label="Contact actions"
          style={{ top: actionMenu.top, left: actionMenu.left }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={() => { setDetailContact(actionMenu.contact); setActionMenu(null) }}><Icon name="eye" size={15} /> View details</button>
          {hasModuleAccess(user, 'inbox') && <button type="button" role="menuitem" onClick={() => { const contact = actionMenu.contact; setActionMenu(null); openChat(contact) }}><Icon name="chat" size={15} /> Open conversation</button>}
          {!readOnly && (
            <>
              <div className="contacts-menu-divider" />
              <button type="button" role="menuitem" onClick={() => startEdit(actionMenu.contact)}><Icon name="edit" size={15} /> Edit</button>
              <button type="button" role="menuitem" onClick={() => { copyPhone(actionMenu.contact); setActionMenu(null) }}><Icon name="copy" size={15} /> Copy phone</button>
              <button type="button" role="menuitem" className="is-danger" onClick={() => remove(actionMenu.contact)}><Icon name="trash" size={15} /> Delete</button>
            </>
          )}
        </div>
      )}

      {detailContact && <ContactDetail
        key={detailContact.id}
        initialContact={detailContact}
        customFields={customFields}
        readOnly={readOnly}
        onClose={() => setDetailContact(null)}
        onEdit={(contact) => { setDetailContact(null); startEdit(contact) }}
        onOpenChat={hasModuleAccess(user, 'inbox') ? openChat : null}
      />}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget?.kind === 'bulk' ? 'Delete selected contacts?' : 'Delete contact?'}
        message={deleteTarget?.kind === 'bulk'
          ? `${deleteTarget.ids.length} selected contact${deleteTarget.ids.length === 1 ? '' : 's'} and their chat history will be removed. This cannot be undone.`
          : deleteTarget ? `${contactLabel(deleteTarget.contact)} and its chat history will be removed. This cannot be undone.` : ''}
        confirmLabel={deleteTarget?.kind === 'bulk' ? 'Delete selected' : 'Delete contact'}
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => { if (!deleting) { setDeleteTarget(null); setActionMenu(null) } }}
      />
    </>
  )
}
