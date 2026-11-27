import { useBranding } from '../../lib/branding.js'

export default function DeveloperAttribution({ className = '', compact = false }) {
  const { developer } = useBranding()

  return (
    <div className={`developer-attribution${compact ? ' is-compact' : ''} ${className}`.trim()}>
      <span>Designed &amp; Developed by <a href={developer.url} target="_blank" rel="noopener noreferrer">{developer.name}</a></span>
      <span className="developer-attribution-separator" aria-hidden="true">·</span>
      <a href={developer.url} target="_blank" rel="noopener noreferrer">{developer.label}</a>
    </div>
  )
}
