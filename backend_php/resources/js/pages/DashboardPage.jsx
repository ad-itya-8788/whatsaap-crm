import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from '@inertiajs/react'
import { useSearchParams } from '../lib/navigation.js'
import api from '../api/client.js'
import Icon from '../components/common/Icon.jsx'
import { errorMessage } from '../lib/utils.js'
import { useAuth } from '../context/AuthContext.jsx'

const RANGES = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
]

function number(value) {
  if (value === null || value === undefined || value === '') return '—'
  const parsed = Number(value)
  return Number.isFinite(parsed) ? new Intl.NumberFormat().format(parsed) : '—'
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
  if (current === null || current === undefined || previous === null || previous === undefined) return null
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
      <polygon points={`0,30 ${points} 100,30`} fill="currentColor" opacity=".12" />
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function ReplyTargetScale({ value, target }) {
  const max = Math.max(target * 2, 1)
  const fill = value === null || value === undefined ? 0 : Math.min(100, (value / max) * 100)

  return (
    <div className="dash-target-scale" role="img" aria-label={`Reply target ${duration(target)}; current median ${duration(value)}`}>
      <div className="dash-target-track">
        <span className="dash-target-fill" style={{ width: `${fill}%` }} />
        <span className="dash-target-marker" />
      </div>
      <div className="dash-target-labels"><span>0</span><span>Target {duration(target)}</span><span>{duration(max)}</span></div>
    </div>
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
          <span className="dash-delta dash-delta-flat"><span aria-hidden="true">—</span> No change</span>
        ) : (
          <span className={`dash-delta dash-delta-${direction}`}>
            {direction === 'flat'
              ? <span aria-hidden="true">—</span>
              : <Icon name={direction === 'down' ? 'trendingDown' : 'trendingUp'} size={13} />}
            {Math.abs(Math.round(delta * 100))}%
          </span>
        )}
        {comparison ? <span className="dash-compare">{comparison}</span> : null}
      </div>
      <div className="dash-tile-visual">{footer}</div>
    </article>
  )
}

function AttentionTile({ icon, tone, value, label, meta, to, onClick }) {
  const body = (
    <>
      <span className={`dash-attention-icon dash-attention-${tone}`}><Icon name={icon} size={17} /></span>
      <span className="dash-attention-copy">
        <span><strong>{number(value)}</strong> {label}</span>
        <small>{meta}</small>
      </span>
      <Icon name="arrowRight" size={15} className="dash-attention-chevron" />
    </>
  )

  if (onClick) {
    return <button type="button" className="dash-attention-tile" onClick={onClick}>{body}</button>
  }

  return <Link className="dash-attention-tile" href={to}>{body}</Link>
}

