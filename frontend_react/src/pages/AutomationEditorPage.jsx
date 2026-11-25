import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import api from '../api/client.js'
import Icon from '../components/common/Icon.jsx'
import { useToast } from '../components/common/ToastProvider.jsx'
import { AUTOMATION_TEMPLATES } from './AutomationsPage.jsx'
import { errorMessage, extractList } from '../lib/utils.js'

const STEP_TYPES = [
  ['send_message', 'Send message'], ['send_buttons', 'Buttons'], ['send_list', 'List'],
  ['send_template', 'Template'], ['add_tag', 'Add tag'], ['assign_conversation', 'Assign'],
  ['update_contact_field', 'Update field'], ['wait', 'Wait'], ['condition', 'Condition'],
  ['send_webhook', 'Webhook'],
]
const TRIGGERS = [
  ['new_message_received', 'New message'], ['first_inbound_message', 'First message'],
  ['keyword_match', 'Keyword'], ['new_contact_created', 'New contact'],
  ['conversation_assigned', 'Assigned'], ['tag_added', 'Tag added'],
  ['time_based', 'Scheduled'], ['interactive_reply', 'Button reply'],
]

let nextClientId = 1
const clientId = () => `new-${nextClientId++}`
const blankStep = (stepType = 'send_message') => ({ clientId: clientId(), step_type: stepType, config: {}, yes: [], no: [] })

function cleanSteps(steps) {
  return steps.map((step) => ({
    ...(typeof step.id === 'number' ? { id: step.id } : {}),
    step_type: step.step_type,
    config: step.config || {},
    yes: cleanSteps(step.yes || []),
    no: cleanSteps(step.no || []),
  }))
}

