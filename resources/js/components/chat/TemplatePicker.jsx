import { useEffect, useState } from 'react'
import api from '../../api/client.js'
import Icon from '../common/Icon.jsx'
import { useToast } from '../common/ToastProvider.jsx'
import { errorMessage } from '../../lib/utils.js'
import { extractTemplateVariables, isApprovedTemplate, renderTemplateBody, templateButtons } from '../../lib/whatsappPayloads.js'

export default function TemplatePicker({ open, onClose, onSend, sending = false }) {
  const toast = useToast()
  const [templates, setTemplates] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [bodyValues, setBodyValues] = useState([])
  const [headerText, setHeaderText] = useState('')
  const [headerFile, setHeaderFile] = useState(null)
  const [buttonParams, setButtonParams] = useState({})
  const [loading, setLoading] = useState(false)
  const [localError, setLocalError] = useState('')

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    setLocalError('')
    api.get('/api/app/whatsapp/templates')
      .then(({ data }) => {
        if (!active) return
        const rows = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : [])
        setTemplates(rows.filter(isApprovedTemplate))
      })
      .catch((error) => { if (active) setLocalError(errorMessage(error, 'Unable to load templates.')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open])

  const selected = templates.find((template) => String(template.id) === String(selectedId)) || null
  const bodyCount = selected ? extractTemplateVariables(selected.body_text).length : 0
  const headerCount = selected ? extractTemplateVariables(selected.header_content).length : 0
  const headerType = String(selected?.header_type || '').toLowerCase()
  const mediaHeader = ['image', 'video', 'document'].includes(headerType)
  const buttons = selected ? templateButtons(selected) : []

  const choose = (template) => {
    setSelectedId(String(template.id))
    setBodyValues(Array.from({ length: extractTemplateVariables(template.body_text).length }, () => ''))
    setHeaderText('')
    setHeaderFile(null)
    setButtonParams({})
    setLocalError('')
  }

  const submit = () => {
    if (!selected) return
    const missingBody = bodyValues.slice(0, bodyCount).some((value) => !String(value).trim())
    if (missingBody) {
      setLocalError('Fill in every body variable before sending.')
      return
    }
    if (headerCount && !headerText.trim()) {
      setLocalError('Fill in the header text variable before sending.')
      return
    }
    if (mediaHeader && !headerFile && !selected.header_media_url) {
      setLocalError('Choose a file for the template header.')
      return
    }
    onSend(selected, {
      body: bodyValues.slice(0, bodyCount),
      headerText: headerCount ? headerText : undefined,
      headerFile,
      buttonParams,
    })
  }

  if (!open) return null

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !sending) onClose() }}>
      <div className="template-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="template-picker-title">
        <div className="dash-failed-head">
          <div>
            <h2 id="template-picker-title">Send a template</h2>
            <p>Approved templates can be sent outside the 24-hour window.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} disabled={sending} aria-label="Close"><Icon name="close" size={17} /></button>
        </div>
        {localError && <div className="alert alert-error alert-inline">{localError}</div>}
        {loading ? (
          <div className="list-placeholder"><span className="spinner" /> Loading templates...</div>
        ) : templates.length ? (
          <div className="template-picker-body">
            <div className="template-picker-list">
              {templates.map((template) => (
                <button
                  type="button"
                  key={template.id}
                  className={`template-picker-item${String(template.id) === String(selectedId) ? ' is-active' : ''}`}
                  onClick={() => choose(template)}
                >
                  <strong>{template.name}</strong>
                  <span>{template.language || 'en_US'}</span>
                </button>
              ))}
            </div>
            <div className="template-picker-detail">
              {!selected ? (
                <div className="list-placeholder">Choose an approved template.</div>
              ) : (
                <>
                  <div className="template-preview">
                    {selected.header_content && <strong>{renderTemplateBody(selected.header_content, [headerText])}</strong>}
                    <p>{renderTemplateBody(selected.body_text, bodyValues)}</p>
                    {selected.footer_text && <small>{selected.footer_text}</small>}
                  </div>
                  {Array.from({ length: bodyCount }, (_, index) => (
                    <div className="field" key={`body-${index}`}>
                      <label className="field-label" htmlFor={`template-body-${index}`}>Body variable {index + 1}</label>
                      <input
                        id={`template-body-${index}`}
                        className="input"
                        value={bodyValues[index] || ''}
                        onChange={(event) => setBodyValues((current) => current.map((value, position) => position === index ? event.target.value : value))}
                      />
                    </div>
                  ))}
                  {headerCount > 0 && (
                    <div className="field">
                      <label className="field-label" htmlFor="template-header">Header variable</label>
                      <input id="template-header" className="input" value={headerText} onChange={(event) => setHeaderText(event.target.value)} />
                    </div>
                  )}
                  {mediaHeader && (
                    <div className="field">
                      <label className="field-label" htmlFor="template-header-file">Header attachment</label>
                      <input
                        key={selected.id}
                        id="template-header-file"
                        className="input"
                        type="file"
                        accept={headerType === 'document' ? '.pdf,application/pdf' : headerType + '/*'}
                        onChange={(event) => setHeaderFile(event.target.files?.[0] || null)}
                      />
                    </div>
                  )}
                  {buttons.map((button, index) => {
                    const needsParam = String(button.type || '').toUpperCase() === 'COPY_CODE'
                      || (String(button.type || '').toUpperCase() === 'URL' && extractTemplateVariables(button.url).length > 0)
                    if (!needsParam) return null
                    return (
                      <div className="field" key={`button-${index}`}>
                        <label className="field-label" htmlFor={`template-button-${index}`}>
                          {String(button.type || '').toUpperCase() === 'URL' ? `URL suffix ${index + 1}` : `Coupon code ${index + 1}`}
                        </label>
                        <input
                          id={`template-button-${index}`}
                          className="input"
                          value={buttonParams[index] || ''}
                          onChange={(event) => setButtonParams((current) => ({ ...current, [index]: event.target.value }))}
                        />
                      </div>
                    )
                  })}
                  <div className="template-picker-actions">
                    <button type="button" className="button button-secondary" onClick={onClose} disabled={sending}>Cancel</button>
                    <button type="button" className="button button-primary" onClick={submit} disabled={sending}>{sending ? 'Sending...' : 'Send template'}</button>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="dash-empty">No approved templates are available yet.</div>
        )}
      </div>
    </div>
  )
}
