import { useEffect, useState } from 'react'
import Icon from '../common/Icon.jsx'
import { blankButtonsPayload, blankListPayload } from '../../lib/whatsappPayloads.js'
import InteractivePreview from './InteractivePreview.jsx'

function nextId(prefix, items) {
  const ids = new Set(items.map((item) => item.id))
  let index = 1
  while (ids.has(`${prefix}_${index}`)) index++
  return `${prefix}_${index}`
}

export default function InteractiveBuilder({
  open,
  initialPayload = null,
  onClose,
  onSend,
  onSave,
  sending = false,
  actionLabel = 'Send message',
}) {
  const [payload, setPayload] = useState(() => initialPayload ? { ...initialPayload } : blankButtonsPayload())

  useEffect(() => {
    if (open) setPayload(initialPayload ? { ...initialPayload } : blankButtonsPayload())
  }, [open, initialPayload])
  useEffect(() => {
    if (!open || sending) return
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open, onClose, sending])

  if (!open) return null

  const update = (field, value) => setPayload((current) => ({ ...current, [field]: value }))
  const switchKind = (kind) => setPayload(kind === 'list' ? blankListPayload() : blankButtonsPayload())
  const updateButton = (index, field, value) => setPayload((current) => ({
    ...current,
    buttons: current.buttons.map((button, position) => position === index ? { ...button, [field]: value } : button),
  }))
  const updateSection = (index, field, value) => setPayload((current) => ({
    ...current,
    sections: current.sections.map((section, position) => position === index ? { ...section, [field]: value } : section),
  }))
  const updateRow = (sectionIndex, rowIndex, field, value) => setPayload((current) => ({
    ...current,
    sections: current.sections.map((section, position) => position === sectionIndex
      ? { ...section, rows: section.rows.map((row, rowPosition) => rowPosition === rowIndex ? { ...row, [field]: value } : row) }
      : section),
  }))

  const rows = payload.sections?.flatMap((section) => section.rows) || []
  const disabled = sending || !String(payload.body || '').trim()

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !sending) onClose() }}>
      <div className="template-picker-dialog interactive-builder-dialog" role="dialog" aria-modal="true" aria-labelledby="interactive-builder-title">
        <div className="dash-failed-head">
          <div>
            <h2 id="interactive-builder-title">Interactive message</h2>
            <p>Build buttons or a list your contacts can tap.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} disabled={sending} aria-label="Close" title="Close"><Icon name="close" size={17} /></button>
        </div>
        <div className="interactive-kind-switch" role="group" aria-label="Interactive type">
          <button type="button" className={`button button-sm ${payload.kind === 'buttons' ? 'button-primary' : 'button-secondary'}`} aria-pressed={payload.kind === 'buttons'} disabled={sending} onClick={() => payload.kind !== 'buttons' && switchKind('buttons')}>Buttons</button>
          <button type="button" className={`button button-sm ${payload.kind === 'list' ? 'button-primary' : 'button-secondary'}`} aria-pressed={payload.kind === 'list'} disabled={sending} onClick={() => payload.kind !== 'list' && switchKind('list')}>List</button>
        </div>
        <div className="interactive-builder-grid">
          <div className="field">
            <label className="field-label" htmlFor="interactive-body">Body text</label>
            <textarea id="interactive-body" className="input" rows="3" maxLength="1024" value={payload.body || ''} onChange={(event) => update('body', event.target.value)} />
          </div>
          <div className="field-grid-two">
            <div className="field">
              <label className="field-label" htmlFor="interactive-header">Header</label>
              <input id="interactive-header" className="input" maxLength="60" value={payload.header || ''} onChange={(event) => update('header', event.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="interactive-footer">Footer</label>
              <input id="interactive-footer" className="input" maxLength="60" value={payload.footer || ''} onChange={(event) => update('footer', event.target.value)} />
            </div>
          </div>
          {payload.kind === 'buttons' ? (
            <div className="interactive-editor-section">
              <div className="interactive-editor-head">
                <strong>Buttons</strong>
                <button type="button" className="button button-sm button-secondary" onClick={() => update('buttons', [...payload.buttons, { id: nextId('option', payload.buttons), title: '' }])} disabled={payload.buttons.length >= 3}>
                  <Icon name="plus" size={13} /> Add button
                </button>
              </div>
              {payload.buttons.map((button, index) => (
                <div className="interactive-row" key={index}>
                  <input className="input" maxLength="20" placeholder="Reply ID" aria-label={`Reply ID ${index + 1}`} value={button.id || ''} onChange={(event) => updateButton(index, 'id', event.target.value)} />
                  <input className="input" maxLength="20" placeholder="Button title" aria-label={`Button title ${index + 1}`} value={button.title || ''} onChange={(event) => updateButton(index, 'title', event.target.value)} />
                  <button type="button" className="icon-button is-danger" disabled={payload.buttons.length <= 1} onClick={() => update('buttons', payload.buttons.filter((_, position) => position !== index))} aria-label={`Remove button ${index + 1}`} title={`Remove button ${index + 1}`}><Icon name="trash" size={14} /></button>
                </div>
              ))}
            </div>
          ) : (
            <div className="interactive-editor-section">
              <div className="field">
                <label className="field-label" htmlFor="interactive-list-button">Button label</label>
                <input id="interactive-list-button" className="input" maxLength="20" value={payload.button_label || ''} onChange={(event) => update('button_label', event.target.value)} />
              </div>
              {payload.sections.map((section, sectionIndex) => (
                <div className="interactive-section-editor" key={sectionIndex}>
                  <div className="interactive-editor-head">
                    <strong>Section {sectionIndex + 1}</strong>
                    <button type="button" className="icon-button is-danger" disabled={payload.sections.length <= 1} onClick={() => update('sections', payload.sections.filter((_, position) => position !== sectionIndex))} aria-label={`Remove section ${sectionIndex + 1}`} title={`Remove section ${sectionIndex + 1}`}><Icon name="trash" size={14} /></button>
                  </div>
                  <div className="field">
                    <label htmlFor={`interactive-section-${sectionIndex}`} className="field-label">Section title</label>
                    <input id={`interactive-section-${sectionIndex}`} className="input" maxLength="24" value={section.title || ''} onChange={(event) => updateSection(sectionIndex, 'title', event.target.value)} />
                  </div>
                  {section.rows.map((row, rowIndex) => (
                    <div className="interactive-row" key={rowIndex}>
                      <input className="input" maxLength="200" placeholder="Row ID" aria-label={`Row ${rowIndex + 1} ID`} value={row.id || ''} onChange={(event) => updateRow(sectionIndex, rowIndex, 'id', event.target.value)} />
                      <input className="input" maxLength="24" placeholder="Row title" aria-label={`Row ${rowIndex + 1} title`} value={row.title || ''} onChange={(event) => updateRow(sectionIndex, rowIndex, 'title', event.target.value)} />
                      <input className="input" maxLength="72" placeholder="Description" aria-label={`Row ${rowIndex + 1} description`} value={row.description || ''} onChange={(event) => updateRow(sectionIndex, rowIndex, 'description', event.target.value)} />
                      <button type="button" className="icon-button is-danger" disabled={section.rows.length <= 1} onClick={() => updateSection(sectionIndex, 'rows', section.rows.filter((_, position) => position !== rowIndex))} aria-label={`Remove row ${rowIndex + 1}`} title={`Remove row ${rowIndex + 1}`}><Icon name="trash" size={14} /></button>
                    </div>
                  ))}
                  <button type="button" className="button button-sm button-secondary" disabled={rows.length >= 10} onClick={() => updateSection(sectionIndex, 'rows', [...section.rows, { id: nextId('row', rows), title: '' }])}>
                    <Icon name="plus" size={13} /> Add row
                  </button>
                </div>
              ))}
              <button type="button" className="button button-sm button-secondary" disabled={rows.length >= 10} onClick={() => update('sections', [...payload.sections, { title: '', rows: [{ id: nextId('row', rows), title: '' }] }])}>
                <Icon name="plus" size={13} /> Add section
              </button>
            </div>
          )}
          <InteractivePreview payload={payload} />
          <div className="template-picker-actions">
            <button type="button" className="button button-secondary" onClick={onClose} disabled={sending}>Cancel</button>
            {onSave && <button type="button" className="button button-secondary" onClick={() => onSave(payload)} disabled={disabled}>Save as quick reply</button>}
            <button type="button" className="button button-primary" onClick={() => onSend(payload)} disabled={disabled}>{actionLabel}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
