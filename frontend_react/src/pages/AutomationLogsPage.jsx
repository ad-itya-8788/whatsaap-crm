import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import api from '../api/client.js'
import Icon from '../components/common/Icon.jsx'
import { useToast } from '../components/common/ToastProvider.jsx'
import { errorMessage, extractList, relativeTime } from '../lib/utils.js'

export default function AutomationLogsPage() {
  const { id } = useParams()
  const toast = useToast()
  const [automation, setAutomation] = useState(null)
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [detail, history] = await Promise.all([
        api.get(`/api/app/automations/${id}`),
        api.get(`/api/app/automations/${id}/logs`),
      ])
      setAutomation(detail.data.automation)
      setLogs(extractList(history.data))
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to load automation logs.'))
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => { load() }, [load])

  return (
    <div className="dash-page">
      <header className="dash-header">
        <div><h1>Run history</h1><p>{automation?.name || 'Automation'}</p></div>
        <Link className="button button-secondary" to={`/automations/${id}/edit`}><Icon name="back" size={15} /> Back to editor</Link>
      </header>
      <section className="dash-card">
        {loading ? <div className="dash-empty"><span className="spinner" /> Loading run history…</div> : logs.length ? (
          <div className="bc-table-wrap">
            <table className="bc-table">
              <thead><tr><th>Contact</th><th>Trigger</th><th>Status</th><th>Steps</th><th>Error</th><th>When</th></tr></thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td>{log.contact ? (log.contact.name || log.contact.phone) : `#${log.contact_id || '—'}`}</td>
                    <td><span className="auto-trigger">{log.trigger_event}</span></td>
                    <td><span className={`badge badge-${log.status === 'success' ? 'approved' : log.status === 'failed' ? 'rejected' : 'pending'}`}>{log.status}</span></td>
                    <td>{Array.isArray(log.steps_executed) ? log.steps_executed.length : 0}</td>
                    <td><small>{log.error_message || '—'}</small></td>
                    <td>{relativeTime(log.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="dash-empty"><Icon name="refresh" size={22} /><span>No runs recorded yet.</span></div>}
      </section>
    </div>
  )
}
