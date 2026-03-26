import { createElement, useEffect, useRef } from 'react'

interface LynxHostProps {
  appletId: string
  src: string
  title?: string
  style?: React.CSSProperties
  onLoad?: () => void
  onError?: (error: Error) => void
}

type LynxHostElement = HTMLElement & {
  src?: string
  appletId?: string
  title?: string
}

const LynxHost: React.FC<LynxHostProps> = ({
  appletId,
  src,
  title,
  style,
  onLoad,
  onError,
}) => {
  const hostRef = useRef<LynxHostElement | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }

    host.setAttribute('src', src)
    host.setAttribute('applet-id', appletId)
    host.setAttribute('title', title || appletId)
    host.src = src
    host.appletId = appletId
    host.title = title || appletId

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
  }, [appletId, onError, onLoad, src, title])

  return createElement('lynx-host', { ref: hostRef, style })
}

export default LynxHost
