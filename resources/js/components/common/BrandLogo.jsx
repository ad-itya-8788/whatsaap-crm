import { useBranding } from '../../lib/branding.js'

export default function BrandLogo({ className = '', variant = 'horizontal' }) {
  const brand = useBranding()
  const src = variant === 'vertical' ? brand.logoVertical : brand.logo

  return <img className={`brand-logo ${className}`} src={src} alt={brand.name} />
}
