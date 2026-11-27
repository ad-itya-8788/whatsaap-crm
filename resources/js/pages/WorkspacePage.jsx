import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from '../lib/navigation.js'
import api from '../api/client.js'
import PageHeader from '../components/common/PageHeader.jsx'
import Icon from '../components/common/Icon.jsx'
import ConfirmDialog from '../components/common/ConfirmDialog.jsx'
import InteractiveBuilder from '../components/chat/InteractiveBuilder.jsx'
import InteractivePreview from '../components/chat/InteractivePreview.jsx'
import { useToast } from '../components/common/ToastProvider.jsx'
import { errorMessage, extractList } from '../lib/utils.js'

const tabs = [
  { key: 'tags', label: 'Tags', icon: 'tag' },
  { key: 'fields', label: 'Custom fields', icon: 'bolt' },
  { key: 'quick-replies', label: 'Quick replies', icon: 'note' },
]

const blankTag = { name: '', color: '#2563eb' }
const blankField = { name: '', label: '', type: 'text', options: '', required: false, is_active: true }
const blankReply = { title: '', kind: 'text', body: '', interactive_payload: null }
const tagColors = [
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Emerald', value: '#10b981' },
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Violet', value: '#8b5cf6' },
  { name: 'Pink', value: '#ec4899' },
]

const fieldTypes = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Select' },
  { value: 'checkbox', label: 'Checkbox' },
]

function FieldRow({ label, children, full = false }) {
  return (
    <div className={`field-row${full ? ' field-row-full' : ''}`}>
      <label className="field-row-label">{label}</label>
      {children}
    </div>
  )
}

