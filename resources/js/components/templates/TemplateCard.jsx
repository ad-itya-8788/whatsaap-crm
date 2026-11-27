import { useEffect, useRef, useState } from 'react'
import Icon from '../common/Icon.jsx'
import { relativeTime } from '../../lib/utils.js'
import TemplatePreview from './TemplatePreview.jsx'

export default function TemplateCard({
  template,
  statusLabel,
  statusTone,
  canManage,
  hasContacts,
  busy,
  isEditing,
  onPreview,
  onSend,
  onRevision,
  onSubmit,
  onEdit,
  onDelete,
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  const status = String(template?.approval_status || template?.status || 'PENDING').toUpperCase()
  const approved = status === 'APPROVED'
  const isBusy = Boolean(busy)

  useEffect(() => {
    if (!menuOpen) return undefined

    const onMouseDown = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }

    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const act = (action) => {
    setMenuOpen(false)
    action()
  }

  return (
    <article className={`template-card${isEditing ? ' is-editing' : ''}`}>
      <header className="template-card-head">
        <div className="template-card-title">
          <h3 className="template-name" title={template.name}>{template.name}</h3>
        </div>
        <div className="template-card-menu-wrap" ref={menuRef}>
          <span className={`badge badge-${statusTone}`}>{statusLabel}</span>
          <button
            type="button"
            className="icon-button icon-button-sm"
            aria-label={`Actions for ${template.name}`} title={`Actions for ${template.name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((current) => !current)}
          >
            <Icon name="more" size={16} />
          </button>
          {menuOpen && (
            <div className="template-card-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => act(() => onPreview(template))}>
                <Icon name="eye" size={14} /> Preview
              </button>
              {canManage && approved && (
                <button type="button" role="menuitem" disabled={isBusy} onClick={() => act(() => onRevision(template))}>
                  <Icon name="copy" size={14} /> Create revision
                </button>
              )}
              {canManage && !approved && (
                <>
                  <button type="button" role="menuitem" disabled={busy === `submit-${template.id}`} onClick={() => act(() => onSubmit(template))}>
                    <Icon name="send" size={14} /> Submit to Meta
                  </button>
                  <button type="button" role="menuitem" disabled={isBusy} onClick={() => act(() => onEdit(template))}>
                    <Icon name="edit" size={14} /> Edit
                  </button>
                </>
              )}
              {canManage && (
                <button
                  type="button"
                  role="menuitem"
                  className="is-danger"
                  disabled={busy === `delete-${template.id}`}
                  onClick={() => act(() => onDelete(template))}
                >
                  <Icon name="trash" size={14} /> Delete
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="template-card-meta">
        <span className="template-meta-item"><Icon name="tag" size={13} /> {template.category || 'UTILITY'}</span>
        <span className="template-meta-item"><Icon name="users" size={13} /> {template.language || 'en_US'}</span>
        {template.quality_score && (
          <span className="template-meta-item"><Icon name="chart" size={13} /> Quality {String(template.quality_score).toLowerCase()}</span>
        )}
        <span className="template-meta-item"><Icon name="clock" size={13} /> Updated {relativeTime(template.updated_at || template.last_synced_at) || 'recently'}</span>
      </div>

      <div className="template-card-preview">
        <TemplatePreview template={template} compact />
      </div>

      {(status === 'REJECTED' || status === 'DISAPPROVED') && template.rejection_reason && (
        <p className="rejection-reason"><Icon name="alert" size={14} /> <span>{template.rejection_reason}</span></p>
      )}

      <footer className="template-actions">
        <div className="template-actions-primary">
          {approved && canManage && hasContacts && (
            <button type="button" className="button button-sm button-secondary" onClick={() => onSend(template)} disabled={busy === `send-${template.id}`}>
              <Icon name="send" size={14} /> Send
            </button>
          )}
          {!approved && canManage && (
            <>
              <button type="button" className="button button-sm button-secondary" onClick={() => onSubmit(template)} disabled={busy === `submit-${template.id}`}>
                Submit to Meta
              </button>
              <button type="button" className="button button-sm button-ghost" onClick={() => onEdit(template)} disabled={isBusy}>
                <Icon name="edit" size={14} /> Edit
              </button>
            </>
          )}
        </div>
        <div className="template-actions-secondary">
          <button type="button" className="button button-sm button-ghost" onClick={() => onPreview(template)}>
            <Icon name="eye" size={14} /> Preview
          </button>
        </div>
      </footer>
    </article>
  )
}
