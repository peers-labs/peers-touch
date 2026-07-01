import { createElement, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AppletHostDeviceRequest,
  AppletHostNavigationRequest,
  AppletHostUiRequest,
  LynxHostElement as LynxHostElementType,
} from './lynx-host-element'
import type { LynxDebugEvent } from './LynxDebugPanel'

interface LynxHostProps {
  appletId: string
  sessionId: string
  url: string
  style?: React.CSSProperties
  onLoad?: () => void
  onReady?: () => void
  onError?: (error: Error) => void
  onDebugEvent?: (event: LynxDebugEvent) => void
  onNavigationRequest?: (request: AppletHostNavigationRequest) => void
  onUiRequest?: (request: AppletHostUiRequest) => unknown | Promise<unknown>
  onDeviceRequest?: (request: AppletHostDeviceRequest) => unknown | Promise<unknown>
}

/**
 * React wrapper for the <lynx-host> Custom Element.
 * Sets attributes imperatively via ref (React does not natively handle CE properties).
 */
const LynxHost: React.FC<LynxHostProps> = ({
  appletId,
  sessionId,
  url,
  style,
  onLoad,
  onReady,
  onError,
  onDebugEvent,
  onNavigationRequest,
  onUiRequest,
  onDeviceRequest,
}) => {
  const { t } = useTranslation('applet')
  const hostRef = useRef<LynxHostElementType | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    host.navigationHandler = onNavigationRequest
    host.uiHandler = onUiRequest
    host.deviceHandler = onDeviceRequest
    host.setAttribute('applet-id', appletId)
    host.setAttribute('session-id', sessionId)
    host.setAttribute('url', url)

    const handleLoad = () => onLoad?.()
    const handleReady = () => onReady?.()
    const handleError = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail
      onError?.(new Error(detail?.message || t('applet.runtime.hostLoadFailed', { id: appletId })))
    }
    const handleNavigation = (event: Event) => {
      const detail = (event as CustomEvent<AppletHostNavigationRequest>).detail
      if (detail) onNavigationRequest?.(detail)
    }
    const handleUi = (event: Event) => {
      const detail = (event as CustomEvent<AppletHostUiRequest>).detail
      if (detail) void onUiRequest?.(detail)
    }
    const handleDevice = (event: Event) => {
      const detail = (event as CustomEvent<AppletHostDeviceRequest>).detail
      if (detail) void onDeviceRequest?.(detail)
    }
    const handleDebug = (event: Event) => {
      const detail = (event as CustomEvent<LynxDebugEvent>).detail
      if (detail) onDebugEvent?.(detail)
    }

    host.addEventListener('load', handleLoad)
    host.addEventListener('ready', handleReady)
    host.addEventListener('error', handleError)
    host.addEventListener('applet-navigation', handleNavigation)
    host.addEventListener('applet-ui', handleUi)
    host.addEventListener('applet-device', handleDevice)
    host.addEventListener('applet-debug', handleDebug)
    return () => {
      if (host.navigationHandler === onNavigationRequest) {
        host.navigationHandler = undefined
      }
      if (host.uiHandler === onUiRequest) {
        host.uiHandler = undefined
      }
      if (host.deviceHandler === onDeviceRequest) {
        host.deviceHandler = undefined
      }
      host.removeEventListener('load', handleLoad)
      host.removeEventListener('ready', handleReady)
      host.removeEventListener('error', handleError)
      host.removeEventListener('applet-navigation', handleNavigation)
      host.removeEventListener('applet-ui', handleUi)
      host.removeEventListener('applet-device', handleDevice)
      host.removeEventListener('applet-debug', handleDebug)
    }
  }, [appletId, sessionId, url, onLoad, onReady, onError, onDebugEvent, onNavigationRequest, onUiRequest, onDeviceRequest, t])

  return createElement('lynx-host', { ref: hostRef, style })
}

export default LynxHost