export default function WorkspacePage() {
  const toast = useToast()
  const canManage = true
  const canManageReplies = true
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const tab = tabs.some((item) => item.key === requestedTab) ? requestedTab : 'tags'
  const [tags, setTags] = useState([])
  const [fields, setFields] = useState([])
  const [replies, setReplies] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tagForm, setTagForm] = useState(blankTag)
  const [editTag, setEditTag] = useState(null)
  const [showTagForm, setShowTagForm] = useState(false)
  const [fieldForm, setFieldForm] = useState(blankField)
  const [editField, setEditField] = useState(null)
  const [showFieldForm, setShowFieldForm] = useState(false)
  const [replyForm, setReplyForm] = useState(blankReply)
  const [editReply, setEditReply] = useState(null)
  const [showReplyForm, setShowReplyForm] = useState(false)
  const [showReplyBuilder, setShowReplyBuilder] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [tagResult, fieldResult, replyResult] = await Promise.all([
        api.get('/api/app/tags'),
        api.get('/api/app/custom-fields'),
        api.get('/api/app/quick-replies'),
      ])
      setTags(extractList(tagResult.data))
      setFields(extractList(fieldResult.data))
      setReplies(extractList(replyResult.data))
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to load workspace settings.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const run = async (action, message) => {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await action()
      setNotice(message)
      toast.success(message)
      await load()
      return true
    } catch (requestError) {
      const errorMessageText = errorMessage(requestError, 'Unable to complete the request.')
      setError(errorMessageText)
      toast.error(errorMessageText)
      return false
    } finally {
      setSaving(false)
    }
  }

  const startTag = (tag) => {
    setTagForm(tag ? { name: tag.name || '', color: tag.color || '#2563eb' } : blankTag)
    setEditTag(tag?.id || null)
    setShowTagForm(true)
    setError('')
    setNotice('')
  }

  const saveTag = async (event) => {
    event.preventDefault()
    const payload = { name: tagForm.name.trim(), color: tagForm.color || '#2563eb' }
    if (!payload.name) {
      setError('Enter a tag name.')
      return
    }
    const done = await run(
      () => (editTag ? api.patch(`/api/app/tags/${editTag}`, payload) : api.post('/api/app/tags', payload)),
      editTag ? 'Tag updated.' : 'Tag created.',
    )
    if (done) {
      setShowTagForm(false)
      setTagForm(blankTag)
      setEditTag(null)
    }
  }

  const deleteTag = (tag) => setDeleteTarget({ type: 'tag', item: tag })

  const startField = (field) => {
    setFieldForm(field ? {
      name: field.name || '',
      label: field.label || '',
      type: field.type || 'text',
      options: Array.isArray(field.options) ? field.options.join(', ') : String(field.options || ''),
      required: Boolean(field.required),
      is_active: field.is_active !== false,
    } : blankField)
    setEditField(field?.id || null)
    setShowFieldForm(true)
    setError('')
    setNotice('')
  }

  const saveField = async (event) => {
    event.preventDefault()
    const payload = {
      name: fieldForm.name.trim(),
      label: fieldForm.label.trim(),
      type: fieldForm.type,
      options: fieldForm.type === 'select'
        ? fieldForm.options.split(',').map((option) => option.trim()).filter(Boolean)
        : [],
      required: fieldForm.required,
      is_active: fieldForm.is_active,
    }
    if (!payload.name || !payload.label) {
      setError('Enter both a field name and label.')
      return
    }
    if (fieldForm.type === 'select' && !payload.options.length) {
      setError('Add at least one option for a select field.')
      return
    }
    const done = await run(
      () => (editField ? api.patch(`/api/app/custom-fields/${editField}`, payload) : api.post('/api/app/custom-fields', payload)),
      editField ? 'Custom field updated.' : 'Custom field created.',
    )
    if (done) {
      setShowFieldForm(false)
      setFieldForm(blankField)
      setEditField(null)
    }
  }

  const deleteField = (field) => setDeleteTarget({ type: 'field', item: field })

  const startReply = (reply) => {
    setReplyForm(reply ? {
      title: reply.title || '',
      kind: reply.kind || 'text',
      body: reply.kind === 'interactive' ? '' : reply.body || '',
      interactive_payload: reply.interactive_payload || null,
    } : blankReply)
    setEditReply(reply?.id || null)
    setShowReplyForm(true)
    setError('')
    setNotice('')
  }

  const saveReply = async (event) => {
    event.preventDefault()
    const isInteractive = replyForm.kind === 'interactive'
    const payload = { title: replyForm.title.trim(), kind: replyForm.kind }
    if (isInteractive) {
      payload.interactive_payload = replyForm.interactive_payload
    } else {
      payload.body = replyForm.body.trim()
    }
    if (!payload.title || (isInteractive ? !payload.interactive_payload : !payload.body)) {
      setError(isInteractive ? 'Enter a title and create an interactive message.' : 'Enter both a title and a reply body.')
      return
    }
    const done = await run(
      () => (editReply ? api.patch(`/api/app/quick-replies/${editReply}`, payload) : api.post('/api/app/quick-replies', payload)),
      editReply ? 'Quick reply updated.' : 'Quick reply created.',
    )
    if (done) {
      setShowReplyForm(false)
      setReplyForm(blankReply)
      setEditReply(null)
    }
  }

  const deleteReply = (reply) => setDeleteTarget({ type: 'reply', item: reply })

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const { type, item } = deleteTarget
    const routes = {
      tag: [`/api/app/tags/${item.id}`, 'Tag deleted.'],
      field: [`/api/app/custom-fields/${item.id}`, 'Custom field deleted.'],
      reply: [`/api/app/quick-replies/${item.id}`, 'Quick reply deleted.'],
    }
    const [url, message] = routes[type]
    const done = await run(() => api.delete(url), message)
    if (done) setDeleteTarget(null)
  }

  const deleteMessage = deleteTarget
    ? deleteTarget.type === 'tag'
      ? `Delete tag “${deleteTarget.item.name}”? Contacts will keep their other tags.`
      : deleteTarget.type === 'field'
        ? `Delete custom field “${deleteTarget.item.label || deleteTarget.item.name}”? Saved values will be removed.`
        : `Delete quick reply “${deleteTarget.item.title}”? This cannot be undone.`
    : ''

  return (
    <>
      <PageHeader title="Workspace" subtitle="Manage tags, custom contact fields and reusable quick replies." />
      <div className="workspace-tabs" role="tablist" aria-label="Workspace sections">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`workspace-tab${tab === item.key ? ' is-active' : ''}`}
            onClick={() => { setSearchParams({ tab: item.key }); setError(''); setNotice('') }}
          >
            <Icon name={item.icon} size={16} /> {item.label}
          </button>
        ))}
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      {tab === 'tags' && (
        <section className="card workspace-card">
          <header className="panel-header">
            <h2>Tags</h2>
            <button type="button" className="button button-sm button-primary" onClick={() => startTag(null)}><Icon name="plus" size={15} /> New tag</button>
          </header>
          {showTagForm && (
            <form className="workspace-form" onSubmit={saveTag}>
              <FieldRow label="Name">
                <input className="input" required value={tagForm.name} onChange={(event) => setTagForm({ ...tagForm, name: event.target.value })} />
              </FieldRow>
              <FieldRow label="Colour">
                <div className="tag-color-options" role="group" aria-label="Tag colour">
                  {tagColors.map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      className="tag-color-swatch"
                      style={{ backgroundColor: color.value }}
                      aria-label={color.name}
                      aria-pressed={tagForm.color === color.value}
                      onClick={() => setTagForm({ ...tagForm, color: color.value })}
                    />
                  ))}
                  <input type="color" aria-label="Custom tag colour" className="input color-input" value={tagForm.color} onChange={(event) => setTagForm({ ...tagForm, color: event.target.value })} />
                </div>
              </FieldRow>
              <div className="workspace-form-actions">
                <button type="submit" className="button button-primary" disabled={saving}>{saving ? 'Saving...' : 'Save tag'}</button>
                <button type="button" className="button button-secondary" onClick={() => setShowTagForm(false)}>Cancel</button>
              </div>
            </form>
          )}
          {loading && <div className="list-placeholder"><span className="spinner" /> Loading tags...</div>}
          {!loading && (
            <div className="workspace-grid">
              {tags.map((tag) => (
                <article className="workspace-item" key={tag.id}>
                  <div className="workspace-item-main">
                    <span className="tag-chip" style={{ backgroundColor: tag.color || '#2563eb' }}>{tag.name}</span>
                    <span className="muted">{Number(tag.contacts_count || 0)} contacts</span>
                  </div>
                  <div className="workspace-item-actions">
                    <button type="button" className="icon-button" onClick={() => startTag(tag)} aria-label={`Edit ${tag.name}`}><Icon name="edit" size={16} /></button>
                    <button type="button" className="icon-button is-danger" onClick={() => deleteTag(tag)} aria-label={`Delete ${tag.name}`}><Icon name="trash" size={16} /></button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {!loading && !tags.length && <div className="workspace-empty">No tags yet. Create one to organise your contacts.</div>}
        </section>
      )}

      {tab === 'fields' && (
        <section className="card workspace-card">
          <header className="panel-header">
            <h2>Custom fields</h2>
            <button type="button" className="button button-sm button-primary" onClick={() => startField(null)} disabled={!canManage}><Icon name="plus" size={15} /> New field</button>
          </header>
          {!canManage && (
            <div className="alert alert-info alert-inline"><Icon name="shield" size={16} /> Only admins and owners can manage custom fields.</div>
          )}
          {showFieldForm && canManage && (
            <form className="workspace-form" onSubmit={saveField}>
              <FieldRow label="Name">
                <input className="input" required value={fieldForm.name} onChange={(event) => setFieldForm({ ...fieldForm, name: event.target.value })} />
              </FieldRow>
              <FieldRow label="Label">
                <input className="input" required value={fieldForm.label} onChange={(event) => setFieldForm({ ...fieldForm, label: event.target.value })} />
              </FieldRow>
              <FieldRow label="Type">
                <select className="select" value={fieldForm.type} onChange={(event) => setFieldForm({ ...fieldForm, type: event.target.value })}>
                  {fieldTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
              </FieldRow>
              {fieldForm.type === 'select' && (
                <FieldRow label="Options (comma separated)" full>
                  <textarea className="textarea" rows="2" value={fieldForm.options} onChange={(event) => setFieldForm({ ...fieldForm, options: event.target.value })} />
                </FieldRow>
              )}
              <FieldRow label="Required">
                <input type="checkbox" checked={fieldForm.required} onChange={(event) => setFieldForm({ ...fieldForm, required: event.target.checked })} />
              </FieldRow>
              <FieldRow label="Active">
                <input type="checkbox" checked={fieldForm.is_active} onChange={(event) => setFieldForm({ ...fieldForm, is_active: event.target.checked })} />
              </FieldRow>
              <div className="workspace-form-actions">
                <button type="submit" className="button button-primary" disabled={saving}>{saving ? 'Saving...' : 'Save field'}</button>
                <button type="button" className="button button-secondary" onClick={() => setShowFieldForm(false)}>Cancel</button>
              </div>
            </form>
          )}
          {loading && <div className="list-placeholder"><span className="spinner" /> Loading custom fields...</div>}
          {!loading && (
            <div className="workspace-grid">
              {fields.map((field) => (
                <article className="workspace-item" key={field.id}>
                  <div className="workspace-item-main">
                    <strong>{field.label || field.name}</strong>
                    <span className="muted">{field.name} · {field.type}</span>
                    {Array.isArray(field.options) && field.options.length > 0 && <span className="muted">{field.options.join(', ')}</span>}
                    <span className="muted">{[field.required ? 'Required' : '', field.is_active === false ? 'Inactive' : ''].filter(Boolean).join(' · ') || 'Optional'}</span>
                  </div>
                  <div className="workspace-item-actions">
                    <button type="button" className="icon-button" onClick={() => startField(field)} disabled={!canManage} aria-label={`Edit ${field.label || field.name}`}><Icon name="edit" size={16} /></button>
                    <button type="button" className="icon-button is-danger" onClick={() => deleteField(field)} disabled={!canManage} aria-label={`Delete ${field.label || field.name}`}><Icon name="trash" size={16} /></button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {!loading && !fields.length && <div className="workspace-empty">No custom fields yet.</div>}
        </section>
      )}

      {tab === 'quick-replies' && (
        <section className="card workspace-card">
          <header className="panel-header">
            <h2>Quick replies</h2>
            {canManageReplies && <button type="button" className="button button-sm button-primary" onClick={() => startReply(null)}><Icon name="plus" size={15} /> New reply</button>}
          </header>
          {showReplyForm && canManageReplies && (
            <form className="workspace-form" onSubmit={saveReply}>
              <FieldRow label="Title">
                <input className="input" aria-label="Quick reply title" required maxLength="255" value={replyForm.title} onChange={(event) => setReplyForm({ ...replyForm, title: event.target.value })} />
              </FieldRow>
              <FieldRow label="Type">
                <select className="select" aria-label="Quick reply type" value={replyForm.kind} onChange={(event) => setReplyForm({ ...replyForm, kind: event.target.value })}>
                  <option value="text">Text</option>
                  <option value="interactive">Interactive</option>
                </select>
              </FieldRow>
              {replyForm.kind === 'text' ? (
                <FieldRow label="Body" full>
                  <textarea className="textarea" aria-label="Quick reply body" rows="4" required maxLength="5000" value={replyForm.body} onChange={(event) => setReplyForm({ ...replyForm, body: event.target.value })} />
                </FieldRow>
              ) : (
                <FieldRow label="Interactive message" full>
                  <InteractivePreview payload={replyForm.interactive_payload} />
                  <button type="button" className="button button-sm button-secondary" onClick={() => setShowReplyBuilder(true)}>
                    {replyForm.interactive_payload ? 'Edit interactive message' : 'Build interactive message'}
                  </button>
                </FieldRow>
              )}
              <div className="workspace-form-actions">
                <button type="submit" className="button button-primary" disabled={saving}>{saving ? 'Saving...' : 'Save reply'}</button>
                <button type="button" className="button button-secondary" onClick={() => setShowReplyForm(false)}>Cancel</button>
              </div>
            </form>
          )}
          {loading && <div className="list-placeholder"><span className="spinner" /> Loading quick replies...</div>}
          {!loading && (
            <div className="workspace-grid">
              {replies.map((reply) => (
                <article className="workspace-item" key={reply.id}>
                  <div className="workspace-item-main">
                    <strong>{reply.title}</strong>
                    <span className="reply-body">{reply.body}</span>
                    {reply.kind === 'interactive' && <span className="muted">Interactive</span>}
                    <span className="muted">{reply.is_global ? 'Shared with everyone' : 'Personal reply'}</span>
                  </div>
                  {canManageReplies && (
                    <div className="workspace-item-actions">
                      <button type="button" className="icon-button" onClick={() => startReply(reply)} aria-label={`Edit ${reply.title}`}><Icon name="edit" size={16} /></button>
                      <button type="button" className="icon-button is-danger" onClick={() => deleteReply(reply)} aria-label={`Delete ${reply.title}`}><Icon name="trash" size={16} /></button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
          {!loading && !replies.length && <div className="workspace-empty">No quick replies yet. Create one to reuse common answers.</div>}
        </section>
      )}
      <InteractiveBuilder
        open={tab === 'quick-replies' && showReplyBuilder}
        initialPayload={replyForm.interactive_payload}
        onClose={() => setShowReplyBuilder(false)}
        onSend={(payload) => {
          setReplyForm((current) => ({ ...current, interactive_payload: payload }))
          setShowReplyBuilder(false)
        }}
        actionLabel="Use interactive message"
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete item?"
        message={deleteMessage}
        confirmLabel="Delete"
        busy={saving}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  )
}
