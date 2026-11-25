import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import api from '../api/client.js'
import Icon from '../components/common/Icon.jsx'
import { useToast } from '../components/common/ToastProvider.jsx'
import { errorMessage } from '../lib/utils.js'

const NODE_TYPES = [
  ['start', 'Start'], ['send_message', 'Message'], ['send_buttons', 'Buttons'],
  ['send_list', 'List'], ['send_media', 'Media'], ['collect_input', 'Collect input'],
  ['condition', 'Condition'], ['set_tag', 'Set tag'], ['handoff', 'Handoff'], ['end', 'End'],
]
const TRIGGERS = [['keyword', 'Keyword'], ['first_inbound_message', 'First message'], ['manual', 'Manual']]

const nodeLabel = (type) => NODE_TYPES.find(([value]) => value === type)?.[1] || type

function TargetSelect({ label, value, keys, onChange, allowEmpty = false }) {
  return (
    <label className="field"><span>{label}</span>
      <select className="input" value={value || ''} onChange={(event) => onChange(event.target.value)}>
        <option value="">{allowEmpty ? 'None' : 'Choose node…'}</option>
        {keys.map((key) => <option key={key} value={key}>{key}</option>)}
      </select>
    </label>
  )
}

function NodeConfig({ node, nodes, tags, update }) {
  const keys = nodes.map((item) => item.node_key).filter((key) => key && key !== node.node_key)
  const config = node.config || {}
  const set = (field, value) => update('config', { ...config, [field]: value })
  const isTerminal = ['handoff', 'end'].includes(node.node_type)
  const isSuspending = ['send_buttons', 'send_list', 'collect_input'].includes(node.node_type)

  return (
    <div className="agents-form-grid flow-node-config">
      {(node.node_type === 'send_message' || node.node_type === 'collect_input') && (
        <><label className="field field-full"><span>Message</span><textarea className="textarea" rows="3" value={config.text || ''} onChange={(event) => set('text', event.target.value)} /></label>{!isTerminal && <TargetSelect label="Next node" value={config.next_node_key} keys={keys} onChange={(value) => set('next_node_key', value)} />}</>
      )}

      {node.node_type === 'start' && <TargetSelect label="Next node" value={config.next_node_key} keys={keys} onChange={(value) => set('next_node_key', value)} />}

      {node.node_type === 'send_media' && (
        <>
          <label className="field"><span>Media type</span><select className="input" value={config.media_type || 'image'} onChange={(event) => set('media_type', event.target.value)}><option value="image">Image</option><option value="video">Video</option><option value="audio">Audio</option><option value="document">Document</option></select></label>
          <label className="field"><span>Meta media ID</span><input className="input" value={config.media_url || ''} onChange={(event) => set('media_url', event.target.value)} /></label>
          <label className="field field-full"><span>Caption</span><textarea className="textarea" rows="2" value={config.caption || ''} onChange={(event) => set('caption', event.target.value)} /></label>
          <TargetSelect label="Next node" value={config.next_node_key} keys={keys} onChange={(value) => set('next_node_key', value)} />
        </>
      )}

      {node.node_type === 'send_buttons' && (
        <>
          <label className="field field-full"><span>Message</span><textarea className="textarea" rows="2" value={config.text || ''} onChange={(event) => set('text', event.target.value)} /></label>
          <div className="field field-full"><span>Buttons <em>max 3, 20 characters each</em></span>
            {(config.buttons || []).map((button, index) => (
              <div className="flow-row" key={index}>
                <input className="input" value={button.id || ''} onChange={(event) => { const next = [...(config.buttons || [])]; next[index] = { ...button, id: event.target.value }; set('buttons', next) }} placeholder="Reply ID" />
                <input className="input" value={button.title || ''} onChange={(event) => { const next = [...(config.buttons || [])]; next[index] = { ...button, title: event.target.value }; set('buttons', next) }} placeholder="Title" />
                <select className="input" value={button.next_node_key || ''} onChange={(event) => { const next = [...(config.buttons || [])]; next[index] = { ...button, next_node_key: event.target.value }; set('buttons', next) }}><option value="">Target…</option>{keys.map((key) => <option key={key} value={key}>{key}</option>)}</select>
                <button type="button" className="icon-button" onClick={() => set('buttons', (config.buttons || []).filter((_, i) => i !== index))}><Icon name="close" size={14} /></button>
              </div>
            ))}
            <button type="button" className="button button-sm button-secondary" disabled={(config.buttons || []).length >= 3} onClick={() => set('buttons', [...(config.buttons || []), { id: `reply_${(config.buttons || []).length + 1}`, title: '', next_node_key: '' }])}><Icon name="plus" size={12} /> Add button</button>
          </div>
        </>
      )}

      {node.node_type === 'send_list' && (
        <>
          <label className="field field-full"><span>Message</span><textarea className="textarea" rows="2" value={config.text || ''} onChange={(event) => set('text', event.target.value)} /></label>
          <label className="field"><span>Button label</span><input className="input" value={config.button || 'Choose an option'} onChange={(event) => set('button', event.target.value)} /></label>
          <label className="field field-full"><span>Sections (JSON)</span><textarea className="textarea" rows="5" value={JSON.stringify(config.sections || [], null, 2)} onChange={(event) => { try { set('sections', JSON.parse(event.target.value)) } catch { /* keep typing */ } }} /></label>
        </>
      )}

      {node.node_type === 'condition' && (
        <>
          <label className="field"><span>Field</span><input className="input" value={config.field || ''} onChange={(event) => set('field', event.target.value)} placeholder="message.text or vars.input" /></label>
          <label className="field"><span>Operator</span><select className="input" value={config.operator || 'equals'} onChange={(event) => set('operator', event.target.value)}><option value="equals">Equals</option><option value="contains">Contains</option><option value="not_equals">Not equals</option></select></label>
          <label className="field"><span>Value</span><input className="input" value={config.value ?? ''} onChange={(event) => set('value', event.target.value)} /></label>
          <TargetSelect label="True →" value={config.true_next} keys={keys} onChange={(value) => set('true_next', value)} />
          <TargetSelect label="False →" value={config.false_next} keys={keys} onChange={(value) => set('false_next', value)} />
        </>
      )}

      {node.node_type === 'set_tag' && (
        <><label className="field"><span>Tag</span><select className="input" value={config.tag_id || ''} onChange={(event) => set('tag_id', Number(event.target.value) || null)}><option value="">Choose…</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label><TargetSelect label="Next node" value={config.next_node_key} keys={keys} onChange={(value) => set('next_node_key', value)} /></>
      )}

      {isTerminal && <p className="muted">This node ends the flow.</p>}
      {!isTerminal && !isSuspending && !['send_message', 'send_media', 'collect_input', 'start', 'condition', 'set_tag', 'send_buttons', 'send_list'].includes(node.node_type) && <TargetSelect label="Next node" value={config.next_node_key} keys={keys} onChange={(value) => set('next_node_key', value)} />}
    </div>
  )
}

