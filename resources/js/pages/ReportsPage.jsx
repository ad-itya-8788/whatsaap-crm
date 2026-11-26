import { useCallback, useEffect, useState } from 'react'
import api from '../api/client.js'
import PageHeader from '../components/common/PageHeader.jsx'
import Icon from '../components/common/Icon.jsx'
import { errorMessage, extractList } from '../lib/utils.js'

function localDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function defaultDates() {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 29)
  return { from: localDate(from), to: localDate(to) }
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function display(value) {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

function percent(value) {
  if (value === null || value === undefined || value === '') return '—'
  return `${number(value).toFixed(1)}%`
}

function unwrap(payload) {
  let value = payload
  while (value && typeof value === 'object' && !Array.isArray(value) && value.data && typeof value.data === 'object' && !Array.isArray(value.data)) {
    value = value.data
  }
  return value
}

function StatCard({ label, value, sub, icon }) {
  return (
    <article className="stat-card">
      <div className="stat-label"><Icon name={icon} size={15} /> {label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </article>
  )
}

export default function ReportsPage() {
  const initial = defaultDates()
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [applied, setApplied] = useState(initial)
  const [overview, setOverview] = useState(null)
  const [agents, setAgents] = useState([])
  const [trend, setTrend] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const params = { from: applied.from, to: applied.to }
    try {
      const [overviewResult, agentsResult, trendResult] = await Promise.all([
        api.get('/api/app/reports/overview', { params }),
        api.get('/api/app/reports/agents', { params }),
        api.get('/api/app/reports/trend', { params }),
      ])
      setOverview(unwrap(overviewResult.data) || {})
      setAgents(extractList(agentsResult.data))
      setTrend(extractList(trendResult.data))
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to load reports.'))
    } finally {
      setLoading(false)
    }
  }, [applied])

  useEffect(() => { load() }, [load])

  const apply = (event) => {
    event.preventDefault()
    if (!from || !to) {
      setError('Choose both a start and end date.')
      return
    }
    if (from > to) {
      setError('The start date must be before the end date.')
      return
    }
    setApplied({ from, to })
  }

  const stats = [
    { label: 'Conversations', value: display(overview?.conversations), sub: 'In the selected period', icon: 'chat' },
    { label: 'Messages', value: display(overview?.messages), sub: 'All messages', icon: 'bolt' },
    { label: 'Inbound', value: display(overview?.inbound), sub: 'Received from contacts', icon: 'contacts' },
    { label: 'Outbound', value: display(overview?.outbound), sub: 'Sent by your team', icon: 'send' },
    { label: 'Delivery rate', value: percent(overview?.delivery_rate), sub: `${number(overview?.delivered)} delivered`, icon: 'check' },
    { label: 'Failure rate', value: percent(overview?.failure_rate), sub: `${number(overview?.failed)} failed`, icon: 'alert' },
    { label: 'Opted-out contacts', value: display(overview?.opted_out_contacts), sub: 'Do not message', icon: 'shield' },
  ]

  const peak = Math.max(1, ...trend.map((day) => Math.max(number(day.conversations), number(day.messages), number(day.failed))))

  return (
    <>
      <PageHeader title="Reports" subtitle="Review conversation volume, delivery and agent workload." />
      <form className="report-filters" onSubmit={apply}>
        <div className="field">
          <label className="field-label" htmlFor="report-from">From</label>
          <input id="report-from" className="input" type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="report-to">To</label>
          <input id="report-to" className="input" type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
        </div>
        <button type="submit" className="button button-primary" disabled={loading}><Icon name="search" size={15} /> Apply</button>
        <span className="report-note">Showing {applied.from} to {applied.to}</span>
      </form>
      {error && <div className="alert alert-error">{error}</div>}
      {loading && <div className="list-placeholder"><span className="spinner" /> Loading reports...</div>}

      {!loading && !error && (
        <>
          <div className="stat-grid">
            {stats.map((stat) => <StatCard key={stat.label} {...stat} />)}
          </div>

          <section className="card report-card">
            <header className="panel-header"><h2>Agent workload</h2></header>
            {agents.length ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr><th>Agent</th><th>Assigned</th><th>Active</th><th>Closed</th><th>Replies</th></tr>
                  </thead>
                  <tbody>
                    {agents.map((agent) => (
                      <tr key={agent.user_id ?? agent.id ?? agent.name}>
                        <td>{agent.name || 'Unknown agent'}</td>
                        <td>{display(agent.assigned)}</td>
                        <td>{display(agent.active_conversations)}</td>
                        <td>{display(agent.closed)}</td>
                        <td>{display(agent.replies)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="report-empty">No agent activity in this period.</div>
            )}
          </section>

          <section className="card chart-card">
            <header className="panel-header">
              <h2>Daily trend</h2>
              <span className="report-note">Bar height follows the highest daily total</span>
            </header>
            {trend.length ? (
              <>
                <div className="chart-bars">
                  {trend.map((day) => {
                    const messages = number(day.messages)
                    const conversations = number(day.conversations)
                    const failed = number(day.failed)
                    return (
                      <div className="chart-col" key={day.date} title={`${day.date}: ${conversations} conversations, ${messages} messages, ${failed} failed`}>
                        <div className="chart-bar" style={{ height: `${Math.max(2, Math.round((messages / peak) * 100))}%` }} />
                        <div className="chart-bar-label">{String(day.date || '').slice(5)}</div>
                      </div>
                    )
                  })}
                </div>
                <div className="report-note">Messages per day · hover a bar for conversations and failures</div>
              </>
            ) : (
              <div className="report-empty">No activity to chart in this period.</div>
            )}
          </section>
        </>
      )}
    </>
  )
}
