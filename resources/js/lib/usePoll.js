import { useEffect } from 'react'

export function usePoll(load, interval, { enabled = true, event } = {}) {
  useEffect(() => {
    if (!enabled) return

    const controller = new AbortController()
    let running = false
    let refreshQueued = false
    const refresh = async () => {
      if (controller.signal.aborted || document.hidden) return
      if (running) {
        refreshQueued = true
        return
      }

      running = true
      try {
        await load(controller.signal)
      } catch {
        // Keep the last successful result until the next refresh.
      } finally {
        running = false
        if (refreshQueued) {
          refreshQueued = false
          void refresh()
        }
      }
    }
    const initial = window.setTimeout(refresh, 0)
    const timer = window.setInterval(() => {
      if (!running) void refresh()
    }, interval)
    document.addEventListener('visibilitychange', refresh)
    if (event) window.addEventListener(event, refresh)

    return () => {
      controller.abort()
      window.clearTimeout(initial)
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      if (event) window.removeEventListener(event, refresh)
    }
  }, [load, interval, enabled, event])
}
