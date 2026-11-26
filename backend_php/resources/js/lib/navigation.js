import { router, usePage } from '@inertiajs/react'
import { useMemo } from 'react'

export function usePageLocation() {
  const { url } = usePage()
  return useMemo(() => new URL(url, window.location.origin), [url])
}

// Keep local filters and the selected thread in the URL without reloading the page.
export function useSearchParams() {
  const location = usePageLocation()

  function setSearchParams(value, { replace = false } = {}) {
    const next = new URL(location)
    next.search = new URLSearchParams(typeof value === 'function' ? value(next.searchParams) : value)
    if (next.href === location.href) return

    const visit = { url: next.pathname + next.search + next.hash, preserveState: true, preserveScroll: true }
    if (replace) router.replace(visit)
    else router.push(visit)
  }

  return [location.searchParams, setSearchParams]
}
