import { usePage } from '@inertiajs/react'

const fallbackBranding = {
  name: 'Aayojan AI Ping',
  product: 'Ping',
  tagline: 'WhatsApp Messenger for Business',
  logo: '/assets/logo-horizontal.png',
  logoVertical: '/assets/logo-vertical.png',
  icon: '/assets/favicon-32x32.png',
  developer: {
    name: 'Aayojan AI',
    url: 'https://www.aayojanai.com',
    label: 'www.aayojanai.com',
  },
  colors: {
    black: '#050505',
    white: '#FFFFFF',
    yellow: '#FFD23F',
    green: '#25D366',
  },
}

export function mergeBranding(props = {}) {
  const incoming = props?.branding || {}

  return {
    ...fallbackBranding,
    ...incoming,
    developer: { ...fallbackBranding.developer, ...(incoming.developer || {}) },
    colors: { ...fallbackBranding.colors, ...(incoming.colors || {}) },
  }
}

export function useBranding() {
  return mergeBranding(usePage().props || {})
}

export default fallbackBranding
