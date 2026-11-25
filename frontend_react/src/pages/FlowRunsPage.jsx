import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import api from '../api/client.js'
import Icon from '../components/common/Icon.jsx'
import { useToast } from '../components/common/ToastProvider.jsx'
import { errorMessage, relativeTime } from '../lib/utils.js'

const statusBadge = (status) => ['completed', 'handed_off'].includes(status) ? 'approved' : ['failed', 'timed_out', 'cancelled'].includes(status) ? 'rejected' : 'pending'

export default function FlowRunsPage() {
  const { id } = useParams()
  const toast = useToast()
  const [flow, setFlow] = useState(null)
  const [runs, setRuns] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get(`/api/app/flows/${id}/runs`)
      setFlow(data.flow)
      setRuns(data.runs || [])
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to load flow runs.'))
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => { load() }, [load])

  return (
    <div className="dash-page">
      <header className="dash-header">
        <div><h1>Flow runs</h1><p>{flow?.name || 'Flow'}</p></div>
        <Link className="button button-secondary" to={`/flows/${id}/edit`}><Icon name="back" size={15} /> Back to editor</Link>
      </header>
      <section className="dash-card">
        {loading ? <div className="dash-empty"><span className="spinner" /> Loading runs…</div> : runs.length ? (
          <div className="flow-runs">
            {runs.map((run) => (
              <article className="flow-run" key={run.id}>
                <div className="flow-run-head">
                  <div><strong>Run #{run.id}</strong><span>{run.contact ? (run.contact.name || run.contact.phone) : `Contact #${run.contact_id}`}</span></div>
                  <span className={`badge badge-${statusBadge(run.status)}`}>{run.status}</span>
                </div>
                <div className="flow-run-meta">
                  <span>Current node: <strong>{run.current_node_key || '—'}</strong></span>
                  <span>Reason: <strong>{run.end_reason || '—'}</strong></span>
                  <span>Started: <strong>{relativeTime(run.started_at)}</strong></span>
                </div>
                {run.events?.length ? (
                  <ol className="flow-events">
                    {run.events.map((event) => (
                      <li key={event.id}><span className="flow-event-type">{event.event_type}</span><span>{event.node_key || '—'}</span><small>{relativeTime(event.created_at)}</small></li>
                    ))}
                  </ol>
                ) : <p className="muted">No events recorded.</p>}
              </article>
            ))}
          </div>
        ) : <div className="dash-empty"><Icon name="workflow" size={22} /><span>No runs recorded yet.</span></div>}
      </section>
    </div>
  )
}
