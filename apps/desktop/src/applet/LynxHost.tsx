import { createElement, useEffect, useRef } from 'react'
import type { LynxHostElement as LynxHostElementType } from './lynx-host-element'

interface LynxHostProps {
  appletId: string
  url: string
  style?: React.CSSProperties
  onLoad?: () => void
  onError?: (error: Error) => void
}

/**
 * React wrapper for the <lynx-host> Custom Element.
 * Sets attributes imperatively via ref (React does not natively handle CE properties).
 */
const LynxHost: React.FC<LynxHostProps> = ({ appletId, url, style, onLoad, onError }) => {
  const hostRef = useRef<LynxHostElementType | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    host.setAttribute('applet-id', appletId)
    host.setAttribute('url', url)

    const handleLoad = () => onLoad?.()
    const handleError = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail
      onError?.(new Error(detail?.message || `Failed to load applet ${appletId}`))
    }

    host.addEventListener('load', handleLoad)
    host.addEventListener('error', handleError)
    return () => {
      host.removeEventListener('load', handleLoad)
      host.removeEventListener('error', handleError)
    }
  }, [appletId, url, onLoad, onError])

  return createElement('lynx-host', { ref: hostRef, style })
}

export default LynxHost
