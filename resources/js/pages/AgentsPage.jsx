import { useCallback, useEffect, useState } from 'react'
import api from '../api/client.js'
import AiConfigPanel from '../components/ai/AiConfigPanel.jsx'
import AiKnowledgePanel from '../components/ai/AiKnowledgePanel.jsx'
import AiPlayground from '../components/ai/AiPlayground.jsx'
import AiUsagePanel from '../components/ai/AiUsagePanel.jsx'
import Icon from '../components/common/Icon.jsx'
import { useToast } from '../components/common/ToastProvider.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { errorMessage } from '../lib/utils.js'

const TABS = [
  { id: 'playground', label: 'Playground', icon: 'bot' },
  { id: 'setup', label: 'Setup', icon: 'settings' },
  { id: 'knowledge', label: 'Knowledge', icon: 'document' },
  { id: 'usage', label: 'Usage', icon: 'chart' },
]

export default function AgentsPage() {
  const { user } = useAuth()
  const toast = useToast()
  const [config, setConfig] = useState({ configured: false, provider: 'openai', model: 'gpt-4o-mini', base_url: '', api_key: '', embeddings_api_key: '', system_prompt: '', is_active: false })
  const [tab, setTab] = useState('playground')
  const [loading, setLoading] = useState(true)
  const canManage = user?.role === 'owner'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/api/app/ai/config')
      setConfig(data)
      return data
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to load AI configuration.'))
      return null
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load().then((data) => {
      if (data && !data.configured) setTab('setup')
    })
  }, [load])

  const tabs = TABS

  return (
    <div className="agents-page">
      <div className="agents-hero">
        <div className="agents-hero-icon"><Icon name="bot" size={24} /></div>
        <div>
          <h1>AI Agents</h1>
          <p>Configure the assistant, test answers, and manage its knowledge. Drafts are never auto-sent to customers.</p>
        </div>
        <span className={`agents-pill${config.configured && config.is_active ? ' is-ready' : ''}`}>
          {config.configured && config.is_active ? 'AI enabled' : 'AI not ready'}
        </span>
      </div>

      <div className="agents-tabs" role="tablist">
        {tabs.map((item) => (
          <button type="button" role="tab" aria-selected={tab === item.id} key={item.id} className={`agents-tab${tab === item.id ? ' is-active' : ''}`} onClick={() => setTab(item.id)}>
            <Icon name={item.icon} size={16} /> {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="agents-empty"><p>Loading AI settings...</p></div>
      ) : (
        <div className="agents-tab-content">
          {tab === 'playground' && <AiPlayground configured={Boolean(config.configured && config.is_active)} />}
          {tab === 'setup' && <AiConfigPanel config={config} onSaved={load} canManage={canManage} />}
          {tab === 'knowledge' && <AiKnowledgePanel canManage />}
          {tab === 'usage' && <AiUsagePanel />}
        </div>
      )}
    </div>
  )
}
