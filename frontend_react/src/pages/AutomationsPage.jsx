import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/client.js'
import Icon from '../components/common/Icon.jsx'
import { useToast } from '../components/common/ToastProvider.jsx'
import { errorMessage, extractList, relativeTime } from '../lib/utils.js'

export const AUTOMATION_TEMPLATES = [
  {
    slug: 'welcome_message',
    name: 'Welcome message',
    description: 'Greet every new conversation.',
    icon: 'chat',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [{ clientId: 'welcome', step_type: 'send_message', config: { text: 'Hi {{ contact.name }}! Thanks for reaching out to Aayojan. How can we help?' }, yes: [], no: [] }],
  },
  {
    slug: 'out_of_office',
    name: 'Out of office',
    description: 'Reply after business hours.',
    icon: 'clock',
    trigger_type: 'time_based',
    trigger_config: { schedule: '18:00' },
    steps: [{ clientId: 'office', step_type: 'send_message', config: { text: 'Thanks for your message. Our team is offline right now and will reply tomorrow.' }, yes: [], no: [] }],
  },
  {
    slug: 'lead_qualifier',
    name: 'Lead qualifier',
    description: 'Branch on the customer reply.',
    icon: 'contacts',
    trigger_type: 'keyword_match',
    trigger_config: { keywords: ['interested', 'demo', 'pricing'], match_type: 'contains' },
    steps: [{
      clientId: 'qualify',
      step_type: 'condition',
      config: { subject: 'message_content', operator: 'contains', value: 'budget' },
      yes: [{ clientId: 'budget', step_type: 'add_tag', config: {}, yes: [], no: [] }],
      no: [{ clientId: 'agent', step_type: 'assign_conversation', config: { mode: 'any' }, yes: [], no: [] }],
    }],
  },
  {
    slug: 'follow_up_reminder',
    name: 'Follow-up reminder',
    description: 'Send a daily reminder at 9 AM.',
    icon: 'bell',
    trigger_type: 'time_based',
    trigger_config: { schedule: '09:00' },
    steps: [{ clientId: 'followup', step_type: 'send_message', config: { text: 'Hi {{ contact.name }}, just checking in. Let me know if you need anything else.' }, yes: [], no: [] }],
  },
]

const TRIGGER_LABELS = {
  new_message_received: 'New message',
  first_inbound_message: 'First message',
  keyword_match: 'Keyword',
  new_contact_created: 'New contact',
  conversation_assigned: 'Assigned',
  tag_added: 'Tag added',
  time_based: 'Scheduled',
  interactive_reply: 'Button reply',
}

export default function AutomationsPage() {
  const toast = useToast()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/api/app/automations')
      setItems(extractList(data))
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to load automations.'))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  const createFromTemplate = async (template) => {
    setCreating(template.slug)
    try {
      await api.post('/api/app/automations', {
        name: template.name,
        description: template.description,
        trigger_type: template.trigger_type,
        trigger_config: template.trigger_config,
        is_active: false,
        steps: template.steps,
      })
      toast.success('Automation created as a draft.')
      load()
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to create automation.'))
    } finally {
      setCreating('')
    }
  }

  const toggle = async (item) => {
    try {
      await api.patch(`/api/app/automations/${item.id}`, {
        name: item.name,
        description: item.description,
        trigger_type: item.trigger_type,
        trigger_config: item.trigger_config || {},
        is_active: !item.is_active,
      })
      toast.success(item.is_active ? 'Automation paused.' : 'Automation activated.')
      load()
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to update automation.'))
    }
  }

  const remove = async (item) => {
    if (!window.confirm(`Delete automation "${item.name}"?`)) return
    try {
      await api.delete(`/api/app/automations/${item.id}`)
      toast.success('Automation deleted.')
      load()
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to delete automation.'))
    }
  }

  return (
    <div className="dash-page">
      <header className="dash-header">
        <div><h1>Automations</h1><p>Respond to events with real WhatsApp actions.</p></div>
        <Link className="button button-secondary" to="/flows"><Icon name="workflow" size={15} /> Flow builder</Link>
      </header>

      <section className="auto-templates">
        {AUTOMATION_TEMPLATES.map((template) => (
          <div className="dash-card auto-template" key={template.slug}>
            <div className="auto-template-icon"><Icon name={template.icon} size={19} /></div>
            <h3>{template.name}</h3>
            <p>{template.description}</p>
            <button type="button" className="button button-secondary button-sm" onClick={() => createFromTemplate(template)} disabled={creating === template.slug}>
              {creating === template.slug ? 'Creating...' : 'Use template'}
            </button>
          </div>
        ))}
      </section>

      <section className="dash-card">
        {loading ? <div className="dash-empty"><span className="spinner" /> Loading automations…</div> : items.length ? (
          <div className="bc-table-wrap">
            <table className="bc-table">
              <thead><tr><th>Name</th><th>Trigger</th><th>Status</th><th>Runs</th><th>Last run</th><th /></tr></thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td><Link to={`/automations/${item.id}/edit`}><strong>{item.name}</strong></Link><small>{item.description}</small></td>
                    <td><span className="auto-trigger">{TRIGGER_LABELS[item.trigger_type] || item.trigger_type}</span></td>
                    <td><span className={`badge badge-${item.is_active ? 'approved' : 'pending'}`}>{item.is_active ? 'Active' : 'Draft'}</span></td>
                    <td>{item.execution_count || 0}</td>
                    <td>{item.last_executed_at ? relativeTime(item.last_executed_at) : 'Never'}</td>
                    <td className="bc-actions">
                      <button type="button" className="button button-sm button-secondary" onClick={() => toggle(item)}>{item.is_active ? 'Pause' : 'Enable'}</button>
                      <Link className="icon-button" to={`/automations/${item.id}/logs`} title="Logs"><Icon name="refresh" size={15} /></Link>
                      <button type="button" className="icon-button" onClick={() => remove(item)} title="Delete"><Icon name="trash" size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="dash-empty"><Icon name="bolt" size={22} /><span>No automations yet. Start with a template above.</span></div>
        )}
      </section>
    </div>
  )
}
