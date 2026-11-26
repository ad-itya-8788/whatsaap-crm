import { useSyncExternalStore } from 'react'

const appearanceChanged = 'wacrm:theme-changed'

function subscribe(callback) {
  window.addEventListener(appearanceChanged, callback)
  return () => window.removeEventListener(appearanceChanged, callback)
}

const getMode = () => document.documentElement.dataset.mode || 'dark'
const getTheme = () => document.documentElement.dataset.theme || 'emerald'

export function useColorMode() {
  return useSyncExternalStore(subscribe, getMode)
}

export function useAccentTheme() {
  return useSyncExternalStore(subscribe, getTheme)
}

export function changeAppearance(preferences) {
  for (const [key, value] of Object.entries(preferences)) {
    document.documentElement.dataset[key] = value
    try {
      localStorage.setItem(`wacrm.${key}`, value)
    } catch {
      // Keep the current page switchable when browser storage is unavailable.
    }
  }
  window.dispatchEvent(new Event(appearanceChanged))
}
