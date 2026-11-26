export default function InteractivePreview({ payload }) {
  if (!payload || typeof payload !== 'object') return null

  const body = String(payload.body || payload.content_text || '')
  const isList = payload.kind === 'list' || Array.isArray(payload.sections)

  return (
    <div className="interactive-preview">
      {payload.header ? <div className="interactive-preview-header">{payload.header}</div> : null}
      <div className="interactive-preview-body">{body}</div>
      {payload.footer ? <div className="interactive-preview-footer">{payload.footer}</div> : null}
      {isList ? (
        <div className="interactive-preview-button">{payload.button_label || 'View options'}</div>
      ) : (
        <div className="interactive-preview-buttons">
          {(payload.buttons || []).map((button, index) => (
            <span key={`${button.id || index}-${index}`}>{button.title || button.id}</span>
          ))}
        </div>
      )}
    </div>
  )
}