function FailedMessagesDialog({ open, messages, total, onClose }) {
  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="dash-failed-dialog" role="dialog" aria-modal="true" aria-labelledby="dash-failed-title">
        <div className="dash-failed-head">
          <div>
            <h2 id="dash-failed-title">Failed messages</h2>
            <p>Latest delivery failures in the last 24 hours.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" size={17} /></button>
        </div>
        {messages?.length ? (
          <ul className="dash-failed-list">
            {messages.map((message) => (
              <li key={message.id}>
                <Link href={`/inbox?c=${message.conversationId}`} onClick={onClose}>
                  <span className="dash-failed-contact">{message.contactName || message.contactPhone || 'Unknown contact'}</span>
                  <time dateTime={message.at}>{message.at ? new Date(message.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</time>
                  <span className="dash-failed-reason">
                    {message.errorTitle || 'Unknown reason'}{message.errorCode ? ` (${message.errorCode})` : ''}
                  </span>
                  {message.preview ? <span className="dash-failed-preview">{message.preview}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="dash-empty">No failed messages in the last 24 hours.</div>
        )}
        {total > (messages?.length || 0) ? <p className="dash-failed-foot">Showing the latest {messages.length} of {number(total)} failures.</p> : null}
      </div>
    </div>
  )
}

function AttentionRow({ data, onlineCount }) {
  const [failedOpen, setFailedOpen] = useState(false)
  const attention = data.attention || {}
  const oldest = attention.oldestWaitingSince
    ? duration((Date.now() - new Date(attention.oldestWaitingSince).getTime()) / 60000)
    : null

  return (
    <>
      <div className="dash-attention-grid">
        <AttentionTile
          icon="chat"
          tone={attention.waitingOverTarget > 0 ? 'critical' : attention.waiting > 0 ? 'warning' : 'calm'}
          value={attention.waiting || 0}
          label="waiting"
          meta={oldest ? `Oldest ${oldest} · ${number(attention.waitingOverTarget || 0)} over target` : 'No conversations waiting'}
          href="/inbox?filter=waiting"
        />
        <AttentionTile
          icon="users"
          tone={attention.unassigned > 0 ? 'warning' : 'calm'}
          value={attention.unassigned || 0}
          label="unassigned"
          meta={`${number(onlineCount)} team member${onlineCount === 1 ? '' : 's'} online`}
          href="/inbox?filter=unassigned"
        />
        <AttentionTile
          icon="clock"
          tone={attention.windowsClosing > 0 ? 'serious' : 'calm'}
          value={attention.windowsClosing || 0}
          label="windows closing"
          meta="24-hour reply window closes soon"
          href="/inbox?filter=expiring"
        />
        <AttentionTile
          icon="alert"
          tone={attention.failed > 0 ? 'critical' : 'calm'}
          value={attention.failed || 0}
          label="failed messages"
          meta="Delivery failures in the last 24 hours"
          onClick={() => setFailedOpen(true)}
        />
      </div>
      <FailedMessagesDialog
        open={failedOpen}
        messages={attention.failedMessages || []}
        total={attention.failed || 0}
        onClose={() => setFailedOpen(false)}
      />
    </>
  )
}

function formatHour(hour) {
  const date = new Date(2000, 0, 1, hour)
  return date.toLocaleTimeString([], { hour: 'numeric' })
}

function dayLabel(value, days = 7) {
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString([], days <= 7 ? { weekday: 'short' } : { day: 'numeric', month: 'short' })
}

function MessageVolume({ series, hours, view, onViewChange, hourlyLoading, hourlyError }) {
  const rows = series || []
  const chartRows = view === 'hours' ? hours : rows
  const max = Math.max(1, ...chartRows.map((row) => row.inbound + row.outbound))
  const totalInbound = rows.reduce((sum, row) => sum + row.inbound, 0)
  const totalOutbound = rows.reduce((sum, row) => sum + row.outbound, 0)
  const averageInbound = rows.length ? Math.round(totalInbound / rows.length) : 0
  const busiestDay = rows.reduce((busiest, row) => {
    const total = row.inbound + row.outbound
    return total > (busiest?.inbound ?? -1) + (busiest?.outbound ?? 0) ? row : busiest
  }, null)
  const busiestHour = (hours || []).reduce((busiest, row) => {
    const total = row.inbound + row.outbound
    return total > (busiest?.inbound ?? -1) + (busiest?.outbound ?? 0) ? row : busiest
  }, null)
  const ticks = [1, 0.75, 0.5, 0.25, 0]

  return (
    <section className="dash-card dash-volume-card">
      <div className="dash-card-head">
        <div>
          <h2>Message volume</h2>
          <p>Incoming and outgoing messages</p>
        </div>
        <div className="dash-chart-tabs" role="group" aria-label="Message volume view">
          <button type="button" className={view === 'days' ? 'is-active' : ''} aria-pressed={view === 'days'} onClick={() => onViewChange('days')}>By day</button>
          <button type="button" className={view === 'hours' ? 'is-active' : ''} aria-pressed={view === 'hours'} onClick={() => onViewChange('hours')}>Busiest hours</button>
        </div>
      </div>
      <div className="dash-volume-summary">
        <div><span>Incoming</span><strong>{number(totalInbound)}</strong></div>
        <div><span>Outgoing</span><strong>{number(totalOutbound)}</strong></div>
        <div><span>Incoming per day</span><strong>{number(averageInbound)}</strong></div>
        <div>
          <span>{view === 'hours' ? 'Busiest hour' : 'Busiest day'}</span>
          <strong>{view === 'hours'
            ? busiestHour && (busiestHour.inbound + busiestHour.outbound) > 0 ? formatHour(busiestHour.hour) : '—'
            : busiestDay && (busiestDay.inbound + busiestDay.outbound) > 0 ? dayLabel(busiestDay.date) : '—'}</strong>
        </div>
      </div>
      <div className="dash-volume-legend">
      <span><i className="dash-legend-in" /> Incoming</span>
      <span><i className="dash-legend-out" /> Outgoing</span>
      </div>
      {view === 'hours' && hourlyLoading ? (
        <div className="dash-chart-message"><span className="spinner" /> Loading hourly activity…</div>
      ) : view === 'hours' && hourlyError ? (
        <div className="dash-chart-message is-error" role="alert">{hourlyError}</div>
      ) : chartRows?.length ? (
        <div className="dash-chart" role="img" aria-label={`Message volume ${view === 'hours' ? 'by hour' : 'by day'}`}>
          <div className="dash-chart-axis" aria-hidden="true">
            {ticks.map((tick) => {
              const value = max * tick
              const label = max <= 4 && !Number.isInteger(value)
                ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
                : number(Math.round(value))
              return <span key={tick}>{label}</span>
            })}
          </div>
          <div className="dash-chart-plot">
            <div className="dash-chart-gridlines" aria-hidden="true">
              {ticks.map((tick) => <i key={tick} />)}
            </div>
            <div className="dash-bars">
              {chartRows.map((row, index) => {
                const key = view === 'hours' ? row.hour : row.date
                const label = view === 'hours' ? formatHour(row.hour) : dayLabel(row.date, chartRows.length)
                const total = row.inbound + row.outbound
                const labelStep = chartRows.length > 60 ? 7 : chartRows.length > 14 ? 3 : 1
                return (
                  <div className="dash-bar-group" key={key} title={`${label}: ${row.inbound} incoming, ${row.outbound} outgoing`}>
                    <div className="dash-bar-track">
                      <div className="dash-bar-stack" style={{ height: `${(total / max) * 100}%` }}>
                        {total > 0 ? (
                          <>
                            <div className="dash-bar dash-bar-out" style={{ height: `${(row.outbound / total) * 100}%` }} />
                            <div className="dash-bar dash-bar-in" style={{ height: `${(row.inbound / total) * 100}%` }} />
                          </>
                        ) : null}
                      </div>
                    </div>
                    {(view === 'days' && (index % labelStep === 0 || index === chartRows.length - 1))
                      || (view === 'hours' && Number(row.hour) % 3 === 0)
                      ? <span className="dash-bar-label">{label}</span>
                      : null}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      ) : <div className="dash-chart-message">No message activity in this period.</div>}
    </section>
  )
}

function ReplyQueue({ items, team, replyTargetMinutes }) {
  const names = new Map((team || []).map((member) => [String(member.id), member.name]))

  return (
    <section className="dash-card dash-queue-card">
      <div className="dash-card-head">
        <div>
          <h2>Reply queue</h2>
          <p>Longest wait first</p>
        </div>
        <Link className="dash-link" href="/inbox?filter=waiting">Open inbox</Link>
      </div>
      {items?.length ? (
        <ul className="dash-queue">
          {items.slice(0, 6).map((item) => (
            <li key={item.conversationId}>
              <Link className="dash-queue-link" href={`/inbox?c=${item.conversationId}`}>
                <span className="avatar">{String(item.contactName || item.contactPhone || '?').charAt(0).toUpperCase()}</span>
                <span className="dash-queue-text">
                  <strong>{item.contactName || item.contactPhone || 'Unknown contact'}</strong>
                  <span>{item.preview || 'New conversation'}</span>
                </span>
                <span className="dash-queue-meta">
                  {item.unread ? <b className="dash-unread">{item.unread}</b> : null}
                  <strong className={`dash-queue-wait${item.waitingMinutes >= replyTargetMinutes ? ' is-overdue' : ''}`}>
                    {duration(item.waitingMinutes)}
                  </strong>
                  <span>{item.assignedAgentId ? names.get(String(item.assignedAgentId)) || 'Assigned' : 'Unassigned'}</span>
                </span>
              </Link>
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
          <p>Replies in this period</p>
        </div>
        <Link className="dash-link" href="/team">Members</Link>
      </div>
      {team?.length ? (
        <div className="dash-team-table-wrap">
          <table className="dash-team-table">
            <thead><tr><th>Member</th><th>Open</th><th>Replies</th><th>Median reply</th></tr></thead>
            <tbody>
              {team.slice(0, 6).map((member) => (
                <tr key={member.id}>
                  <td><span className="dash-team-member"><span className="avatar">{member.name.charAt(0).toUpperCase()}</span><strong>{member.name}</strong></span></td>
                  <td>{number(member.active)}</td>
                  <td>{number(member.replies)}</td>
                  <td>{duration(member.medianMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="dash-empty">No active team members yet.</div>
      )}
    </section>
  )
}

function CampaignsCard({ campaigns }) {
  if (!campaigns) return null
  const latest = campaigns.latestBroadcast

  return (
    <section className="dash-card">
      <div className="dash-card-head">
        <div>
          <h2>Campaigns and automations</h2>
          <p>In this period</p>
        </div>
        <Link className="dash-link" href="/broadcasts">Broadcasts</Link>
      </div>
      {latest ? (
        <Link className="dash-latest-broadcast" href={`/broadcasts/${latest.id}`}>
          <span><strong>{latest.name}</strong><small>{number(latest.recipients)} recipients · {latest.status}</small></span>
          <Icon name="arrowRight" size={14} />
        </Link>
      ) : <p className="dash-no-broadcasts">No broadcasts sent yet.</p>}
      <ul className="dash-health-list">
        <li><span>Automations</span><span className="is-unavailable">Unavailable</span></li>
        <li><span>Flows</span><span className="is-unavailable">Unavailable</span></li>
      </ul>
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
        <div className="dash-activity-skeleton" role="status" aria-label="Loading activity">
          {Array.from({ length: 4 }).map((_, index) => <span className="dash-skeleton-block" key={index} />)}
        </div>
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

function DashboardSkeleton() {
  return (
    <div className="dash-skeleton" role="status" aria-label="Loading dashboard">
      <div className="dash-attention-grid">
        {Array.from({ length: 4 }).map((_, index) => <span className="dash-skeleton-block" key={index} />)}
      </div>
      <div className="dash-kpis">
        {Array.from({ length: 4 }).map((_, index) => <span className="dash-skeleton-block" key={index} />)}
      </div>
      <div className="dash-split dash-split-wide">
        <span className="dash-skeleton-block" />
        <span className="dash-skeleton-block" />
      </div>
      <div className="dash-split">
        <span className="dash-skeleton-block" />
        <span className="dash-skeleton-block" />
      </div>
      <span className="visually-hidden">Loading dashboard data…</span>
    </div>
  )
}

export default function DashboardPage() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const rawRange = Number(params.get('range'))
  const range = RANGES.some((option) => option.days === rawRange) ? rawRange : 7

  const [overview, setOverview] = useState(null)
  const [campaigns, setCampaigns] = useState(null)
  const [activity, setActivity] = useState([])
  const [activityLoading, setActivityLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [volumeView, setVolumeView] = useState('days')
  const [hourlyVolume, setHourlyVolume] = useState([])
  const [hourlyLoading, setHourlyLoading] = useState(false)
  const [hourlyError, setHourlyError] = useState('')

  const load = useCallback(async (signal) => {
    const options = { signal, timeout: 30_000 }
    try {
      const { data } = await api.get('/api/app/dashboard/overview', { ...options, params: { days: range } })
      if (signal?.aborted) return
      setOverview(data)
      setFailed(false)
    } catch {
      if (!signal?.aborted) setFailed(true)
      return
    }

    const [campaignsResult, activityResult] = await Promise.allSettled([
      api.get('/api/app/dashboard/campaigns', { ...options, params: { days: range } }),
      api.get('/api/app/dashboard/activity', { ...options, params: { limit: 50 } }),
    ])
    if (signal?.aborted) return
    if (campaignsResult.status === 'fulfilled') setCampaigns(campaignsResult.value.data)
    if (activityResult.status === 'fulfilled') {
      const { data } = activityResult.value
      setActivity(Array.isArray(data) ? data : [])
    }
    setActivityLoading(false)
  }, [range])

  useEffect(() => {
    if (volumeView !== 'hours') return undefined

    let cancelled = false
    setHourlyLoading(true)
    setHourlyError('')
    api.get('/api/app/dashboard/hourly-volume', { params: { days: range }, timeout: 30_000 })
      .then(({ data }) => {
        if (!cancelled) setHourlyVolume(Array.isArray(data) ? data : [])
      })
      .catch((requestError) => {
        if (!cancelled) setHourlyError(errorMessage(requestError, 'Unable to load hourly message volume.'))
      })
      .finally(() => {
        if (!cancelled) setHourlyLoading(false)
      })

    return () => { cancelled = true }
  }, [range, volumeView])

  useEffect(() => {
    const controller = new AbortController()
    let refreshing = false
    const refresh = async () => {
      if (refreshing) return
      refreshing = true
      await load(controller.signal)
      refreshing = false
    }
    refresh()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, 60000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
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
        <button type="button" className="button button-primary" onClick={() => { setFailed(false); load() }}>Try again</button>
      </div>
    )
  }

  const kpis = overview?.kpis
  const volume = overview?.volume?.series || []
  const setup = overview?.setup
  const onlineCount = (overview?.replies?.team || []).filter((member) => member.presence === 'online').length
  const readRate = ratio(kpis?.broadcastRead, kpis?.broadcastDelivered)
  const previousReadRate = ratio(kpis?.broadcastReadPrevious, kpis?.broadcastDeliveredPrevious)
  const broadcastCount = kpis?.broadcastCount ?? campaigns?.broadcastCount
  const hasBroadcasts = Number(broadcastCount) > 0
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = user?.name?.split(' ')[0] || 'there'
  const waiting = overview?.attention?.waiting || 0
  const oldest = overview?.attention?.oldestWaitingSince
    ? duration((Date.now() - new Date(overview.attention.oldestWaitingSince).getTime()) / 60000)
    : null

  return (
    <div className="dash-page">
      <header className="dash-header">
        <div className="dash-intro">
          <h1>{greeting}, {firstName}</h1>
          <p>{!overview ? 'Loading dashboard data…' : waiting
            ? `${number(waiting)} customer${waiting === 1 ? ' is' : 's are'} waiting for a reply${oldest ? `, the oldest for ${oldest}` : ''}.`
            : 'No customers are waiting for a reply.'}</p>
        </div>
        <div className="dash-header-actions">
          <Link className={`dash-whatsapp-status${setup?.whatsappConnected ? ' is-connected' : ''}`} href="/settings?tab=whatsapp">
            <span className="status-dot" />
            <span>
              {[
                setup?.whatsappDisplayPhone || setup?.displayPhoneNumber,
                setup?.whatsappQualityRating || setup?.qualityRating,
                setup?.whatsappDailyLimit || setup?.dailyLimit,
              ].filter(Boolean).join(' · ') || (!overview ? 'Checking WhatsApp status' : setup?.whatsappConnected ? 'WhatsApp connected' : 'WhatsApp not connected')}
            </span>
          </Link>
          <div className="dash-toolbar">
            <div className="dash-range" role="group" aria-label="Dashboard range">
              {RANGES.map((option) => (
                <button
                  key={option.days}
                  type="button"
                  className={range === option.days ? 'is-active' : ''}
                  aria-pressed={range === option.days}
                  onClick={() => setRange(option.days)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <details className="dash-new-menu">
              <summary className="dash-new-button"><Icon name="plus" size={15} /> New <span className="dash-new-chevron" /></summary>
              <div className="dash-new-popover">
                <Link href="/contacts"><Icon name="user" size={15} /> New contact</Link>
                <Link href="/broadcasts/new"><Icon name="radio" size={15} /> New broadcast</Link>
              </div>
            </details>
          </div>
        </div>
      </header>

      {!overview ? (
        <DashboardSkeleton />
      ) : (
        <>
          <AttentionRow data={overview} onlineCount={onlineCount} />
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
              delta={overview.replies.medianHuman != null && overview.replies.medianHumanPrevious != null
                ? -change(overview.replies.medianHuman, overview.replies.medianHumanPrevious)
                : null}
              comparison={`vs previous ${range}d`}
              footer={<ReplyTargetScale value={overview.replies.medianHuman} target={overview.replyTargetMinutes} />}
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
              title="Broadcast read rate"
              detail="Share of broadcast messages that were read"
              value={hasBroadcasts ? percent(readRate) : '—'}
              delta={previousReadRate !== null && readRate !== null ? change(readRate, previousReadRate) : null}
              comparison={`vs previous ${range}d`}
              footer={<span className="dash-broadcast-empty">
                {hasBroadcasts
                  ? `${number(kpis.broadcastRead)} of ${number(kpis.broadcastDelivered)} messages read`
                  : Number(broadcastCount) === 0 ? 'No broadcasts in this period' : 'Broadcast data unavailable'}
              </span>}
            />
          </div>

          <div className="dash-split dash-split-wide">
            <MessageVolume
              series={volume}
              hours={hourlyVolume}
              view={volumeView}
              onViewChange={setVolumeView}
              hourlyLoading={hourlyLoading}
              hourlyError={hourlyError}
            />
            <ReplyQueue
              items={overview.queue}
              team={overview.replies.team}
              replyTargetMinutes={overview.replyTargetMinutes}
            />
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
