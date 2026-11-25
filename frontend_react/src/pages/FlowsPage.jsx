import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api from '../api/client.js'
import Icon from '../components/common/Icon.jsx'
import { useToast } from '../components/common/ToastProvider.jsx'
import { errorMessage, extractList, relativeTime } from '../lib/utils.js'

export default function FlowsPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [flows, catalogue] = await Promise.all([
        api.get('/api/app/flows'),
        api.get('/api/app/flows/templates'),
      ])
      setItems(extractList(flows.data))
      setTemplates(Array.isArray(catalogue.data) ? catalogue.data : [])
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to load flows.'))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  const create = async (slug) => {
    setCreating(slug || 'blank')
    try {
      const payload = slug ? { template_slug: slug } : { name: 'Untitled flow', trigger_type: 'manual' }
      const { data } = await api.post('/api/app/flows', payload)
      toast.success('Flow created as a draft.')
      navigate(`/flows/${data.flow.id}/edit`)
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to create flow.'))
    } finally {
      setCreating('')
    }
  }

  const setStatus = async (item, status) => {
    try {
      await api.post(`/api/app/flows/${item.id}/activate`, { status })
      toast.success(status === 'active' ? 'Flow activated.' : 'Flow updated.')
      load()
    } catch (error) {
      const issues = error.response?.data?.issues || []
      if (issues.length) {
        toast.error(issues.map((issue) => issue.message).join(' '))
      } else {
        toast.error(errorMessage(error, 'Unable to update flow.'))
      }
    }
  }

  const remove = async (item) => {
    if (!window.confirm(`Delete flow "${item.name}"?`)) return
    try {
      await api.delete(`/api/app/flows/${item.id}`)
      toast.success('Flow deleted.')
      load()
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to delete flow.'))
    }
  }

  return (
    <div className="dash-page">
      <header className="dash-header">
        <div><h1>Flows</h1><p>Build guided customer journeys with real WhatsApp steps.</p></div>
        <button type="button" className="button button-primary" onClick={() => create('')} disabled={creating === 'blank'}><Icon name="plus" size={15} /> {creating === 'blank' ? 'Creating...' : 'New flow'}</button>
      </header>

      <section className="auto-templates">
        {templates.map((template) => (
          <div className="dash-card auto-template" key={template.slug}>
            <div className="auto-template-icon"><Icon name="workflow" size={19} /></div>
            <h3>{template.name}</h3>
            <p>{template.description}</p>
            <button type="button" className="button button-secondary button-sm" onClick={() => create(template.slug)} disabled={Boolean(creating)}>{creating === template.slug ? 'Creating...' : 'Use template'}</button>
          </div>
        ))}
      </section>

      <section className="dash-card">
        {loading ? <div className="dash-empty"><span className="spinner" /> Loading flows…</div> : items.length ? (
          <div className="bc-table-wrap">
            <table className="bc-table">
              <thead><tr><th>Name</th><th>Trigger</th><th>Status</th><th>Nodes</th><th>Runs</th><th>Updated</th><th /></tr></thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td><Link to={`/flows/${item.id}/edit`}><strong>{item.name}</strong></Link><small>{item.description}</small></td>
                    <td><span className="auto-trigger">{item.trigger_type}</span></td>
                    <td><span className={`badge badge-${item.status === 'active' ? 'approved' : item.status === 'archived' ? 'rejected' : 'pending'}`}>{item.status}</span></td>
                    <td>{item.nodes_count ?? '—'}</td>
                    <td>{item.execution_count || 0}</td>
                    <td>{relativeTime(item.updated_at)}</td>
                    <td className="bc-actions">
                      <button type="button" className="button button-sm button-secondary" onClick={() => setStatus(item, item.status === 'active' ? 'draft' : 'active')}>{item.status === 'active' ? 'Pause' : 'Activate'}</button>
                      <Link className="icon-button" to={`/flows/${item.id}/runs`} title="Runs"><Icon name="refresh" size={15} /></Link>
                      <button type="button" className="icon-button" onClick={() => remove(item)} title="Delete"><Icon name="trash" size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="dash-empty"><Icon name="workflow" size={22} /><span>No flows yet. Start with a template above.</span></div>}
      </section>
    </div>
  )
}
