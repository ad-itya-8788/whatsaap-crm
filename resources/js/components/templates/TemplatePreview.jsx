import Icon from '../common/Icon.jsx'
import { renderTemplate } from '../../lib/utils.js'

const mediaTypes = ['IMAGE', 'VIDEO', 'DOCUMENT']

export function previewValues(values) {
  if (Array.isArray(values)) {
    return values.reduce((result, value, index) => {
      result[String(index + 1)] = value == null ? '' : String(value)
      return result
    }, {})
  }

  return values && typeof values === 'object' ? values : {}
}

function mediaLabel(name, url, type) {
  if (name) return name
  const last = String(url || '').split('?')[0].split('/').filter(Boolean).pop()
  if (last && last !== 'blob') {
    try {
      return decodeURIComponent(last)
    } catch {
      return last
    }
  }
  return `${type.toLowerCase()} header`
}

export function previewButtons(buttons) {
  const rows = Array.isArray(buttons)
    ? buttons
    : typeof buttons === 'string'
      ? buttons.split('\n')
      : []

  return rows.map((entry) => {
    if (typeof entry === 'string') {
      return { type: 'QUICK_REPLY', label: entry.trim(), detail: '' }
    }

    const type = String(entry?.type || entry?.button_type || 'QUICK_REPLY').toUpperCase()
    const label = String(entry?.text || entry?.title || entry?.label || '').trim()
    const detail = String(type === 'URL'
      ? entry?.url || ''
      : type === 'COPY_CODE'
        ? entry?.example || entry?.coupon_code || ''
        : '').trim()

    return { type, label, detail }
  }).filter((button) => button.label || button.detail).slice(0, 3)
}

export default function TemplatePreview({
  template = {},
  compact = false,
  showChrome = !compact,
  values,
  name,
  category,
  language,
  body,
  header,
  footer,
  buttons,
  headerText,
  mediaType,
  mediaUrl,
  mediaName,
}) {
  const source = template || {}
  const sampleValues = previewValues(values ?? source.sample_values)
  const type = String(mediaType ?? source.header_type ?? '').toUpperCase()
  const headerValue = headerText ?? header ?? source.header_content ?? ''
  const bodyValue = body ?? source.body_text ?? ''
  const footerValue = footer ?? source.footer_text ?? ''
  const resolvedUrl = mediaUrl ?? source.header_media_url ?? ''
  const resolvedName = mediaName ?? source.header_media_name ?? ''
  const buttonItems = previewButtons(buttons ?? source.buttons)
  const previewTitle = [name ?? source.name, category ?? source.category, language ?? source.language].filter(Boolean).join(' · ')

  let headerBlock = null

  if (type === 'TEXT') {
    const text = renderTemplate(headerValue, sampleValues)
    if (text) headerBlock = <div className="preview-header">{text}</div>
  } else if (type === 'IMAGE' && resolvedUrl) {
    headerBlock = <img className="preview-media" src={resolvedUrl} alt="Template image header" />
  } else if (type === 'VIDEO' && resolvedUrl) {
    headerBlock = <video className="preview-media" src={resolvedUrl} controls preload="metadata" />
  } else if (mediaTypes.includes(type)) {
    const icon = type === 'DOCUMENT' ? 'document' : type.toLowerCase()
    headerBlock = (
      <div className="preview-document">
        <Icon name={icon} size={18} />
        <span>{mediaLabel(resolvedName, resolvedUrl, type)}</span>
      </div>
    )
  } else if (type) {
    headerBlock = (
      <div className="preview-document">
        <Icon name="image" size={18} />
        <span>Carousel preview is not available</span>
      </div>
    )
  }

  return (
    <section className={`template-preview-card${compact ? ' is-compact' : ''}`} aria-label="WhatsApp template preview">
      {showChrome && (
        <div className="template-preview-title">
          <div>
            <h3>Live preview</h3>
            {previewTitle && <p>{previewTitle}</p>}
          </div>
          <span className="preview-live"><span /> Live</span>
        </div>
      )}
      <div className="whatsapp-preview">
        <div className="preview-head">
          <span className="preview-whatsapp-icon"><Icon name="whatsapp" size={16} /></span>
          <div><strong>Business account</strong></div>
        </div>
        <div className="preview-body">
          <div className="preview-bubble">
            {headerBlock}
            {bodyValue ? (
              <p>{renderTemplate(bodyValue, sampleValues)}</p>
            ) : (
              <p className="preview-placeholder">Message body appears here.</p>
            )}
            {footerValue && <div className="preview-footer-text">{renderTemplate(footerValue, sampleValues)}</div>}
          </div>
          {!!buttonItems.length && (
            <div className="preview-buttons">
              {buttonItems.map((button, index) => (
                <div className="preview-action" key={`${button.type}-${button.label}-${index}`}>
                  {renderTemplate(button.label || button.type, sampleValues)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
