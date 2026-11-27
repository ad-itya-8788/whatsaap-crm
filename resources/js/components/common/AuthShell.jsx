import BrandLogo from './BrandLogo.jsx'
import DeveloperAttribution from './DeveloperAttribution.jsx'
import Icon from './Icon.jsx'
import { useBranding } from '../../lib/branding.js'

export default function AuthShell({ title, subtitle, children, footer, icon = 'shield' }) {
  const brand = useBranding()

  return (
    <main className="auth-wrap">
      <div className="auth-frame">
        <aside className="auth-visual" aria-label={`${brand.name} messaging and broadcasts`}>
          <BrandLogo className="auth-logo" />
          <div className="auth-art" aria-hidden="true">
            <div className="auth-orbit auth-orbit-outer" />
            <div className="auth-orbit auth-orbit-inner" />
            <span className="auth-signal auth-signal-one" />
            <span className="auth-signal auth-signal-two" />
            <div className="auth-art-core"><Icon name="chat" size={50} /></div>
            <div className="auth-art-node auth-art-inbox"><Icon name="chat" size={18} /><span>Messaging</span></div>
            <div className="auth-art-node auth-art-broadcast"><Icon name="radio" size={19} /><span>Broadcasts</span></div>
            <div className="auth-art-node auth-art-send"><Icon name="send" size={20} /></div>
          </div>
          <div className="auth-visual-copy">
            <p>WhatsApp conversations<br />and campaigns</p>
            <span>Keep every customer conversation and campaign in one workspace.</span>
          </div>
        </aside>
        <section className="auth-card" aria-labelledby="auth-title">
          <div className="auth-mobile-brand"><BrandLogo className="auth-logo" variant="vertical" /></div>
          <div className="auth-form-icon" aria-hidden="true"><Icon name={icon} size={22} /></div>
          <h1 className="auth-title" id="auth-title">{title}</h1>
          {subtitle && <p className="auth-subtitle">{subtitle}</p>}
          {children}
          {footer && <div className="auth-footer">{footer}</div>}
          <div className="auth-attribution"><DeveloperAttribution /></div>
        </section>
      </div>
    </main>
  )
}
