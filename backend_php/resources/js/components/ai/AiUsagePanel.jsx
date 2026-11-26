import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client.js'
import Icon from '../common/Icon.jsx'
import { errorMessage } from '../../lib/utils.js'

export default function AiUsagePanel() {
  const [days, setDays] = useState(30)
  const [usage, setUsage] = useState(null)
  const [error, setError] = useState('')
  const maxTokens = Math.max(1, ...(usage?.daily || []).map((item) => item.tokens || 0))

  const load = useCallback(async () => {
    setError('')
    try {
      const { data } = await api.get('/api/app/ai/usage', { params: { days, tz: Intl.DateTimeFormat().resolvedOptions().timeZone } })
      setUsage(data)
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to load AI usage.'))
    }
  }, [days])

  useEffect(() => { load() }, [load])

  return (
    <div className="agents-usage">
      <div className="agents-card-head">
        <div><h2>Usage</h2><p>Token consumption and AI activity across this workspace.</p></div>
        <select className="input input-sm" value={days} onChange={(event) => setDays(Number(event.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>
      {error && <div className="agents-empty"><Icon name="chart" size={26} /><p>{error}</p></div>}
      {usage && (
        <>
          <div className="agents-stats">
            <div className="agents-stat"><span>Total tokens</span><strong>{usage.total_tokens.toLocaleString()}</strong></div>
            <div className="agents-stat"><span>LLM calls</span><strong>{usage.llm_calls.toLocaleString()}</strong></div>
            <div className="agents-stat"><span>Drafts created</span><strong>{usage.drafts.toLocaleString()}</strong></div>
            <div className="agents-stat agents-stat-muted"><span>Auto replies</span><strong>{usage.auto_reply.toLocaleString()}</strong><small>Disabled in this CRM</small></div>
          </div>
          <div className="agents-card agents-chart-card">
            <h3>Daily tokens</h3>
            {!usage.daily.length && <div className="list-placeholder">No AI activity in this period.</div>}
            <div className="agents-chart">
              {usage.daily.map((item) => (
                <div className="agents-chart-bar-wrap" key={item.date} title={`${item.date}: ${item.tokens} tokens`}>
                  <div className="agents-chart-bar" style={{ height: `${Math.max(3, (item.tokens / maxTokens) * 100)}%` }} />
                  <span>{item.date.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
          {usage.by_model.length > 0 && (
            <div className="agents-card">
              <h3>By model</h3>
              <div className="agents-doc-list">
                {usage.by_model.map((item) => (
                  <div className="agents-doc" key={item.model}>
                    <div className="agents-doc-main"><div className="agents-doc-title">{item.model}</div><div className="agents-muted">{item.calls} calls</div></div>
                    <strong>{item.tokens.toLocaleString()} tokens</strong>
                  </div>
                ))}
              </div>
              {usage.truncated && <p className="agents-muted">Showing the most recent 10,000 calls.</p>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
