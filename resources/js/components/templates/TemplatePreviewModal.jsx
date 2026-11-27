import { useEffect } from 'react'
import Icon from '../common/Icon.jsx'
import TemplatePreview, { previewButtons, previewValues } from './TemplatePreview.jsx'
import { placeholders } from '../../lib/utils.js'

export default function TemplatePreviewModal({
  template,
  statusLabel,
  statusTone,
  can,
  hasContacts,
  busy,
  onClose,
  onSend,
  onRevision,
  onSubmit,
  onEdit,
  onDelete,
}) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  if (!template) return null

  const status = String(template.approval_status || template.status || 'PENDING').toUpperCase()
  const approved = status === 'APPROVED'
  const isBusy = Boolean(busy)
  const headerType = String(template.header_type || '').toUpperCase()
  const headerDetail = headerType === 'TEXT'
    ? template.header_content || '—'
    : headerType
      ? `${headerType}${template.header_media_url ? ' · media URL available' : ''}`
      : '—'
  const sampleValues = previewValues(template.sample_values)
  const variableKeys = [...new Set([
    ...placeholders(template.header_content),
    ...placeholders(template.body_text),
    ...placeholders(template.footer_text),
  ])]
  const buttons = previewButtons(template.buttons)
  const rejected = status === 'REJECTED' || status === 'DISAPPROVED'

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="template-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="template-preview-title">
        <header className="template-preview-modal-head">
          <div className="template-preview-modal-title">
            <h2 id="template-preview-title">{template.name}</h2>
            <span className={`badge badge-${statusTone}`}>{statusLabel}</span>
            <p className="template-preview-modal-sub">
              {[template.category || 'UTILITY', template.language || 'en_US'].join(' · ')}
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close preview"><Icon name="close" size={18} /></button>
        </header>

        <div className="template-preview-modal-body">
          <div className="template-preview-modal-visual">
            <TemplatePreview template={template} showChrome={false} />
          </div>
          <div className="template-preview-modal-details">
            <div className="template-detail-row">
              <span className="template-detail-label">Header</span>
              <span className="template-detail-value">{headerDetail}</span>
            </div>
            <div className="template-detail-row">
              <span className="template-detail-label">Body</span>
              <span className="template-detail-value">{template.body_text || '—'}</span>
            </div>
            <div className="template-detail-row">
              <span className="template-detail-label">Footer</span>
              <span className="template-detail-value">{template.footer_text || '—'}</span>
            </div>
            <div className="template-detail-row">
              <span className="template-detail-label">Buttons</span>
              <span className="template-detail-value template-detail-chips">
                {buttons.length
                  ? buttons.map((button, index) => (
                    <span className="template-detail-chip" key={`${button.type}-${index}`}>
                      {button.type}{button.detail ? `: ${button.detail}` : ''} · {button.label || '—'}
                    </span>
                  ))
                  : '—'}
              </span>
            </div>
            <div className="template-detail-row">
              <span className="template-detail-label">Variables</span>
              <span className="template-detail-value template-detail-chips">
                {variableKeys.length
                  ? variableKeys.map((key) => (
                    <span className="template-detail-chip" key={key}>
                      {`{{${key}}}`}: {sampleValues[key] == null || sampleValues[key] === '' ? '—' : String(sampleValues[key])}
                    </span>
                  ))
                  : '—'}
              </span>
            </div>
            {rejected && template.rejection_reason && (
              <div className="template-preview-reason"><Icon name="alert" size={16} /> <span>{template.rejection_reason}</span></div>
            )}
          </div>
        </div>

        <footer className="template-preview-modal-actions">
          <button type="button" className="button button-sm button-secondary" onClick={onClose}>Close</button>
          {approved && can('messages.send_templates') && hasContacts && (
            <button type="button" className="button button-sm button-secondary" onClick={() => onSend(template)} disabled={busy === `send-${template.id}`}>
              <Icon name="send" size={14} /> Send
            </button>
          )}
          {approved && can('templates.create') && (
            <button type="button" className="button button-sm button-secondary" onClick={() => onRevision(template)} disabled={isBusy}>
              <Icon name="copy" size={14} /> Create revision
            </button>
          )}
          {!approved && can('templates.create') && (
            <>
              {can('templates.submit') && <button type="button" className="button button-sm button-secondary" onClick={() => onSubmit(template)} disabled={busy === `submit-${template.id}`}>
                Submit to Meta
              </button>}
              {can('templates.update') && <button type="button" className="button button-sm button-ghost" onClick={() => onEdit(template)} disabled={isBusy}>
                <Icon name="edit" size={14} /> Edit
              </button>}
            </>
          )}
          {can('templates.delete') && (
            <button type="button" className="button button-sm button-ghost is-danger" onClick={() => onDelete(template)} disabled={busy === `delete-${template.id}`}>
              <Icon name="trash" size={14} /> Delete
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
