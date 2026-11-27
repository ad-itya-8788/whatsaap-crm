import { useEffect, useState } from 'react'
import Icon from '../common/Icon.jsx'

export default function MediaViewer({ items = [], index = 0, onIndexChange, onClose }) {
  const item = items[index]
  const [zoom, setZoom] = useState(1)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setZoom(1)
    setFailed(false)
  }, [item?.id])

  useEffect(() => {
    if (!item) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight' && index < items.length - 1) onIndexChange(index + 1)
      if (event.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [item, index, items.length, onClose, onIndexChange])

  if (!item) return null

  const previewableDocument = item.type === 'document'
    && (String(item.mime || '').includes('pdf') || String(item.mime || '').startsWith('text/'))

  return (
    <div className="modal-backdrop media-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="media-viewer" role="dialog" aria-modal="true" aria-label="Media viewer">
        <header className="media-viewer-head">
          <div className="media-viewer-title">
            <strong>{item.name || 'Attachment'}</strong>
            {items.length > 1 && <span>{index + 1} of {items.length}</span>}
          </div>
          <div className="media-viewer-tools">
            {item.type === 'image' && (
              <>
                <button type="button" className="icon-button" onClick={() => setZoom((value) => Math.max(1, value - .25))} aria-label="Zoom out" title="Zoom out"><Icon name="zoomOut" size={18} /></button>
                <span className="media-zoom">{Math.round(zoom * 100)}%</span>
                <button type="button" className="icon-button" onClick={() => setZoom((value) => Math.min(3, value + .25))} aria-label="Zoom in" title="Zoom in"><Icon name="zoomIn" size={18} /></button>
                <button type="button" className="icon-button" onClick={() => setZoom(1)} aria-label="Fit to screen" title="Fit to screen"><Icon name="fit" size={18} /></button>
              </>
            )}
            <a className="icon-button" href={item.src} download={item.name || 'attachment'} aria-label="Download" title="Download"><Icon name="download" size={18} /></a>
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close viewer" title="Close viewer"><Icon name="close" size={18} /></button>
          </div>
        </header>
        <div className="media-viewer-body">
          {failed ? (
            <div className="media-viewer-error">
              <Icon name="alert" size={28} />
              <p>This attachment could not be loaded. It may have expired or the link is no longer available.</p>
            </div>
          ) : (
            <>
              {item.type === 'image' && (
                <img
                  src={item.src}
                  alt={item.name || 'Image attachment'}
                  className="media-viewer-image"
                  style={{ transform: `scale(${zoom})` }}
                  onError={() => setFailed(true)}
                />
              )}
              {item.type === 'video' && (
                <video className="media-viewer-video" src={item.src} controls autoPlay onError={() => setFailed(true)} />
              )}
              {item.type === 'audio' && (
                <div className="media-viewer-audio"><audio src={item.src} controls autoPlay onError={() => setFailed(true)} /><span>{item.name || 'Audio'}</span></div>
              )}
              {previewableDocument && (
                <iframe className="media-viewer-frame" src={item.src} title={item.name || 'Document preview'} onError={() => setFailed(true)} />
              )}
              {item.type === 'document' && !previewableDocument && (
                <div className="media-viewer-error">
                  <Icon name="file" size={28} />
                  <p>This file type cannot be previewed in the browser. Use download to open it locally.</p>
                </div>
              )}
            </>
          )}
        </div>
        {items.length > 1 && (
          <footer className="media-viewer-foot">
            <button type="button" className="button button-sm button-secondary" onClick={() => onIndexChange(index - 1)} disabled={index === 0}><Icon name="back" size={14} /> Previous</button>
            <span>{index + 1} / {items.length}</span>
            <button type="button" className="button button-sm button-secondary" onClick={() => onIndexChange(index + 1)} disabled={index === items.length - 1}>Next <Icon name="back" size={14} className="flip-icon" /></button>
          </footer>
        )}
      </div>
    </div>
  )
}