export default function FlowEditorPage() {
  const { id } = useParams()
  const toast = useToast()
  const [flow, setFlow] = useState(null)
  const [nodes, setNodes] = useState([])
  const [tags, setTags] = useState([])
  const [issues, setIssues] = useState([])
  const [selected, setSelected] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [graph, options] = await Promise.all([
        api.get(`/api/app/flows/${id}`),
        api.get('/api/app/automations/options'),
      ])
      setFlow(graph.data.flow)
      setNodes(graph.data.nodes || [])
      setSelected(graph.data.nodes?.[0]?.node_key || '')
      setTags(options.data.tags || [])
    } catch (error) {
      toast.error(errorMessage(error, 'Unable to load flow.'))
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => { load() }, [load])

  const updateFlow = (field, value) => setFlow((current) => ({ ...current, [field]: value }))
  const updateTrigger = (field, value) => setFlow((current) => ({ ...current, trigger_config: { ...current.trigger_config, [field]: value } }))
  const updateFallback = (field, value) => setFlow((current) => ({ ...current, fallback_policy: { ...current.fallback_policy, [field]: value } }))

  const updateNode = (key, field, value) => setNodes((current) => current.map((node) => node.node_key === key ? { ...node, [field]: value } : node))

  const addNode = () => {
    let index = nodes.length + 1
    let key = `node_${index}`
    while (nodes.some((node) => node.node_key === key)) key = `node_${++index}`
    const next = { node_key: key, node_type: 'send_message', config: { text: '' }, position_x: 0, position_y: nodes.length * 120 }
    setNodes((current) => [...current, next])
    setSelected(key)
  }

  const payload = () => ({
    name: flow.name,
    description: flow.description,
    trigger_type: flow.trigger_type,
    trigger_config: flow.trigger_config || {},
    entry_node_id: flow.entry_node_id,
    fallback_policy: flow.fallback_policy || {},
    nodes,
  })

  const save = async () => {
    setSaving(true)
    setIssues([])
    try {
      const { data } = await api.put(`/api/app/flows/${id}`, payload())
      setFlow(data.flow || data)
      toast.success('Flow saved.')
    } catch (error) {
      setIssues(error.response?.data?.issues || [])
      toast.error(errorMessage(error, 'Unable to save flow.'))
    } finally {
      setSaving(false)
    }
  }

  const activate = async () => {
    setSaving(true)
    setIssues([])
    try {
      await api.put(`/api/app/flows/${id}`, payload())
      const { data } = await api.post(`/api/app/flows/${id}/activate`, { status: flow.status === 'active' ? 'draft' : 'active' })
      setFlow(data.flow || data)
      toast.success(flow.status === 'active' ? 'Flow paused.' : 'Flow activated.')
    } catch (error) {
      setIssues(error.response?.data?.issues || [])
      toast.error(errorMessage(error, 'Unable to update flow status.'))
    } finally {
      setSaving(false)
    }
  }

  if (loading || !flow) return <div className="dash-page"><div className="dash-empty"><span className="spinner" /> Loading flow…</div></div>
  const current = nodes.find((node) => node.node_key === selected) || nodes[0]

  return (
    <div className="dash-page flow-editor">
      <header className="dash-header">
        <div><h1>{flow.name}</h1><p>{TRIGGERS.find(([value]) => value === flow.trigger_type)?.[1] || flow.trigger_type} trigger · {nodes.length} nodes</p></div>
        <div className="bc-actions">
          <Link className="button button-secondary" to="/flows">Back</Link>
          <Link className="button button-secondary" to={`/flows/${id}/runs`}>Runs</Link>
          <button type="button" className="button button-secondary" onClick={save} disabled={saving}>Save</button>
          <button type="button" className="button button-primary" onClick={activate} disabled={saving}><Icon name={flow.status === 'active' ? 'pause' : 'play'} size={14} /> {flow.status === 'active' ? 'Pause' : 'Activate'}</button>
        </div>
      </header>

      {issues.length > 0 && <div className="alert alert-error"><ul>{issues.map((issue, index) => <li key={index}>{issue.node_key ? `${issue.node_key}: ` : ''}{issue.message}</li>)}</ul></div>}

      <section className="dash-card auto-section">
        <h2>Details & trigger</h2>
        <div className="agents-form-grid">
          <label className="field"><span>Name</span><input className="input" value={flow.name || ''} onChange={(event) => updateFlow('name', event.target.value)} /></label>
          <label className="field"><span>Trigger</span><select className="input" value={flow.trigger_type} onChange={(event) => updateFlow('trigger_type', event.target.value)}>{TRIGGERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field field-full"><span>Description</span><input className="input" value={flow.description || ''} onChange={(event) => updateFlow('description', event.target.value)} /></label>
          {flow.trigger_type === 'keyword' && <label className="field field-full"><span>Keywords <em>comma separated</em></span><input className="input" value={(flow.trigger_config?.keywords || []).join(', ')} onChange={(event) => updateTrigger('keywords', event.target.value.split(',').map((value) => value.trim()).filter(Boolean))} /></label>}
          <TargetSelect label="Entry node" value={flow.entry_node_id} keys={nodes.map((node) => node.node_key)} onChange={(value) => updateFlow('entry_node_id', value)} />
        </div>
      </section>

      <section className="dash-card auto-section">
        <div className="auto-section-head"><h2>Fallback policy</h2><span className="badge badge-pending">Unknown replies & timeouts</span></div>
        <div className="agents-form-grid">
          <label className="field"><span>Unknown reply</span><select className="input" value={flow.fallback_policy?.on_unknown_reply || 'reprompt'} onChange={(event) => updateFallback('on_unknown_reply', event.target.value)}><option value="reprompt">Re-prompt</option><option value="handoff">Handoff</option><option value="end">End</option><option value="ignore">Ignore</option></select></label>
          <label className="field"><span>Max re-prompts</span><input className="input" type="number" min="0" value={flow.fallback_policy?.max_reprompts ?? 1} onChange={(event) => updateFallback('max_reprompts', Number(event.target.value))} /></label>
          <label className="field"><span>On exhaustion</span><select className="input" value={flow.fallback_policy?.on_exhaust || 'handoff'} onChange={(event) => updateFallback('on_exhaust', event.target.value)}><option value="handoff">Handoff</option><option value="end">End</option></select></label>
          <label className="field"><span>Timeout (hours)</span><input className="input" type="number" min="1" value={flow.fallback_policy?.on_timeout_hours ?? 24} onChange={(event) => updateFallback('on_timeout_hours', Number(event.target.value))} /></label>
        </div>
      </section>

      <section className="dash-card auto-section flow-builder">
        <div className="auto-section-head"><h2>Nodes</h2><button type="button" className="button button-secondary button-sm" onClick={addNode}><Icon name="plus" size={13} /> Add node</button></div>
        <div className="flow-columns">
          <div className="flow-node-list">
            {nodes.map((node) => (
              <button type="button" key={node.node_key} className={`flow-node${current?.node_key === node.node_key ? ' is-selected' : ''}`} onClick={() => setSelected(node.node_key)}>
                <span className="flow-node-type"><Icon name={node.node_type === 'handoff' ? 'users' : node.node_type === 'set_tag' ? 'tag' : node.node_type === 'condition' ? 'bolt' : 'chat'} size={15} /></span>
                <span><strong>{node.node_key}</strong><small>{nodeLabel(node.node_type)}</small></span>
                {flow.entry_node_id === node.node_key && <span className="badge badge-approved">Entry</span>}
              </button>
            ))}
            {!nodes.length && <div className="dash-empty"><Icon name="workflow" size={22} /><span>Add your first node.</span></div>}
          </div>
          {current ? (
            <div className="flow-node-editor">
              <div className="flow-node-editor-head">
                <div className="agents-form-grid">
                  <label className="field"><span>Node key</span><input className="input" value={current.node_key} onChange={(event) => {
                    const previousKey = current.node_key
                    const nextKey = event.target.value.trim().replace(/\s+/g, '_') || previousKey
                    const retarget = (value) => value === previousKey ? nextKey : value
                    setNodes((currentNodes) => currentNodes.map((node) => {
                      const config = { ...(node.config || {}) }
                      if (config.next_node_key) config.next_node_key = retarget(config.next_node_key)
                      if (config.true_next) config.true_next = retarget(config.true_next)
                      if (config.false_next) config.false_next = retarget(config.false_next)
                      if (Array.isArray(config.buttons)) config.buttons = config.buttons.map((button) => ({ ...button, next_node_key: retarget(button.next_node_key) }))
                      if (Array.isArray(config.sections)) config.sections = config.sections.map((section) => ({ ...section, rows: (section.rows || []).map((row) => ({ ...row, next_node_key: retarget(row.next_node_key) })) }))
                      return { ...node, node_key: node.node_key === previousKey ? nextKey : node.node_key, config }
                    }))
                    if (flow.entry_node_id === previousKey) updateFlow('entry_node_id', nextKey)
                    setSelected(nextKey)
                  }} /></label>
                  <label className="field"><span>Type</span><select className="input" value={current.node_type} onChange={(event) => updateNode(current.node_key, 'node_type', event.target.value)}>{NODE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <button type="button" className="icon-button flow-node-delete" title="Delete node" onClick={() => { setNodes((currentNodes) => currentNodes.filter((node) => node.node_key !== current.node_key)); setSelected('') }}><Icon name="trash" size={15} /></button>
                </div>
              </div>
              <NodeConfig node={current} nodes={nodes} tags={tags} update={(field, value) => updateNode(current.node_key, field, value)} />
            </div>
          ) : <div className="flow-node-editor dash-empty">Select a node to configure it.</div>}
        </div>
      </section>
    </div>
  )
}
