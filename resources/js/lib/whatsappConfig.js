import { useCallback, useEffect, useState } from 'react'
import api from '../api/client.js'
import { usePoll } from './usePoll.js'

let snapshot = { data: null, error: null, loading: false }
let inFlight = null
let generation = 0
const listeners = new Set()

function notify() {
  listeners.forEach((listener) => listener(snapshot))
}

export function getWhatsappConfigSnapshot() {
  return snapshot
}

export function subscribeWhatsappConfig(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function clearWhatsappConfig() {
  generation += 1
  inFlight = null
  snapshot = { data: null, error: null, loading: false }
  notify()
}

export async function loadWhatsappConfig({ force = false, signal } = {}) {
  if (snapshot.data && !force) return snapshot.data
  if (inFlight) return inFlight

  snapshot = { ...snapshot, loading: true }
  notify()

  const requestedGeneration = generation
  inFlight = api.get('/api/app/whatsapp/config', { signal, timeout: 10000 })
    .then(({ data }) => {
      if (signal?.aborted || requestedGeneration !== generation) return snapshot.data
      snapshot = { data, error: null, loading: false }
      notify()
      return data
    })
    .catch((error) => {
      if (signal?.aborted || requestedGeneration !== generation) return snapshot.data
      snapshot = { ...snapshot, error, loading: false }
      notify()
      return snapshot.data
    })
    .finally(() => {
      if (requestedGeneration === generation) inFlight = null
    })

  return inFlight
}

export function useWhatsappConfig({ enabled = true, interval = 120_000 } = {}) {
  const [state, setState] = useState(snapshot)

  useEffect(() => subscribeWhatsappConfig(setState), [])

  const refresh = useCallback((signal) => loadWhatsappConfig({ force: true, signal }), [])
  usePoll(refresh, interval, { enabled, event: 'wacrm:whatsapp-changed' })

  return state
}
