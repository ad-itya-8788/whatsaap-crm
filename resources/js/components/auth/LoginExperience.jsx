import BrandLogo from '../common/BrandLogo.jsx'
import DeveloperAttribution from '../common/DeveloperAttribution.jsx'
import Icon from '../common/Icon.jsx'
import { useBranding } from '../../lib/branding.js'

const features = [
  { icon: 'inbox', label: 'Team inbox', hint: 'Shared customer conversations' },
  { icon: 'radio', label: 'Broadcasts', hint: 'Reach customers at scale' },
  { icon: 'bot', label: 'AI replies', hint: 'Respond faster, every time' },
]

export default function LoginExperience({ title, subtitle, children, footer }) {
  const brand = useBranding()

  return (
    <main className="ping-login-page">
      <div className="ping-login-orb ping-login-orb-one" aria-hidden="true" />
      <div className="ping-login-orb ping-login-orb-two" aria-hidden="true" />
      <div className="ping-login-orb ping-login-orb-three" aria-hidden="true" />

      <header className="ping-login-header">
        <div className="ping-login-brand">
          <div className="ping-login-logo-wrap">
            <BrandLogo className="ping-login-logo" />
          </div>
          <span className="ping-login-brand-divider" aria-hidden="true" />
          <span className="ping-login-tagline">{brand.tagline}</span>
        </div>
      </header>

      <div className="ping-login-main">
        <section className="ping-login-hero" aria-label={`About ${brand.name}`}>
          <p className="ping-login-eyebrow"><span className="ping-login-pulse" aria-hidden="true" /> WhatsApp Messenger for Business</p>
          <h1 className="ping-login-title">Every business conversation, in one place.</h1>
          <p className="ping-login-copy">Manage your WhatsApp inbox, campaigns, contacts, and AI-assisted replies from one focused workspace built for modern teams.</p>

          <div className="ping-login-feature-grid">
            {features.map((feature) => (
              <div className="ping-login-feature" key={feature.label}>
                <span className="ping-login-feature-icon"><Icon name={feature.icon} size={17} /></span>
                <strong>{feature.label}</strong>
                <span>{feature.hint}</span>
              </div>
            ))}
          </div>

          <div className="ping-preview" aria-hidden="true">
            <div className="ping-preview-top">
              <div className="ping-preview-window-dots">
                <span className="ping-preview-dot" />
                <span className="ping-preview-dot" />
                <span className="ping-preview-dot" />
              </div>
              <span className="ping-preview-title">{brand.name} · Inbox</span>
              <span className="ping-preview-status"><Icon name="checkCircle" size={12} /> Connected</span>
            </div>
            <div className="ping-preview-body">
              <div className="ping-preview-sidebar">
                <div className="ping-preview-search"><Icon name="search" size={12} /> Search conversations</div>
                <div className="ping-preview-chat is-selected">
                  <span className="ping-preview-avatar">SM</span>
                  <span className="ping-preview-chat-copy"><strong>Studio Motors</strong><span>Is my order ready?</span></span>
                  <small>2m</small>
                </div>
                <div className="ping-preview-chat">
                  <span className="ping-preview-avatar is-yellow">AS</span>
                  <span className="ping-preview-chat-copy"><strong>Acme Supplies</strong><span>Thank you!</span></span>
                  <small>18m</small>
                </div>
                <div className="ping-preview-chat">
                  <span className="ping-preview-avatar">NB</span>
                  <span className="ping-preview-chat-copy"><strong>North Bookings</strong><span>Confirming today</span></span>
                  <small>1h</small>
                </div>
              </div>
              <div className="ping-preview-thread">
                <div className="ping-preview-thread-head">
                  <span className="ping-preview-avatar">SM</span>
                  <span className="ping-preview-thread-user"><strong>Studio Motors</strong><small>Active now</small></span>
                  <Icon name="moreVertical" size={14} />
                </div>
                <div className="ping-preview-messages">
                  <div className="ping-preview-message is-incoming">Hi, is my order ready for pickup?</div>
                  <div className="ping-preview-message is-outgoing">Yes! It is packed and ready. We will share the pickup details shortly.</div>
                  <div className="ping-preview-message is-ai"><Icon name="bot" size={13} /> AI reply suggested</div>
                </div>
                <div className="ping-preview-composer"><span>Type a message</span><Icon name="send" size={14} /></div>
              </div>
            </div>
            <div className="ping-preview-badge ping-preview-badge-green"><Icon name="checks" size={13} /> Delivery confirmed</div>
            <div className="ping-preview-badge ping-preview-badge-yellow"><Icon name="zap" size={13} /> AI reply ready</div>
          </div>
        </section>

        <section className="ping-login-panel-wrap" aria-labelledby="ping-login-card-title">
          <div className="ping-login-panel">
            <div className="ping-login-panel-head">
              <span className="ping-login-panel-icon"><Icon name="shield" size={20} /></span>
              <div>
                <h2 id="ping-login-card-title">{title}</h2>
                {subtitle && <p className="ping-login-panel-subtitle">{subtitle}</p>}
              </div>
            </div>
            {children}
            {footer && <div className="ping-login-panel-footer">{footer}</div>}
            <DeveloperAttribution className="ping-login-attribution" />
          </div>
        </section>
      </div>

      <footer className="ping-login-page-footer">
        <span>© {new Date().getFullYear()} {brand.developer.name}. All rights reserved.</span>
        <span>{brand.name}</span>
      </footer>
    </main>
  )
}
