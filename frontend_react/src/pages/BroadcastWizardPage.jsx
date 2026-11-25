import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api, { csrf } from '../api/client.js'
import Icon from '../components/common/Icon.jsx'
import { useToast } from '../components/common/ToastProvider.jsx'
import { errorMessage } from '../lib/utils.js'

const STEPS = ['Template', 'Audience', 'Personalize', 'Schedule & send']
const FIELDS = [
  ['name', 'Name'],
  ['email', 'Email'],
  ['company', 'Company'],
  ['phone', 'Phone'],
]

const blank = {
  name: '',
  template_id: '',
  scheduled_at: '',
  audience: {
    type: 'all',
    tag_ids: [],
    exclude_tag_ids: [],
    custom_field_id: '',
    operator: 'is',
    value: '',
    phones: '',
    csv_file: null,
  },
  personalization: {},
}

export default function BroadcastWizardPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const [options, setOptions] = useState({ templates: [], tags: [], custom_fields: [] })
  const [form, setForm] = useState(blank)
  const [step, setStep] = useState(0)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/api/app/broadcasts/options')
      .then(({ data }) => setOptions(data))
      .catch((requestError) => setError(errorMessage(requestError, 'Unable to load broadcast options.')))
  }, [])

  const template = useMemo(
    () => options.templates.find((item) => String(item.id) === String(form.template_id)),
    [options.templates, form.template_id],
  )

  const placeholders = useMemo(() => {
    const found = []
    for (const match of String(template?.body_text || '').matchAll(/\{\{(\d+)\}\}/g)) {
      if (!found.includes(match[1])) found.push(match[1])
    }
    return found
  }, [template])

  const setAudience = (patch) => setForm((current) => ({ ...current, audience: { ...current.audience, ...patch } }))
  const setPersonalization = (key, patch) => setForm((current) => ({
    ...current,
    personalization: { ...current.personalization, [key]: { ...(current.personalization[key] || { source: 'static', value: '' }), ...patch } },
  }))

  const toggleTag = (field, id) => setAudience({
    [field]: form.audience[field].includes(Number(id))
      ? form.audience[field].filter((item) => item !== Number(id))
      : [...form.audience[field], Number(id)],
  })

  const buildData = (mode) => {
    const data = new FormData()
    data.append('name', form.name)
    data.append('template_id', form.template_id)
    data.append('send_now', mode === 'send' ? '1' : '0')
    if (mode === 'schedule' && form.scheduled_at) data.append('scheduled_at', new Date(form.scheduled_at).toISOString())

    data.append('audience[type]', form.audience.type)
    form.audience.tag_ids.forEach((id, index) => data.append(`audience[tag_ids][${index}]`, id))
    form.audience.exclude_tag_ids.forEach((id, index) => data.append(`audience[exclude_tag_ids][${index}]`, id))
    if (form.audience.custom_field_id) data.append('audience[custom_field_id]', form.audience.custom_field_id)
    data.append('audience[operator]', form.audience.operator)
    data.append('audience[value]', form.audience.value)
    data.append('audience[phones]', form.audience.phones)
    if (form.audience.csv_file) data.append('audience[csv_file]', form.audience.csv_file)

    Object.entries(form.personalization).forEach(([key, config]) => {
      data.append(`personalization[${key}][source]`, config.source)
      data.append(`personalization[${key}][value]`, config.value)
    })

    return data
  }

  const checkAudience = async () => {
    setBusy(true)
    setError('')
    try {
      const data = new FormData()
      data.append('audience[type]', form.audience.type)
      form.audience.tag_ids.forEach((id, index) => data.append(`audience[tag_ids][${index}]`, id))
      form.audience.exclude_tag_ids.forEach((id, index) => data.append(`audience[exclude_tag_ids][${index}]`, id))
      if (form.audience.custom_field_id) data.append('audience[custom_field_id]', form.audience.custom_field_id)
      data.append('audience[operator]', form.audience.operator)
      data.append('audience[value]', form.audience.value)
      data.append('audience[phones]', form.audience.phones)
      if (form.audience.csv_file) data.append('audience[csv_file]', form.audience.csv_file)
      const { data: result } = await api.post('/api/app/broadcasts/preview', data)
      setPreview(result)
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to preview this audience.'))
    } finally {
      setBusy(false)
    }
  }

  const submit = async (mode) => {
    if (!form.name.trim() || !form.template_id) {
      toast.error('Add a name and choose a template first.')
      setStep(mode === 'send' ? 3 : 0)
      return
    }
    if (mode === 'schedule' && !form.scheduled_at) {
      toast.error('Choose a send time first.')
      return
    }
    if (mode === 'send' && !window.confirm(`Send "${form.name}" to the selected contacts now? This will deliver real WhatsApp messages.`)) return

    setSaving(true)
    setError('')
    try {
      await csrf()
      const { data } = await api.post('/api/app/broadcasts', buildData(mode))
      toast.success(mode === 'send' ? 'Broadcast queued for delivery.' : mode === 'schedule' ? 'Broadcast scheduled.' : 'Broadcast saved as a draft.')
      navigate(`/broadcasts/${data.id}`)
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to save this broadcast.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="dash-page">
      <header className="dash-header">
        <div>
          <h1>New broadcast</h1>
          <p>Build and send an approved WhatsApp template campaign.</p>
        </div>
        <button type="button" className="button button-secondary" onClick={() => navigate('/broadcasts')}>Cancel</button>
      </header>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <ol className="bc-steps">
        {STEPS.map((label, index) => (
          <li key={label} className={index === step ? 'is-active' : index < step ? 'is-done' : ''}>
            <span>{index < step ? <Icon name="check" size={12} /> : index + 1}</span> {label}
          </li>
        ))}
      </ol>

      <section className="dash-card bc-wizard-card">
        {step === 0 ? (
          <div className="bc-step">
            <h2>Choose an approved template</h2>
            <p className="field-hint">Only approved Meta templates can be sent in a broadcast.</p>
            <div className="bc-template-grid">
              {options.templates.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`bc-template${String(form.template_id) === String(item.id) ? ' is-active' : ''}`}
                  onClick={() => setForm({ ...form, template_id: item.id })}
                >
                  <strong>{item.name}</strong>
                  <small>{item.language}</small>
                  <p>{item.body_text}</p>
                </button>
              ))}
              {!options.templates.length ? <div className="dash-empty">No approved templates found. Approve one in Templates first.</div> : null}
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="bc-step">
            <h2>Select audience</h2>
            <div className="field">
              <label className="field-label" htmlFor="bc-audience-type">Audience source</label>
              <select id="bc-audience-type" className="input" value={form.audience.type} onChange={(event) => setAudience({ type: event.target.value })}>
                <option value="all">All opted-in contacts</option>
                <option value="tags">Contacts with tags</option>
                <option value="custom_field">Custom field filter</option>
                <option value="csv">CSV / pasted numbers</option>
              </select>
            </div>

            {form.audience.type === 'tags' ? (
              <div className="field">
                <label className="field-label">Include tags</label>
                <div className="bc-chip-grid">
                  {options.tags.map((tag) => (
                    <label key={tag.id} className={`bc-chip${form.audience.tag_ids.includes(tag.id) ? ' is-active' : ''}`}>
                      <input type="checkbox" checked={form.audience.tag_ids.includes(tag.id)} onChange={() => toggleTag('tag_ids', tag.id)} /> {tag.name}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {form.audience.type === 'custom_field' ? (
              <div className="form-grid">
                <div className="field">
                  <label className="field-label" htmlFor="bc-field">Custom field</label>
                  <select id="bc-field" className="input" value={form.audience.custom_field_id} onChange={(event) => setAudience({ custom_field_id: event.target.value })}>
                    <option value="">Select…</option>
                    {options.custom_fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="bc-operator">Operator</label>
                  <select id="bc-operator" className="input" value={form.audience.operator} onChange={(event) => setAudience({ operator: event.target.value })}>
                    <option value="is">is</option>
                    <option value="is_not">is not</option>
                    <option value="contains">contains</option>
                  </select>
                </div>
                <div className="field field-full">
                  <label className="field-label" htmlFor="bc-value">Value</label>
                  <input id="bc-value" className="input" value={form.audience.value} onChange={(event) => setAudience({ value: event.target.value })} />
                </div>
              </div>
            ) : null}

            {form.audience.type === 'csv' ? (
              <div className="form-grid">
                <div className="field field-full">
                  <label className="field-label" htmlFor="bc-phones">Phone numbers</label>
                  <textarea id="bc-phones" className="input" rows="5" placeholder="One number per line" value={form.audience.phones} onChange={(event) => setAudience({ phones: event.target.value })} />
                </div>
                <div className="field field-full">
                  <label className="field-label" htmlFor="bc-csv">Or upload CSV</label>
                  <input id="bc-csv" type="file" accept=".csv,.txt" onChange={(event) => setAudience({ csv_file: event.target.files?.[0] || null })} />
                </div>
              </div>
            ) : null}

            <div className="field">
              <label className="field-label">Exclude tags</label>
              <div className="bc-chip-grid">
                {options.tags.map((tag) => (
                  <label key={tag.id} className={`bc-chip${form.audience.exclude_tag_ids.includes(tag.id) ? ' is-active' : ''}`}>
                    <input type="checkbox" checked={form.audience.exclude_tag_ids.includes(tag.id)} onChange={() => toggleTag('exclude_tag_ids', tag.id)} /> {tag.name}
                  </label>
                ))}
              </div>
            </div>

            <button type="button" className="button button-secondary" onClick={checkAudience} disabled={busy}>{busy ? 'Checking…' : 'Check audience'}</button>
            {preview ? (
              <div className="bc-preview">
                <strong>{preview.count} contacts matched</strong>
                {preview.sample.length ? <span>{preview.sample.map((item) => item.name || item.phone).join(', ')}</span> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="bc-step">
            <h2>Personalize variables</h2>
            <p className="field-hint">Map each template placeholder to a contact field or a fixed value.</p>
            {placeholders.length ? placeholders.map((key) => {
              const config = form.personalization[key] || { source: 'static', value: '' }
              return (
                <div className="bc-variable" key={key}>
                  <strong>{`{{${key}}}`}</strong>
                  <select className="input" value={config.source} onChange={(event) => setPersonalization(key, { source: event.target.value, value: '' })}>
                    <option value="static">Fixed value</option>
                    <option value="field">Contact field</option>
                    <option value="custom_field">Custom field</option>
                  </select>
                  {config.source === 'field' ? (
                    <select className="input" value={config.value} onChange={(event) => setPersonalization(key, { value: event.target.value })}>
                      <option value="">Select…</option>
                      {FIELDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  ) : config.source === 'custom_field' ? (
                    <select className="input" value={config.value} onChange={(event) => setPersonalization(key, { value: event.target.value })}>
                      <option value="">Select…</option>
                      {options.custom_fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
                    </select>
                  ) : (
                    <input className="input" value={config.value} onChange={(event) => setPersonalization(key, { value: event.target.value })} placeholder="Value" />
                  )}
                </div>
              )
            }) : <div className="dash-empty">This template has no variables.</div>}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="bc-step">
            <h2>Schedule & send</h2>
            <div className="form-grid">
              <div className="field field-full">
                <label className="field-label" htmlFor="bc-name">Broadcast name</label>
                <input id="bc-name" className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Diwali offer" />
              </div>
              <div className="field field-full">
                <label className="field-label" htmlFor="bc-schedule">Send later (optional)</label>
                <input id="bc-schedule" className="input" type="datetime-local" value={form.scheduled_at} onChange={(event) => setForm({ ...form, scheduled_at: event.target.value })} />
              </div>
            </div>
            <div className="bc-send-note">
              <Icon name="alertCircle" size={16} />
              <span>Sending queues real WhatsApp template messages. If you set a time, a queue worker and scheduler must be running.</span>
            </div>
            <div className="settings-actions">
              <button type="button" className="button button-secondary" onClick={() => submit('draft')} disabled={saving}>Save draft</button>
              <button type="button" className="button button-primary" onClick={() => submit('schedule')} disabled={saving}>{saving ? 'Saving…' : 'Schedule'}</button>
              <button type="button" className="button button-primary" onClick={() => submit('send')} disabled={saving}><Icon name="send" size={14} /> Send now</button>
            </div>
          </div>
        ) : null}

        <div className="bc-wizard-footer">
          <button type="button" className="button button-secondary" disabled={step === 0} onClick={() => setStep(step - 1)}><Icon name="back" size={14} /> Back</button>
          <button type="button" className="button button-primary" disabled={step === STEPS.length - 1 || (step === 0 && !form.template_id)} onClick={() => setStep(step + 1)}>Continue <Icon name="arrowRight" size={14} /></button>
        </div>
      </section>
    </div>
  )
}
