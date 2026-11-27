import { hasModuleAccess, moduleForPath } from '../lib/moduleAccess.js'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link as InertiaLink } from '@inertiajs/react'
import { useSearchParams } from '../lib/navigation.js'
import api from '../api/client.js'
import Icon from '../components/common/Icon.jsx'
import { errorMessage, friendlyProviderMessage } from '../lib/utils.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useWhatsappConfig } from '../lib/whatsappConfig.js'

function Link({ href, children, preserveContent = false, ...props }) {
  const { user } = useAuth()
  if (!hasModuleAccess(user, moduleForPath(user, href))) return preserveContent ? <span>{children}</span> : null
  return <InertiaLink href={href} {...props}>{children}</InertiaLink>
}

const RANGES = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
]

const KPI_TONES = ['green', 'blue', 'purple', 'red']

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
  return Number(denominator) > 0 ? Number(numerator) / Number(denominator) : null
}

function change(current, previous) {
  if (current === null || current === undefined || previous === null || previous === undefined) return null
  if (Number(previous) === 0) return Number(current) > 0 ? 1 : 0
  return (Number(current) - Number(previous)) / Number(previous)
}

function sum(values) {
  return (values || []).reduce((total, value) => total + (Number(value) || 0), 0)
}

function Sparkline({ values, tone }) {
  const points = useMemo(() => {
    const source = Array.isArray(values) ? values : []
    if (!source.length) return ''
    const max = Math.max(...source, 1)
    return source
      .map((value, index) => `${(index / Math.max(source.length - 1, 1)) * 100},${28 - (Math.max(0, value) / max) * 24}`)
      .join(' ')
  }, [values])

  if (!points) return <div className="dash-chart-unavailable">History unavailable</div>

  return (
    <svg className={`dash-spark dash-spark-${tone}`} viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,30 ${points} 100,30`} fill="currentColor" opacity=".14" />
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function KpiCard({ title, value, icon, tone, detail, delta, comparison, values }) {
  const direction = delta === null || delta === undefined ? 'flat' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'

  return (
    <article className="dash-card dash-kpi">
      <div className="dash-kpi-top">
        <span className={`dash-kpi-icon dash-kpi-${tone}`}><Icon name={icon} size={17} /></span>
        <span className="dash-kpi-title" title={detail}>{title}</span>
      </div>
      <strong className="dash-kpi-value">{value}</strong>
      <div className="dash-kpi-foot">
        {delta === null || delta === undefined ? (
          <span className="dash-delta dash-delta-flat">Comparison unavailable</span>
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
      <div className="dash-kpi-visual"><Sparkline values={values} tone={tone} /></div>
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

  return <Link preserveContent className="dash-attention-tile" href={to}>{body}</Link>
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
            {messages.map((message) => {
              const reason = friendlyProviderMessage(message.errorCode, message.errorTitle)
                || message.failureReason
                || 'Delivery failed'
              const technical = [message.errorTitle, message.errorCode ? `Code ${message.errorCode}` : null].filter(Boolean).join(' · ')
              return (
                <li key={message.id}>
                  <Link preserveContent href={`/inbox?c=${message.conversationId}`} onClick={onClose} title={technical || undefined}>
                    <span className="dash-failed-contact">{message.contactName || message.contactPhone || 'Unknown contact'}</span>
                    <time dateTime={message.at}>{message.at ? new Date(message.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</time>
                    <span className="dash-failed-reason">{reason}</span>
                    {message.preview ? <span className="dash-failed-preview">{message.preview}</span> : null}
                  </Link>
                </li>
              )
            })}
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
          tone={attention.waitingOverTarget > 0 ? 'red' : attention.waiting > 0 ? 'amber' : 'green'}
          value={attention.waiting || 0}
          label="waiting"
          meta={oldest ? `Oldest ${oldest} · ${number(attention.waitingOverTarget || 0)} over target` : 'No conversations waiting'}
          to="/inbox?filter=waiting"
        />
        <AttentionTile
          icon="users"
          tone={attention.unassigned > 0 ? 'amber' : 'green'}
          value={attention.unassigned || 0}
          label="unassigned"
          meta={`${number(onlineCount)} team member${onlineCount === 1 ? '' : 's'} online`}
          to="/inbox?filter=unassigned"
        />
        <AttentionTile
          icon="clock"
          tone={attention.windowsClosing > 0 ? 'purple' : 'green'}
          value={attention.windowsClosing || 0}
          label="windows closing"
          meta="24-hour reply window closes soon"
          to="/inbox?filter=expiring"
        />
        <AttentionTile
          icon="alert"
          tone={attention.failed > 0 ? 'red' : 'green'}
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
  return new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: 'numeric' })
}

function dayLabel(value, days = 7) {
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString([], days <= 7 ? { weekday: 'short' } : { day: 'numeric', month: 'short' })
}

function MessageVolume({ series, hours, view, onViewChange, hourlyLoading, hourlyError }) {
  const rows = Array.isArray(view === 'hours' ? hours : series) ? (view === 'hours' ? hours : series) : []
  const max = Math.max(1, ...rows.map((row) => Math.max(Number(row.inbound) || 0, Number(row.outbound) || 0)))
  const totalInbound = sum(series.map((row) => row.inbound))
  const totalOutbound = sum(series.map((row) => row.outbound))
  const average = rows.length ? Math.round((sum(rows.map((row) => (Number(row.inbound) || 0) + (Number(row.outbound) || 0)))) / rows.length) : 0
  const busiest = rows.reduce((best, row) => {
    const total = (Number(row.inbound) || 0) + (Number(row.outbound) || 0)
    return total > (best?.total ?? -1) ? { row, total } : best
  }, null)
  const hasData = rows.some((row) => (Number(row.inbound) || 0) + (Number(row.outbound) || 0) > 0)
  const ticks = [1, 0.75, 0.5, 0.25, 0]

  return (
    <section className="dash-card dash-volume">
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
        <div><span>Incoming</span><strong className="is-blue">{number(totalInbound)}</strong></div>
        <div><span>Outgoing</span><strong>{number(totalOutbound)}</strong></div>
        <div><span>Average / {view === 'hours' ? 'hour' : 'day'}</span><strong>{number(average)}</strong></div>
        <div>
          <span>{view === 'hours' ? 'Busiest hour' : 'Busiest day'}</span>
          <strong>{busiest?.total > 0
            ? view === 'hours' ? formatHour(busiest.row.hour) : dayLabel(busiest.row.date, rows.length)
            : '—'}</strong>
        </div>
      </div>
      <div className="dash-volume-legend">
        <span><i className="dash-legend-dot is-in" /> Incoming</span>
        <span><i className="dash-legend-dot is-out" /> Outgoing</span>
      </div>
      {view === 'hours' && hourlyLoading ? (
        <div className="dash-chart-message"><span className="spinner" /> Loading hourly activity…</div>
      ) : view === 'hours' && hourlyError ? (
        <div className="dash-chart-message is-error" role="alert">{hourlyError}</div>
      ) : !rows.length ? (
        <div className="dash-chart-message">Message history unavailable for this period.</div>
      ) : !hasData ? (
        <div className="dash-chart-message">No messages in this period.</div>
      ) : (
        <div className="dash-chart" role="img" aria-label={`Message volume ${view === 'hours' ? 'by hour' : 'by day'}`}>
          <div className="dash-chart-axis" aria-hidden="true">
            {ticks.map((tick) => <span key={tick}>{number(Math.round(max * tick))}</span>)}
          </div>
          <div className="dash-chart-plot">
            <div className="dash-chart-gridlines" aria-hidden="true">{ticks.map((tick) => <i key={tick} />)}</div>
            <div className="dash-bars">
              {rows.map((row, index) => {
                const key = view === 'hours' ? row.hour : row.date
                const label = view === 'hours' ? formatHour(row.hour) : dayLabel(row.date, rows.length)
                const inbound = Number(row.inbound) || 0
                const outbound = Number(row.outbound) || 0
                const labelStep = rows.length > 60 ? 7 : rows.length > 14 ? 3 : 1
                const showLabel = view === 'hours' ? Number(row.hour) % 3 === 0 : index % labelStep === 0 || index === rows.length - 1
                return (
                  <div className="dash-bar-group" key={key} title={`${label}: ${inbound} incoming, ${outbound} outgoing`}>
                    <div className="dash-bar-track">
                      <span className="dash-bar dash-bar-in" style={{ height: `${(inbound / max) * 100}%` }} />
                      <span className="dash-bar dash-bar-out" style={{ height: `${(outbound / max) * 100}%` }} />
                    </div>
                    {showLabel ? <span className="dash-bar-label">{label}</span> : null}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function ReplyPerformance({ overview }) {
  const median = overview.replies?.medianHuman
  const previous = overview.replies?.medianHumanPrevious
  const target = Number(overview.replyTargetMinutes) || 15
  const scaleMax = Math.max(target * 2, 1)
  const fill = median === null || median === undefined ? 0 : Math.min(100, (Number(median) / scaleMax) * 100)
  const marker = Math.min(100, (target / scaleMax) * 100)
  const hasMedian = median !== null && median !== undefined
  const onTarget = hasMedian && Number(median) <= target
  const attention = overview.attention || {}

  return (
    <section className="dash-card dash-performance">
      <div className="dash-card-head">
        <div>
          <h2>Reply performance</h2>
          <p>First response in this period</p>
        </div>
        <span className={`dash-perf-badge ${hasMedian ? (onTarget ? 'is-good' : 'is-warn') : 'is-muted'}`}>
          {!hasMedian ? 'No data' : onTarget ? 'Within target' : 'Above target'}
        </span>
      </div>
      <div className="dash-perf-hero">
        <span className="dash-perf-icon"><Icon name="clock" size={20} /></span>
        <div>
          <strong>{duration(median)}</strong>
          <span>Median first reply</span>
        </div>
      </div>
      <div className="dash-target-scale" role="img" aria-label={`Reply target ${duration(target)}; current median ${duration(median)}`}>
        <div className="dash-target-track">
          <span className="dash-target-fill" style={{ width: `${fill}%` }} />
          <span className="dash-target-marker" style={{ left: `${marker}%` }} />
        </div>
        <div className="dash-target-labels">
          <span>0</span>
          <span>Target {duration(target)}</span>
          <span>{duration(scaleMax)}</span>
        </div>
      </div>
      <ul className="dash-perf-list">
        <li><span>Waiting conversations</span><strong>{number(attention.waiting || 0)}</strong></li>
        <li><span>Over target</span><strong className={(attention.waitingOverTarget || 0) > 0 ? 'is-red' : ''}>{number(attention.waitingOverTarget || 0)}</strong></li>
        <li><span>Resolved conversations</span><strong>{number(overview.kpis?.resolved)}</strong></li>
        <li>
          <span>vs previous period</span>
          <strong className={previous !== null && median !== null && Number(median) <= Number(previous) ? 'is-green' : ''}>
            {previous === null || previous === undefined || !hasMedian ? '—' : duration(previous)}
          </strong>
        </li>
      </ul>
    </section>
  )
}

function messageTone(item) {
  if (item.type === 'customer') return 'incoming'
  const status = String(item.status || '').toLowerCase()
  if (status === 'failed') return 'failed'
  if (status === 'pending') return 'pending'
  if (status === 'read') return 'read'
  if (status === 'delivered') return 'delivered'
  if (status === 'sent') return 'sent'
  return 'neutral'
}

function messageIcon(item) {
  const tone = messageTone(item)
  if (tone === 'incoming') return 'inbox'
  if (tone === 'failed') return 'alert'
  if (tone === 'pending') return 'clock'
  if (tone === 'read' || tone === 'delivered') return 'checks'
  return 'send'
}

function RecentActivity({ items, loading }) {
  return (
    <section className="dash-card dash-activity-card">
      <div className="dash-card-head">
        <div>
          <h2>Recent activity</h2>
          <p>Latest 5 messages across all conversations</p>
        </div>
        <Link className="dash-link" href="/inbox">View all</Link>
      </div>
      {loading ? (
        <div className="dash-activity-skeleton" role="status" aria-label="Loading recent activity">
          {Array.from({ length: 5 }).map((_, index) => <span className="dash-skeleton-block" key={index} />)}
        </div>
      ) : items?.length ? (
        <ul className="dash-activity">
          {items.slice(0, 5).map((item) => {
            const tone = messageTone(item)
            const friendly = friendlyProviderMessage(item.errorCode, item.errorTitle)
              || item.failureReason
              || (tone === 'failed' ? 'Delivery failed' : null)
            const preview = friendly || item.preview || String(item.status || '').replace(/_/g, ' ') || 'Message'
            const technical = [item.errorTitle, item.errorCode ? `Code ${item.errorCode}` : null].filter(Boolean).join(' · ')
            return (
              <li key={item.id}>
                <Link preserveContent href={`/inbox?c=${item.conversationId}`} title={technical || preview}>
                  <span className={`dash-activity-icon dash-activity-${tone}`}><Icon name={messageIcon(item)} size={14} /></span>
                  <span className="dash-activity-avatar">{String(item.title || '?').charAt(0).toUpperCase()}</span>
                  <span className="dash-activity-text">
                    <strong>{item.title}</strong>
                    <span>{preview}</span>
                  </span>
                  <span className={`dash-activity-status dash-status-${tone}`}>{tone === 'incoming' ? 'Incoming' : String(item.status || tone).replace(/_/g, ' ')}</span>
                  <time dateTime={item.timestamp}>{relative(item.timestamp)}</time>
                </Link>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="dash-empty">No messages in this period.</div>
      )}
    </section>
  )
}

function WhatsAppAccounts({ config, setup }) {
  const status = String(config?.status || setup?.whatsappStatus || 'disconnected').toLowerCase()
  const registrationError = config?.last_registration_error || setup?.whatsappRegistrationError
  const connected = ['connected', 'active', 'verified', 'ok'].includes(status) && !registrationError
  const pendingApproval = Boolean(setup?.whatsappPendingApproval || (!config?.registered_at && !registrationError && connected))
  const displayPhone = config?.display_phone_number || setup?.whatsappDisplayPhone
  const tone = registrationError ? 'failed' : pendingApproval ? 'pending' : connected ? 'connected' : 'disconnected'
  const statusLabel = registrationError
    ? friendlyProviderMessage(registrationError, registrationError) || 'Connection error'
    : pendingApproval ? 'Approval pending' : connected ? 'Connected' : 'Not connected'
  const technical = registrationError ? String(registrationError) : undefined

  return (
    <section className="dash-card dash-accounts">
      <div className="dash-card-head">
        <div>
          <h2>Connected WhatsApp accounts</h2>
          <p>Current workspace account</p>
        </div>
        <Link className="dash-link" href="/settings?tab=whatsapp">Manage</Link>
      </div>
      <div className="dash-account-row">
        <span className="dash-account-icon dash-kpi-green"><Icon name="whatsapp" size={17} /></span>
        <span className="dash-account-copy">
          <small>Phone number</small>
          <strong>{displayPhone || 'Number unavailable'}</strong>
        </span>
        <span className={`dash-account-status is-${tone}`} title={technical}>{statusLabel}</span>
      </div>
      <div className="dash-account-row">
        <span className="dash-account-icon dash-kpi-blue"><Icon name="user" size={17} /></span>
        <span className="dash-account-copy">
          <small>Business display name</small>
          <strong>{config?.verified_name || 'Not provided by Meta'}</strong>
        </span>
      </div>
      <div className="dash-account-row">
        <span className="dash-account-icon dash-kpi-purple"><Icon name="shield" size={17} /></span>
        <span className="dash-account-copy">
          <small>Registration</small>
          <strong>{config?.registered_at ? `Registered ${relative(config.registered_at)}` : pendingApproval ? 'Awaiting approval' : 'Not registered'}</strong>
        </span>
      </div>
      <div className="dash-account-actions">
        <Link className="button button-secondary button-sm" href="/settings?tab=whatsapp"><Icon name="settings" size={14} /> Account settings</Link>
        <Link className="button button-ghost button-sm" href="/templates"><Icon name="template" size={14} /> Templates</Link>
      </div>
    </section>
  )
}

function ReplyQueue({ items, team, replyTargetMinutes }) {
  const names = new Map((team || []).map((member) => [String(member.id), member.name]))

  return (
    <section className="dash-card dash-queue">
      <div className="dash-card-head">
        <div>
          <h2>Reply queue</h2>
          <p>Longest wait first</p>
        </div>
        <Link className="dash-link" href="/inbox?filter=waiting">Open inbox</Link>
      </div>
      {items?.length ? (
        <ul className="dash-queue-list">
          {items.slice(0, 5).map((item) => (
            <li key={item.conversationId}>
              <Link preserveContent href={`/inbox?c=${item.conversationId}`}>
                <span className="avatar">{String(item.contactName || item.contactPhone || '?').charAt(0).toUpperCase()}</span>
                <span className="dash-queue-text">
                  <strong>{item.contactName || item.contactPhone || 'Unknown contact'}</strong>
                  <span>{item.preview || 'New conversation'}</span>
                </span>
                <span className="dash-queue-meta">
                  {item.unread ? <b className="dash-unread">{item.unread}</b> : null}
                  <strong className={`dash-queue-wait${item.waitingMinutes >= replyTargetMinutes ? ' is-overdue' : ''}`}>{duration(item.waitingMinutes)}</strong>
                  <span>{item.assignedAgentId ? names.get(String(item.assignedAgentId)) || 'Assigned' : 'Unassigned'}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="dash-empty">No conversations waiting for a reply.</div>
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
                  <td>{member.medianMinutes === null || member.medianMinutes === undefined ? <span title="No reply data in this period">—</span> : duration(member.medianMinutes)}</td>
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
  const stats = [
    ['Sent', campaigns.sent],
    ['Delivered', campaigns.delivered],
    ['Read', campaigns.read],
    ['Failed', campaigns.failed],
    ['Opted out', campaigns.optedOut],
    ['Templates', campaigns.templates],
  ]

  return (
    <section className="dash-card">
      <div className="dash-card-head">
        <div>
          <h2>Campaigns and automations</h2>
          <p>In this period</p>
        </div>
        <Link className="dash-link" href="/broadcasts">Broadcasts</Link>
      </div>
      <div className="dash-campaign-stats">
        {stats.map(([label, value]) => (
          <div key={label}><span>{label}</span><strong>{number(value)}</strong></div>
        ))}
      </div>
      <ul className="dash-health-list">
        <li><span>Automations</span><span className="is-unavailable">Not configured</span></li>
        <li><span>Flows</span><span className="is-unavailable">Not configured</span></li>
      </ul>
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
  const { data: whatsappConfig } = useWhatsappConfig({ enabled: Boolean(user) })

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
      api.get('/api/app/dashboard/activity', { ...options, params: { limit: 5 } }),
    ])
    if (signal?.aborted) return
    if (campaignsResult.status === 'fulfilled') setCampaigns(campaignsResult.value.data)
    if (activityResult.status === 'fulfilled') {
      const { data } = activityResult.value
      setActivity(Array.isArray(data) ? data.slice(0, 5) : [])
    }
    setActivityLoading(false)
  }, [range])

  useEffect(() => {
    if (volumeView !== 'hours') return undefined

    const controller = new AbortController()
    setHourlyLoading(true)
    setHourlyError('')
    api.get('/api/app/dashboard/hourly-volume', { params: { days: range }, timeout: 30_000, signal: controller.signal })
      .then(({ data }) => {
        if (!controller.signal.aborted) setHourlyVolume(Array.isArray(data) ? data : [])
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) setHourlyError(errorMessage(requestError, 'Unable to load hourly message volume.'))
      })
      .finally(() => {
        if (!controller.signal.aborted) setHourlyLoading(false)
      })

    return () => controller.abort()
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
    const initial = window.setTimeout(refresh, 0)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 60_000)
    return () => {
      controller.abort()
      window.clearTimeout(initial)
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
        <button type="button" className="button button-primary" onClick={() => { setFailed(false); void load() }}>Try again</button>
      </div>
    )
  }

  const kpis = overview?.kpis || {}
  const volume = Array.isArray(overview?.volume?.series) ? overview.volume.series : []
  const setup = overview?.setup || {}
  const onlineCount = (overview?.replies?.team || []).filter((member) => member.presence === 'online').length
  const hasBroadcasts = Number(kpis.broadcastDelivered) > 0
  const readRate = ratio(kpis.broadcastRead, kpis.broadcastDelivered)
  const previousReadRate = ratio(kpis.broadcastReadPrevious, kpis.broadcastDeliveredPrevious)
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
      </header>

      {!overview ? (
        <DashboardSkeleton />
      ) : (
        <>
          <AttentionRow data={overview} onlineCount={onlineCount} />

          <div className="dash-kpis">
            <KpiCard
              title="Total conversations"
              value={number(kpis.newConversations)}
              icon="chat"
              tone={KPI_TONES[0]}
              detail="Conversations created in this period"
              delta={change(kpis.newConversations, kpis.newConversationsPrevious)}
              comparison={`vs previous ${range}d`}
              values={volume.map((row) => row.newConversations)}
            />
            <KpiCard
              title="Messages sent"
              value={number(sum(volume.map((row) => row.outbound)))}
              icon="send"
              tone={KPI_TONES[1]}
              detail="Agent and bot messages sent in this period"
              delta={null}
              comparison="Actual period total"
              values={volume.map((row) => row.outbound)}
            />
            <KpiCard
              title="Messages received"
              value={number(sum(volume.map((row) => row.inbound)))}
              icon="inbox"
              tone={KPI_TONES[2]}
              detail="Customer messages received in this period"
              delta={null}
              comparison="Actual period total"
              values={volume.map((row) => row.inbound)}
            />
            <KpiCard
              title="Failed messages"
              value={number(kpis.failedMessages ?? sum(volume.map((row) => row.failed)))}
              icon="alert"
              tone={KPI_TONES[3]}
              detail="Messages that failed to send in this period"
              delta={null}
              comparison="Actual period total"
              values={volume.map((row) => row.failed)}
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
            <ReplyPerformance overview={overview} />
          </div>

          <div className="dash-split">
            <RecentActivity items={activity} loading={activityLoading} />
            <WhatsAppAccounts config={whatsappConfig} setup={setup} />
          </div>

          <div className="dash-split">
            <ReplyQueue items={overview.queue} team={overview.replies?.team} replyTargetMinutes={overview.replyTargetMinutes} />
            <TeamCard team={overview.replies?.team} />
          </div>

          <CampaignsCard campaigns={campaigns} />

          {hasBroadcasts && readRate !== null && (
            <div className="dash-card dash-broadcast-summary">
              <div>
                <span>Broadcast read rate</span>
                <strong>{percent(readRate)}</strong>
                <small>{number(kpis.broadcastRead)} of {number(kpis.broadcastDelivered)} delivered messages read</small>
              </div>
              <div>
                <span>Previous period</span>
                <strong>{percent(previousReadRate)}</strong>
                <small>{previousReadRate === null ? 'Comparison unavailable' : `vs previous ${range}d`}</small>
              </div>
              <div>
                <span>Resolved conversations</span>
                <strong>{number(kpis.resolved)}</strong>
                <small>Closed in this period</small>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
