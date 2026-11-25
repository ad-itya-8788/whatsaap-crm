import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import api from '../api/client.js'
import Icon from '../components/common/Icon.jsx'
import { errorMessage } from '../lib/utils.js'
import { useAuth } from '../context/AuthContext.jsx'

const RANGES = [7, 30, 90]

function number(value) {
  return new Intl.NumberFormat().format(Number(value || 0))
}

function percent(value) {
  return value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`
}

function duration(minutes) {
  if (minutes === null || minutes === undefined) return '—'
  if (minutes < 60) return `${Math.round(minutes)}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${Math.round(minutes % 60)}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

function relative(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Number(numerator) / Number(denominator) : null
}

function change(current, previous) {
  if (previous === null || previous === undefined) return null
  if (Number(previous) === 0) return Number(current) > 0 ? 1 : 0
  return (Number(current) - Number(previous)) / Number(previous)
}

function Sparkline({ values }) {
  const points = useMemo(() => {
    if (!values.length) return ''
    const max = Math.max(...values, 1)
    return values
      .map((value, index) => `${(index / Math.max(values.length - 1, 1)) * 100},${28 - (value / max) * 24}`)
      .join(' ')
  }, [values])

  if (!points) return <div className="dash-spark-empty" />

  return (
    <svg className="dash-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function KpiTile({ title, detail, value, delta, comparison, footer }) {
  const direction = delta === null || delta === undefined ? 'flat' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'

  return (
    <article className="dash-tile">
      <div className="dash-tile-head">
        <span className="dash-tile-title">{title}</span>
        {detail ? <span className="dash-tile-detail" title={detail}>i</span> : null}
      </div>
      <div className="dash-tile-value">{value}</div>
      <div className="dash-tile-foot">
        {delta === null || delta === undefined ? (
          <span className="dash-delta dash-delta-flat">No prior data</span>
        ) : (
          <span className={`dash-delta dash-delta-${direction}`}>
            <Icon name={direction === 'down' ? 'trendingDown' : 'trendingUp'} size={13} />
            {Math.abs(Math.round(delta * 100))}%
          </span>
        )}
        {comparison ? <span className="dash-compare">{comparison}</span> : null}
        {footer}
      </div>
    </article>
  )
}

function SetupChecklist({ setup }) {
  const items = [
    { done: setup.whatsappConnected, label: 'Connect your WhatsApp number', to: '/settings' },
    { done: setup.templates > 0, label: 'Add a message template', to: '/templates' },
    { done: setup.quickReplies > 0, label: 'Create a quick reply', to: '/workspace' },
    { done: setup.contacts > 0, label: 'Import your first contact', to: '/contacts' },
    { done: setup.tags > 0, label: 'Organise contacts with tags', to: '/workspace' },
  ]
  const complete = items.filter((item) => item.done).length

  return (
    <section className="dash-card dash-setup">
      <div className="dash-card-head">
        <div>
          <h2>Get started with Aayojan AI CRM</h2>
          <p>{complete} of {items.length} setup steps complete</p>
        </div>
        <span className="dash-setup-count">{Math.round((complete / items.length) * 100)}%</span>
      </div>
      <ul className="dash-setup-list">
        {items.map((item) => (
          <li key={item.label} className={item.done ? 'is-done' : ''}>
            <Icon name={item.done ? 'checkCircle' : 'arrowRight'} size={17} />
            <span>{item.label}</span>
            {!item.done ? <Link to={item.to}>Open</Link> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

function MessageVolume({ series }) {
  const rows = series || []
  const max = Math.max(1, ...rows.flatMap((row) => [row.inbound, row.outbound]))
  const totalInbound = rows.reduce((sum, row) => sum + row.inbound, 0)
  const totalOutbound = rows.reduce((sum, row) => sum + row.outbound, 0)

  return (
    <section className="dash-card">
      <div className="dash-card-head">
        <div>
          <h2>Message volume</h2>
          <p>Inbound and outbound messages per day</p>
        </div>
        <div className="dash-legend">
          <span><i className="dash-legend-in" /> Inbound {number(totalInbound)}</span>
          <span><i className="dash-legend-out" /> Outbound {number(totalOutbound)}</span>
        </div>
      </div>
      {rows.length ? (
        <div className="dash-bars" role="img" aria-label="Message volume by day">
          {rows.map((row) => (
            <div className="dash-bar-group" key={row.date} title={`${row.date}: ${row.inbound} inbound, ${row.outbound} outbound`}>
              <div className="dash-bar-track">
                <div className="dash-bar dash-bar-in" style={{ height: `${(row.inbound / max) * 100}%` }} />
                <div className="dash-bar dash-bar-out" style={{ height: `${(row.outbound / max) * 100}%` }} />
              </div>
              {rows.length <= 14 || Number(row.date.slice(-2)) % 3 === 0 ? (
                <span className="dash-bar-label">{row.date.slice(5)}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="dash-empty">No message activity in this period.</div>
      )}
    </section>
  )
}

function ReplyQueue({ items }) {
  return (
    <section className="dash-card">
      <div className="dash-card-head">
        <div>
          <h2>Reply queue</h2>
          <p>Conversations waiting on your team</p>
        </div>
        <Link className="dash-link" to="/inbox">Open inbox <Icon name="arrowRight" size={14} /></Link>
      </div>
      {items?.length ? (
        <ul className="dash-queue">
          {items.slice(0, 6).map((item) => (
            <li key={item.id}>
              <span className="avatar">{String(item.contact?.name || item.contact?.phone || '?').charAt(0).toUpperCase()}</span>
              <span className="dash-queue-text">
                <strong>{item.contact?.name || item.contact?.phone || 'Unknown contact'}</strong>
                <span>{item.preview || 'New conversation'}</span>
              </span>
              <span className="dash-queue-meta">
                {item.unread ? <b className="dash-unread">{item.unread}</b> : null}
                <span>{duration(item.waitingMinutes)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="dash-empty">Inbox zero — nothing is waiting for a reply.</div>
      )}
    </section>
  )
}

function TeamCard({ team }) {
  return (
    <section className="dash-card">
      <div className="dash-card-head">
        <div>
          <h2>Team</h2>
          <p>Workload across active members</p>
        </div>
        <Link className="dash-link" to="/team">Manage <Icon name="arrowRight" size={14} /></Link>
      </div>
      {team?.length ? (
        <ul className="dash-team">
          {team.slice(0, 6).map((member) => (
            <li key={member.id}>
              <span className="avatar">{member.name.charAt(0).toUpperCase()}</span>
              <span className="dash-team-name">{member.name}</span>
              <span className="dash-team-metric"><b>{member.active}</b> active</span>
              <span className="dash-team-metric"><b>{member.replies}</b> replies</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="dash-empty">No active team members yet.</div>
      )}
    </section>
  )
}

function CampaignsCard({ campaigns }) {
  if (!campaigns) return null

  return (
    <section className="dash-card">
      <div className="dash-card-head">
        <div>
          <h2>Delivery</h2>
          <p>Outbound message performance</p>
        </div>
      </div>
      <div className="dash-mini-grid">
        <div><span>Sent</span><strong>{number(campaigns.sent)}</strong></div>
        <div><span>Delivered</span><strong>{number(campaigns.delivered)}</strong></div>
        <div><span>Read</span><strong>{number(campaigns.read)}</strong></div>
        <div><span>Failed</span><strong className={campaigns.failed ? 'dash-bad' : ''}>{number(campaigns.failed)}</strong></div>
        <div><span>Templates</span><strong>{number(campaigns.templates)}</strong></div>
        <div><span>Opted out</span><strong>{number(campaigns.optedOut)}</strong></div>
      </div>
      {campaigns.failures?.length ? (
        <ul className="dash-failures">
          {campaigns.failures.slice(0, 3).map((failure) => (
            <li key={failure.id}>
              <Icon name="alertCircle" size={14} />
              <span>{failure.contact}</span>
              <span>{failure.error || 'Delivery failed'}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function ActivityFeed({ items, loading }) {
  return (
    <section className="dash-card">
      <div className="dash-card-head">
        <div>
          <h2>Recent activity</h2>
          <p>Latest messages across all conversations</p>
        </div>
      </div>
      {loading ? (
        <div className="dash-empty"><span className="spinner" /> Loading activity…</div>
      ) : items?.length ? (
        <ul className="dash-activity">
          {items.slice(0, 12).map((item) => (
            <li key={item.id}>
              <span className={`dash-activity-icon dash-activity-${item.type}`}>
                <Icon name={item.type === 'customer' ? 'inbox' : 'send'} size={14} />
              </span>
              <span className="dash-activity-text">
                <strong>{item.title}</strong>
                <span>{item.preview || item.status}</span>
              </span>
              <time>{relative(item.timestamp)}</time>
            </li>
          ))}
        </ul>
      ) : (
        <div className="dash-empty">No messages yet.</div>
      )}
    </section>
  )
}

export default function DashboardPage() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const rawRange = Number(params.get('range'))
  const range = RANGES.includes(rawRange) ? rawRange : 30

  const [overview, setOverview] = useState(null)
  const [campaigns, setCampaigns] = useState(null)
  const [activity, setActivity] = useState([])
  const [activityLoading, setActivityLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    try {
      const [overviewResult, campaignsResult, activityResult] = await Promise.all([
        api.get('/api/app/dashboard/overview', { params: { days: range } }),
        api.get('/api/app/dashboard/campaigns', { params: { days: range } }),
        api.get('/api/app/dashboard/activity', { params: { limit: 50 } }),
      ])
      setOverview(overviewResult.data)
      setCampaigns(campaignsResult.data)
      setActivity(Array.isArray(activityResult.data) ? activityResult.data : [])
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setActivityLoading(false)
    }
  }, [range])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, 60000)
    return () => window.clearInterval(timer)
  }, [load])

  const setRange = (next) => {
    const updated = new URLSearchParams(params)
    updated.set('range', String(next))
    setParams(updated, { replace: true })
  }

  if (failed && !overview) {
    return (
      <div className="dash-error">
        <Icon name="alertCircle" size={22} />
        <p>Dashboard data could not be loaded.</p>
        <button type="button" className="button button-primary" onClick={load}>Try again</button>
      </div>
    )
  }

  const kpis = overview?.kpis
  const volume = overview?.volume?.series || []
  const setup = overview?.setup
  const setupIncomplete = setup && (
    !setup.whatsappConnected || !setup.templates || !setup.quickReplies || !setup.contacts || !setup.tags
  )
  const readRate = ratio(kpis?.broadcastRead, kpis?.broadcastDelivered)
  const previousReadRate = ratio(kpis?.broadcastReadPrevious, kpis?.broadcastDeliveredPrevious)
  const greeting = user?.name ? `, ${user.name.split(' ')[0]}` : ''

  return (
    <div className="dash-page">
      <header className="dash-header">
        <div>
          <h1>Welcome back{greeting}</h1>
          <p>Here is what is happening across Aayojan AI CRM.</p>
          <p className="dash-config">
            Configured WhatsApp Phone Number ID: <strong>{setup?.whatsappPhoneNumberId || 'Not configured'}</strong>
            <span>{setup?.whatsappConnected ? 'Connected' : 'Not connected'}</span>
          </p>
        </div>
        <div className="dash-range" role="group" aria-label="Dashboard range">
          {RANGES.map((option) => (
            <button
              key={option}
              type="button"
              className={range === option ? 'is-active' : ''}
              onClick={() => setRange(option)}
            >
              {option}d
            </button>
          ))}
        </div>
      </header>

      {!overview ? (
        <div className="dash-loading"><span className="spinner" /> Loading dashboard…</div>
      ) : (
        <>
          {setupIncomplete ? <SetupChecklist setup={setup} /> : null}
          <div className="dash-kpis">
            <KpiTile
              title="New conversations"
              detail="Conversations created in this period"
              value={number(kpis.newConversations)}
              delta={change(kpis.newConversations, kpis.newConversationsPrevious)}
              comparison={`vs previous ${range}d`}
              footer={<Sparkline values={volume.map((row) => row.newConversations)} />}
            />
            <KpiTile
              title="Median first reply"
              detail="Median time from first inbound message to first reply"
              value={duration(overview.replies.medianHuman)}
              delta={overview.replies.medianHuman !== null && overview.replies.medianHumanPrevious !== null
                ? -change(overview.replies.medianHuman, overview.replies.medianHumanPrevious)
                : null}
              comparison={`vs previous ${range}d`}
              footer={<span className="dash-target">Target: {duration(overview.replyTargetMinutes)}</span>}
            />
            <KpiTile
              title="Resolved"
              detail="Conversations closed in this period"
              value={number(kpis.resolved)}
              delta={change(kpis.resolved, kpis.resolvedPrevious)}
              comparison={`vs previous ${range}d`}
              footer={<Sparkline values={volume.map((row) => row.resolved)} />}
            />
            <KpiTile
              title="Read rate"
              detail="Share of outbound messages that were read"
              value={percent(readRate)}
              delta={previousReadRate !== null && readRate !== null ? change(readRate, previousReadRate) : null}
              comparison={`vs previous ${range}d`}
              footer={<span className="dash-target">{number(kpis.broadcastRead)} of {number(kpis.broadcastDelivered)} messages read</span>}
            />
          </div>

          <div className="dash-split dash-split-wide">
            <MessageVolume series={volume} />
            <ReplyQueue items={overview.attention} />
          </div>

          <div className="dash-split">
            <TeamCard team={overview.replies.team} />
            <CampaignsCard campaigns={campaigns} />
          </div>

          <ActivityFeed items={activity} loading={activityLoading} />
        </>
      )}
    </div>
  )
}
