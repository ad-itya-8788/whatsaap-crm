import { useCallback, useEffect, useState } from 'react'
import api, { csrf } from '../../api/client.js'
import Icon from '../common/Icon.jsx'
import { useToast } from '../common/ToastProvider.jsx'
import { errorMessage, relativeTime } from '../../lib/utils.js'

const EMPTY = { title: '', content: '', source: '', is_active: true }

export default function AiKnowledgePanel({ canManage }) {
  const toast = useToast()
  const [documents, setDocuments] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)
  const [reindexing, setReindexing] = useState(false)

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/api/app/ai/knowledge')
      setDocuments(Array.isArray(data) ? data : data.data || [])
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to load knowledge documents.'))
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    try {
      await csrf()
      const url = editing ? `/api/app/ai/knowledge/${editing}` : '/api/app/ai/knowledge'
      const method = editing ? api.patch : api.post
      await method(url, form)
      toast.success(editing ? 'Knowledge document updated.' : 'Knowledge document saved. Use Reindex to include it in answers.')
      setForm(EMPTY)
      setEditing(null)
      await load()
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to save knowledge document.'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (document) => {
    if (!window.confirm(`Delete "${document.title}"? This also removes its indexed chunks.`)) return
    try {
      await csrf()
      await api.delete(`/api/app/ai/knowledge/${document.id}`)
      toast.success('Knowledge document deleted.')
      await load()
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to delete knowledge document.'))
    }
  }

  const reindex = async () => {
    setReindexing(true)
    try {
      await csrf()
      const { data } = await api.post('/api/app/ai/knowledge/reindex')
      toast.success(`Indexed ${data.chunks} knowledge chunks.`)
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to reindex knowledge.'))
    } finally {
      setReindexing(false)
    }
  }

  return (
    <div className="agents-knowledge-grid">
      <div className="agents-card">
        <div className="agents-card-head">
          <div>
            <h2>Knowledge base</h2>
            <p>Add policies, product details, and answers the AI may use.</p>
          </div>
          {canManage && <button type="button" className="button button-secondary button-sm" onClick={reindex} disabled={reindexing}><Icon name="refresh" size={14} /> {reindexing ? 'Indexing...' : 'Reindex all'}</button>}
        </div>
        {!documents.length && <div className="list-placeholder">No knowledge documents yet.</div>}
        <div className="agents-doc-list">
          {documents.map((document) => (
            <div className="agents-doc" key={document.id}>
              <div className="agents-doc-icon"><Icon name="document" size={18} /></div>
              <div className="agents-doc-main">
                <div className="agents-doc-title">{document.title} {!document.is_active && <span className="agents-muted">(inactive)</span>}</div>
                <div className="agents-muted">{document.source || 'Manual entry'} · {relativeTime(document.updated_at || document.created_at)}</div>
              </div>
              {canManage && (
                <div className="agents-doc-actions">
                  <button type="button" className="icon-button" title="Edit" aria-label={`Edit ${document.title}`} onClick={() => { setEditing(document.id); setForm({ title: document.title, content: document.content, source: document.source || '', is_active: document.is_active }) }}><Icon name="edit" size={15} /></button>
                  <button type="button" className="icon-button" title="Delete" aria-label="Delete" onClick={() => remove(document)}><Icon name="trash" size={15} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {canManage && (
        <div className="agents-card agents-form-card">
          <div className="agents-card-head"><h2>{editing ? 'Edit document' : 'Add document'}</h2></div>
          <form className="agents-form-grid" onSubmit={save}>
            <label className="field field-full"><span>Title</span><input className="input" required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
            <label className="field field-full"><span>Content</span><textarea className="textarea" rows="10" required value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} /></label>
            <label className="field field-full"><span>Source <em>optional</em></span><input className="input" value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} placeholder="e.g. Pricing policy, refund guide" /></label>
            <label className="check"><input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} /><span>Active</span></label>
            <div className="agents-card-actions">
              <button type="submit" className="button button-primary" disabled={busy}><Icon name="check" size={15} /> {busy ? 'Saving...' : editing ? 'Update' : 'Save document'}</button>
              {editing && <button type="button" className="button button-ghost" onClick={() => { setEditing(null); setForm(EMPTY) }}>Cancel</button>}
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
