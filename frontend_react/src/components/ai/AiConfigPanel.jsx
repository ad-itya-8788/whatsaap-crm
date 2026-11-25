import { useState } from 'react'
import api, { csrf } from '../../api/client.js'
import Icon from '../common/Icon.jsx'
import { useToast } from '../common/ToastProvider.jsx'
import { errorMessage } from '../../lib/utils.js'

const PROVIDERS = [
  { value: 'openai', label: 'OpenAI', model: 'gpt-4o-mini', base: 'https://api.openai.com' },
  { value: 'anthropic', label: 'Anthropic', model: 'claude-3-5-haiku-latest', base: 'https://api.anthropic.com' },
  { value: 'openai_compatible', label: 'OpenAI-compatible server', model: 'local-model', base: '' },
]

export default function AiConfigPanel({ config, onSaved, canManage }) {
  const toast = useToast()
  const [form, setForm] = useState({
    provider: config.provider || 'openai',
    model: config.model || 'gpt-4o-mini',
    base_url: config.base_url || '',
    api_key: config.api_key || '',
    embeddings_api_key: config.embeddings_api_key || '',
    system_prompt: config.system_prompt || '',
    is_active: config.is_active !== false,
  })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }))
  const chooseProvider = (provider) => {
    const preset = PROVIDERS.find((item) => item.value === provider)
    setForm((current) => ({
      ...current,
      provider,
      model: preset.model,
      base_url: preset.base,
    }))
  }

  const save = async (testAfter = false) => {
    setSaving(true)
    try {
      await csrf()
      await api.post('/api/app/ai/config', form)
      toast.success('AI settings saved.')
      await onSaved?.()
      if (testAfter) await test(form)
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to save AI settings.'))
    } finally {
      setSaving(false)
    }
  }

  const test = async (payload = form) => {
    setTesting(true)
    try {
      await csrf()
      const { data } = await api.post('/api/app/ai/test', payload)
      toast.success(`AI connection OK${data.reply ? `: ${data.reply}` : ''}`)
    } catch (error) {
      toast.error(errorMessage(error, 'AI connection test failed.'))
    } finally {
      setTesting(false)
    }
  }

  const remove = async () => {
    if (!window.confirm('Remove the saved AI configuration? Usage history and knowledge documents will remain.')) return
    try {
      await csrf()
      await api.delete('/api/app/ai/config')
      toast.success('AI configuration removed.')
      await onSaved?.()
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to remove AI configuration.'))
    }
  }

  return (
    <div className="agents-panel">
      <div className="agents-card">
        <div className="agents-card-head">
          <div>
            <h2>Provider setup</h2>
            <p>Keys are encrypted at rest and never sent back to the browser.</p>
          </div>
          {config.updated_at && <span className="agents-muted">Updated {new Date(config.updated_at).toLocaleString()}</span>}
        </div>
        <div className="agents-form-grid">
          <label className="field">
            <span>Provider</span>
            <select className="input" value={form.provider} onChange={(event) => chooseProvider(event.target.value)} disabled={!canManage}>
              {PROVIDERS.map((provider) => <option key={provider.value} value={provider.value}>{provider.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Model</span>
            <input className="input" value={form.model} onChange={(event) => update('model', event.target.value)} disabled={!canManage} required />
          </label>
          <label className="field field-full">
            <span>Base URL <em>optional</em></span>
            <input className="input" value={form.base_url} onChange={(event) => update('base_url', event.target.value)} placeholder={PROVIDERS.find((item) => item.value === form.provider)?.base || 'http://localhost:11434/v1'} disabled={!canManage} />
          </label>
          <label className="field">
            <span>API key {config.has_api_key && <em>saved</em>}</span>
            <input className="input" type="password" value={form.api_key} onChange={(event) => update('api_key', event.target.value)} placeholder={config.has_api_key ? 'Leave as is to keep current key' : 'Enter API key'} disabled={!canManage} />
          </label>
          <label className="field">
            <span>Embeddings key {config.has_embeddings_key && <em>saved</em>}</span>
            <input className="input" type="password" value={form.embeddings_api_key} onChange={(event) => update('embeddings_api_key', event.target.value)} placeholder="Optional, for semantic search" disabled={!canManage} />
          </label>
          <label className="field field-full">
            <span>Instructions</span>
            <textarea className="textarea" rows="4" value={form.system_prompt} onChange={(event) => update('system_prompt', event.target.value)} placeholder="Describe how the assistant should reply to customers..." disabled={!canManage} />
          </label>
          <label className="check">
            <input type="checkbox" checked={form.is_active} onChange={(event) => update('is_active', event.target.checked)} disabled={!canManage} />
            <span>Enable AI features</span>
          </label>
        </div>
        {canManage && (
          <div className="agents-card-actions">
            <button type="button" className="button button-primary" onClick={() => save(false)} disabled={saving || testing}>
              <Icon name="check" size={16} /> {saving ? 'Saving...' : 'Save settings'}
            </button>
            <button type="button" className="button button-secondary" onClick={() => save(true)} disabled={saving || testing}>
              <Icon name="bolt" size={16} /> {testing ? 'Testing...' : 'Save & test'}
            </button>
            {config.configured && <button type="button" className="button button-ghost button-danger" onClick={remove}><Icon name="trash" size={15} /> Remove</button>}
          </div>
        )}
      </div>
    </div>
  )
}
