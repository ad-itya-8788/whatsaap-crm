import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client.js'
import PageHeader from '../components/common/PageHeader.jsx'
import Icon from '../components/common/Icon.jsx'
import { errorMessage, extractList, extractPaginator } from '../lib/utils.js'

const blankContact = { name: '', phone: '' }

export default function ContactsPage() {
  const navigate = useNavigate()
  const [contacts, setContacts] = useState([])
  const [conversations, setConversations] = useState([])
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [paginator, setPaginator] = useState({ currentPage: 1, lastPage: 1, total: 0 })
  const [form, setForm] = useState(blankContact)
  const [editing, setEditing] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [opening, setOpening] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadContacts = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/api/app/contacts', { params: { search: debouncedSearch || undefined, page, per_page: 25 } })
      setContacts(extractList(data))
      setPaginator(extractPaginator(data))
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to load contacts.'))
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, page])

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => { loadContacts() }, [loadContacts])

  useEffect(() => {
    api.get('/api/app/conversations')
      .then(({ data }) => setConversations(extractList(data)))
      .catch(() => {})
  }, [])

  const startCreate = () => {
    setEditing(null)
    setForm(blankContact)
    setShowForm(true)
    setError('')
    setNotice('')
  }

  const startEdit = (contact) => {
    setEditing(contact.id)
    setForm({ name: contact.name || '', phone: contact.phone || '' })
    setShowForm(true)
    setError('')
    setNotice('')
  }

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      if (editing) await api.patch(`/api/app/contacts/${editing}`, form)
      else await api.post('/api/app/contacts', form)
      setShowForm(false)
      setForm(blankContact)
      setEditing(null)
      setNotice(editing ? 'Contact updated.' : 'Contact added.')
      await loadContacts()
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to save contact.'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (contact) => {
    const label = contact.name || contact.phone || 'this contact'
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return
    setError('')
    setNotice('')
    try {
      await api.delete(`/api/app/contacts/${contact.id}`)
      setNotice('Contact deleted.')
      await loadContacts()
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to delete contact.'))
    }
  }

  const openChat = async (contact) => {
    setError('')
    const existing = conversations.find((item) => String(item.contact?.id ?? item.contact_id) === String(contact.id))
    if (existing) {
      navigate(`/chats?conversation=${existing.id}`)
      return
    }
    setOpening(contact.id)
    try {
      const { data } = await api.post('/api/app/conversations/start', { contact_id: contact.id })
      const created = data?.conversation || data?.data || data
      if (!created?.id) throw new Error('The conversation response did not include an id.')
      setConversations((items) => [...items, created])
      navigate(`/chats?conversation=${created.id}`)
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to open a conversation for this contact.'))
    } finally {
      setOpening(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Contacts"
        subtitle="Manage contacts and start WhatsApp conversations."
        actions={<button type="button" className="button button-primary" onClick={startCreate}><Icon name="plus" size={16} /> Add contact</button>}
      />
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

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
            </div>
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
              onChange={(event) => { setPage(1); setSearch(event.target.value) }}
            />
          </div>
          <span className="muted">{paginator.total} contacts</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Name</th><th>Phone</th><th>WhatsApp ID</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr key={contact.id}>
                  <td>
                    <button type="button" className="link-button" onClick={() => openChat(contact)} disabled={opening === contact.id}>
                      {contact.name || 'Unnamed contact'}
                    </button>
                  </td>
                  <td>{contact.phone || contact.phone_normalized || '—'}</td>
                  <td>{contact.whatsapp_user_id ? <span className="wa-id">{contact.whatsapp_user_id}</span> : '—'}</td>
                  <td>
                    <div className="actions-cell">
                      <button type="button" className="icon-button" onClick={() => startEdit(contact)} aria-label={`Edit ${contact.name || 'contact'}`}><Icon name="edit" size={16} /></button>
                      <button type="button" className="icon-button is-danger" onClick={() => remove(contact)} aria-label={`Delete ${contact.name || 'contact'}`}><Icon name="trash" size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && !contacts.length && <tr><td colSpan="4" className="table-empty">{search ? 'No contacts match your search.' : 'No contacts yet. Add your first contact to get started.'}</td></tr>}
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
    </>
  )
}