function StepConfig({ step, options, onChange }) {
  const config = step.config || {}
  const update = (field, value) => onChange({ ...config, [field]: value })

  if (step.step_type === 'send_message' || step.step_type === 'collect_input') {
    return <label className="field field-full"><span>Message</span><textarea className="textarea" rows="3" value={config.text || ''} onChange={(event) => update('text', event.target.value)} placeholder="Use {{ contact.name }} and {{ message.text }}" /></label>
  }
  if (step.step_type === 'send_buttons') {
    const buttons = Array.isArray(config.buttons) ? config.buttons : []
    return (
      <>
        <label className="field field-full"><span>Message</span><textarea className="textarea" rows="2" value={config.text || ''} onChange={(event) => update('text', event.target.value)} /></label>
        <div className="field field-full">
          <span>Buttons</span>
          {buttons.map((button, index) => (
            <div className="auto-inline" key={index}>
              <input className="input" value={button.id || ''} onChange={(event) => { const next = [...buttons]; next[index] = { ...button, id: event.target.value }; update('buttons', next) }} placeholder="Reply ID" />
              <input className="input" value={button.title || ''} onChange={(event) => { const next = [...buttons]; next[index] = { ...button, title: event.target.value }; update('buttons', next) }} placeholder="Title" />
              <button type="button" className="icon-button" onClick={() => update('buttons', buttons.filter((_, i) => i !== index))}><Icon name="close" size={14} /></button>
            </div>
          ))}
          <button type="button" className="button button-sm button-secondary" onClick={() => update('buttons', [...buttons, { id: `reply_${buttons.length + 1}`, title: '' }])} disabled={buttons.length >= 3}><Icon name="plus" size={13} /> Add button</button>
          <label className="check"><input type="checkbox" checked={Boolean(config.wait_for_reply)} onChange={(event) => update('wait_for_reply', event.target.checked)} /><span>Wait for reply</span></label>
        </div>
      </>
    )
  }
  if (step.step_type === 'send_list') {
    return <label className="field field-full"><span>Sections (JSON)</span><textarea className="textarea" rows="4" value={JSON.stringify(config.sections || [], null, 2)} onChange={(event) => { try { update('sections', JSON.parse(event.target.value)) } catch { /* keep typing */ } }} /></label>
  }
  if (step.step_type === 'send_template') {
    return (
      <>
        <label className="field"><span>Template</span><select className="input" value={config.template_name || ''} onChange={(event) => update('template_name', event.target.value)}><option value="">Choose…</option>{(options.templates || []).map((template) => <option key={`${template.name}-${template.language}`} value={template.name}>{template.name}</option>)}</select></label>
        <label className="field"><span>Variables <em>comma separated</em></span><input className="input" value={(config.params || []).join(', ')} onChange={(event) => update('params', event.target.value.split(',').map((value) => value.trim()).filter(Boolean))} /></label>
      </>
    )
  }
  if (step.step_type === 'add_tag') {
    return <label className="field"><span>Tag</span><select className="input" value={config.tag_id || ''} onChange={(event) => update('tag_id', Number(event.target.value) || null)}><option value="">Choose…</option>{(options.tags || []).map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label>
  }
  if (step.step_type === 'assign_conversation') {
    return (
      <>
        <label className="field"><span>Mode</span><select className="input" value={config.mode || 'any'} onChange={(event) => update('mode', event.target.value)}><option value="any">Any available agent</option><option value="specific">Specific agent</option></select></label>
        {config.mode === 'specific' && <label className="field"><span>Agent</span><select className="input" value={config.agent_id || ''} onChange={(event) => update('agent_id', Number(event.target.value) || null)}><option value="">Choose…</option>{(options.agents || []).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>}
      </>
    )
  }
  if (step.step_type === 'update_contact_field') {
    return (
      <>
        <label className="field"><span>Field</span><select className="input" value={config.field || ''} onChange={(event) => update('field', event.target.value)}><option value="">Choose…</option><option value="name">Name</option><option value="email">Email</option><option value="company">Company</option>{(options.fields || []).map((field) => <option key={field.id} value={`custom:${field.id}`}>{field.label}</option>)}</select></label>
        <label className="field"><span>Value</span><input className="input" value={config.value || ''} onChange={(event) => update('value', event.target.value)} /></label>
      </>
    )
  }
  if (step.step_type === 'wait') {
    return (
      <>
        <label className="field"><span>Amount</span><input className="input" type="number" min="1" value={config.amount ?? 1} onChange={(event) => update('amount', Number(event.target.value))} /></label>
        <label className="field"><span>Unit</span><select className="input" value={config.unit || 'minutes'} onChange={(event) => update('unit', event.target.value)}><option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option></select></label>
      </>
    )
  }
  if (step.step_type === 'condition') {
    return (
      <>
        <label className="field"><span>Subject</span><select className="input" value={config.subject || 'message_content'} onChange={(event) => update('subject', event.target.value)}><option value="message_content">Message content</option><option value="contact_field">Contact field</option><option value="tag_presence">Tag presence</option><option value="time_of_day">Time of day</option></select></label>
        <label className="field"><span>Operator</span><select className="input" value={config.operator || 'equals'} onChange={(event) => update('operator', event.target.value)}><option value="equals">Equals</option><option value="contains">Contains</option><option value="not_equals">Not equals</option><option value="starts_with">Starts with</option><option value="exists">Exists</option></select></label>
        <label className="field field-full"><span>Value</span><input className="input" value={config.value ?? ''} onChange={(event) => update('value', event.target.value)} /></label>
      </>
    )
  }
  if (step.step_type === 'send_webhook') {
    return (
      <>
        <label className="field field-full"><span>Webhook URL</span><input className="input" value={config.url || ''} onChange={(event) => update('url', event.target.value)} placeholder="https://example.com/hook" /></label>
        <label className="field field-full"><span>Payload (JSON, optional)</span><textarea className="textarea" rows="4" value={JSON.stringify(config.payload || {}, null, 2)} onChange={(event) => { try { update('payload', JSON.parse(event.target.value)) } catch { /* keep typing */ } }} /></label>
      </>
    )
  }
  return null
}

function StepTree({ steps, options, onChange }) {
  const updateAt = (list, clientKey, updater) => list.map((step) => step.clientId === clientKey ? updater(step) : { ...step, yes: updateAt(step.yes || [], clientKey, updater), no: updateAt(step.no || [], clientKey, updater) })

  const render = (list, depth = 0) => list.map((step) => (
    <div className="auto-step" key={step.clientId} style={{ marginLeft: depth * 14 }}>
      <div className="auto-step-head">
        <span className="auto-step-num"><Icon name="bolt" size={13} /></span>
        <select className="input input-sm" value={step.step_type} onChange={(event) => onChange(updateAt(steps, step.clientId, (item) => ({ ...item, step_type: event.target.value, config: {} })))}>
          {STEP_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button type="button" className="icon-button" title="Remove step" onClick={() => onChange(list.filter((item) => item.clientId !== step.clientId))}><Icon name="trash" size={14} /></button>
      </div>
      <div className="agents-form-grid auto-step-config"><StepConfig step={step} options={options} onChange={(config) => onChange(updateAt(steps, step.clientId, (item) => ({ ...item, config })))} /></div>
      {step.step_type === 'condition' && (
        <div className="auto-branches">
          {['yes', 'no'].map((branch) => (
            <div className="auto-branch" key={branch}>
              <div className="auto-branch-head"><strong>{branch === 'yes' ? 'Yes' : 'No'}</strong><button type="button" className="button button-sm button-secondary" onClick={() => onChange(updateAt(steps, step.clientId, (item) => ({ ...item, [branch]: [...(item[branch] || []), blankStep()] })))}><Icon name="plus" size={12} /> Step</button></div>
              <StepTree steps={step[branch] || []} options={options} onChange={(next) => onChange(updateAt(steps, step.clientId, (item) => ({ ...item, [branch]: next })))} />
            </div>
          ))}
        </div>
      )}
    </div>
  ))

  return <div className="auto-step-list">{render(steps)}</div>
}

export default function AutomationEditorPage() {
  const { id } = useParams()
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const isNew = !id || id === 'new'
  const [options, setOptions] = useState({ tags: [], agents: [], fields: [], templates: [] })
  const [form, setForm] = useState({
    name: '', description: '', trigger_type: 'new_message_received',
    trigger_config: {}, is_active: false, steps: [blankStep()],
  })
  const [issues, setIssues] = useState([])
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [testContact, setTestContact] = useState('')
  const [contacts, setContacts] = useState([])

  useEffect(() => {
    api.get('/api/app/automations/options').then(({ data }) => setOptions(data)).catch(() => {})
    api.get('/api/app/contacts', { params: { per_page: 100 } }).then(({ data }) => setContacts(extractList(data))).catch(() => {})
  }, [])

  useEffect(() => {
    const template = AUTOMATION_TEMPLATES.find((item) => item.slug === search.get('template'))
    if (isNew && template) {
      setForm({ name: template.name, description: template.description, trigger_type: template.trigger_type, trigger_config: template.trigger_config, is_active: false, steps: template.steps.map((step) => ({ ...step, clientId: step.clientId || clientId() })) })
      return
    }
    if (isNew) return
    api.get(`/api/app/automations/${id}`).then(({ data }) => {
      const map = (steps) => (steps || []).map((step) => ({ clientId: String(step.id || clientId()), id: step.id, step_type: step.step_type, config: step.config || {}, yes: map(step.yes), no: map(step.no) }))
      setForm({ ...data.automation, steps: map(data.steps) })
    }).catch((error) => toast.error(errorMessage(error, 'Unable to load automation.'))).finally(() => setLoading(false))
  }, [id, isNew, search, toast])

  const setTrigger = (field, value) => setForm((current) => ({ ...current, trigger_config: { ...current.trigger_config, [field]: value } }))

  const save = async () => {
    setSaving(true)
    setIssues([])
    const payload = { ...form, steps: cleanSteps(form.steps) }
    try {
      const { data } = isNew
        ? await api.post('/api/app/automations', payload)
        : await api.patch(`/api/app/automations/${id}`, payload)
      toast.success('Automation saved.')
      if (isNew) navigate(`/automations/${data.automation.id}/edit`, { replace: true })
    } catch (error) {
      setIssues(error.response?.data?.issues || [])
      toast.error(errorMessage(error, 'Unable to save automation.'))
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    if (!testContact || isNew) return
    try {
      const { data } = await api.post(`/api/app/automations/${id}/test`, { contact_id: Number(testContact), text: 'Test automation' })
      toast.success(data.status === 'success' ? 'Test completed successfully.' : `Test finished with status: ${data.status}`)
    } catch (error) {
      toast.error(errorMessage(error, 'Automation test failed.'))
    }
  }

  if (loading) return <div className="dash-page"><div className="dash-empty"><span className="spinner" /> Loading automation…</div></div>

  return (
    <div className="dash-page auto-editor">
      <header className="dash-header">
        <div><h1>{isNew ? 'New automation' : form.name}</h1><p>Trigger → steps → real WhatsApp actions.</p></div>
        <div className="bc-actions">
          <button type="button" className="button button-secondary" onClick={() => navigate('/automations')}>Back</button>
          <button type="button" className="button button-primary" onClick={save} disabled={saving}><Icon name="check" size={15} /> {saving ? 'Saving...' : 'Save'}</button>
        </div>
      </header>
      {issues.length > 0 && <div className="alert alert-error"><ul>{issues.map((issue, index) => <li key={index}>{issue.path}: {issue.message}</li>)}</ul></div>}

      <section className="dash-card auto-section">
        <h2>Details & trigger</h2>
        <div className="agents-form-grid">
          <label className="field"><span>Name</span><input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label className="field"><span>Trigger</span><select className="input" value={form.trigger_type} onChange={(event) => setForm({ ...form, trigger_type: event.target.value })}>{TRIGGERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field field-full"><span>Description</span><input className="input" value={form.description || ''} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          {form.trigger_type === 'keyword_match' && <label className="field field-full"><span>Keywords <em>comma separated</em></span><input className="input" value={(form.trigger_config.keywords || []).join(', ')} onChange={(event) => setTrigger('keywords', event.target.value.split(',').map((value) => value.trim()).filter(Boolean))} /></label>}
          {form.trigger_type === 'keyword_match' && <label className="field"><span>Match type</span><select className="input" value={form.trigger_config.match_type || 'contains'} onChange={(event) => setTrigger('match_type', event.target.value)}><option value="contains">Contains</option><option value="word">Whole word</option><option value="exact">Exact</option></select></label>}
          {form.trigger_type === 'tag_added' && <label className="field"><span>Tag</span><select className="input" value={form.trigger_config.tag_id || ''} onChange={(event) => setTrigger('tag_id', Number(event.target.value) || null)}><option value="">Choose…</option>{(options.tags || []).map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label>}
          {form.trigger_type === 'interactive_reply' && <label className="field field-full"><span>Reply IDs <em>comma separated</em></span><input className="input" value={(form.trigger_config.reply_ids || []).join(', ')} onChange={(event) => setTrigger('reply_ids', event.target.value.split(',').map((value) => value.trim()).filter(Boolean))} /></label>}
          {form.trigger_type === 'time_based' && <label className="field"><span>Schedule <em>HH:MM</em></span><input className="input" value={form.trigger_config.schedule || '09:00'} onChange={(event) => setTrigger('schedule', event.target.value)} /></label>}
          <label className="check"><input type="checkbox" checked={Boolean(form.is_active)} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} /><span>Active</span></label>
        </div>
      </section>

      <section className="dash-card auto-section">
        <div className="auto-section-head"><h2>Steps</h2><button type="button" className="button button-secondary button-sm" onClick={() => setForm((current) => ({ ...current, steps: [...current.steps, blankStep()] }))}><Icon name="plus" size={13} /> Add step</button></div>
        <StepTree steps={form.steps} options={options} onChange={(steps) => setForm((current) => ({ ...current, steps }))} />
      </section>

      {!isNew && (
        <section className="dash-card auto-section">
          <h2>Test run</h2>
          <div className="auto-inline">
            <select className="input" value={testContact} onChange={(event) => setTestContact(event.target.value)}><option value="">Choose a contact…</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name || contact.phone}</option>)}</select>
            <button type="button" className="button button-secondary" onClick={test} disabled={!testContact}><Icon name="play" size={14} /> Run test</button>
          </div>
        </section>
      )}
    </div>
  )
}
