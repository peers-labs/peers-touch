import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Collapse, Spin, Typography, theme } from 'antd'
import { RefreshCw, RotateCcw } from 'lucide-react'
import { getDesktopAppletAdapter } from './kernel/desktopKernel'
import type { SurfaceHandlers } from './kernel/SurfaceManager'
import type { AppletHostDeviceRequest, AppletHostNavigationRequest, AppletHostUiRequest } from './lynx-host-element'
import { createLynxDebugEvent, type LynxDebugEvent } from './LynxDebugPanel'

interface LynxContainerProps {
  appletId: string
  width?: number | string
  height?: number | string
  onLoad?: (readySource: string) => void
  onError?: (error: Error) => void
  onDebugEvent?: (event: LynxDebugEvent) => void
  onNavigationRequest?: (request: AppletHostNavigationRequest) => void
  onUiRequest?: (request: AppletHostUiRequest) => unknown | Promise<unknown>
  onDeviceRequest?: (request: AppletHostDeviceRequest) => unknown | Promise<unknown>
  onBack?: () => void
}

const APPLET_READY_TIMEOUT_MS = 8000
const APPLET_HOST_RENDER_FALLBACK_MS = 2500
const APPLET_PAGE_PREFIX = 'applet:'
const { Text } = Typography

/**
 * Renders an applet surface owned by the Applet Kernel.
 *
 * Under Kernel-single-authority (§6.1) the `<lynx-host>` element is created and
 * driven imperatively by the {@link SurfaceManager} in response to Kernel surface
 * commands — NOT by React. This container therefore only:
 *   1. Publishes a DOM slot + the page's handler bundle through `bindSlot`, so the
 *      SurfaceManager can attach the host and forward navigation/ui/device/debug
 *      events plus ready/load/error signals.
 *   2. Reflects surface readiness (loading overlay → visible) for the user.
 * It never loads, unloads, mounts, or destroys runtime resources.
 */
const LynxContainer: React.FC<LynxContainerProps> = ({
  appletId,
  width = '100%',
  height = '600px',
  onLoad,
  onError,
  onDebugEvent,
  onNavigationRequest,
  onUiRequest,
  onDeviceRequest,
  onBack,
}) => {
  const { t } = useTranslation('applet')
  const { token } = theme.useToken()
  const [ready, setReady] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const slotRef = useRef<HTMLDivElement | null>(null)
  const loadNotifiedRef = useRef(false)
  const pageId = `${APPLET_PAGE_PREFIX}${appletId}`

  const reportDebug = useCallback((stage: string, options?: {
    data?: Record<string, unknown>
    level?: LynxDebugEvent['level']
    sessionId?: string
  }) => {
    if (!import.meta.env.DEV) return
    onDebugEvent?.(createLynxDebugEvent(appletId, stage, options))
  }, [appletId, onDebugEvent])

  const notifyLoaded = useCallback((readySource: string) => {
    if (loadNotifiedRef.current) return
    loadNotifiedRef.current = true
    onLoad?.(readySource)
  }, [onLoad])

  // The handler bundle the SurfaceManager wires to the host. Recreated when the
  // page callbacks change; `bindSlot` refreshes the live handlers on the record.
  const handlers = useMemo<SurfaceHandlers>(() => ({
    onReady: () => {
      setReady(true)
      setTimedOut(false)
      reportDebug('container.ready.received')
      notifyLoaded('lifecycle.reportReady')
    },
    onError: (hostError) => {
      reportDebug('container.host.error', { data: { error: hostError.message }, level: 'error' })
      setError(hostError)
      onError?.(hostError)
    },
    onDebugEvent,
    navigationHandler: onNavigationRequest,
    uiHandler: onUiRequest,
    deviceHandler: onDeviceRequest,
  }), [notifyLoaded, onDebugEvent, onDeviceRequest, onError, onNavigationRequest, onUiRequest, reportDebug])

  // Publish the slot + handlers to the SurfaceManager for this instance. Because
  // the applet page frame is keepAlive:'forever', this binding outlives hide/
  // detach; the SurfaceManager (re)attaches the host into the slot on show.
  useEffect(() => {
    const slot = slotRef.current
    if (!slot) return undefined
    setReady(false)
    setTimedOut(false)
    setError(null)
    loadNotifiedRef.current = false
    reportDebug('container.slot.bind', { data: { retryKey } })

    const adapter = getDesktopAppletAdapter()
    const target = { appletId, instanceId: pageId }
    adapter.surfaces.bindSlot(target, slot, handlers)

    return () => {
      adapter.surfaces.unbindSlot(target)
    }
  }, [appletId, handlers, pageId, reportDebug, retryKey])

  useEffect(() => {
    if (error || ready) return undefined
    const timer = window.setTimeout(() => {
      setReady(true)
      setTimedOut(false)
      reportDebug('container.hostRenderFallback.ready')
      notifyLoaded('host-render-fallback')
    }, APPLET_HOST_RENDER_FALLBACK_MS)
    return () => window.clearTimeout(timer)
  }, [error, notifyLoaded, ready, reportDebug])

  useEffect(() => {
    if (error || ready) return undefined
    const timer = window.setTimeout(() => {
      setTimedOut(true)
      reportDebug('container.ready.timeout', { level: 'warn' })
    }, APPLET_READY_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [error, ready, reportDebug])

  const retry = () => {
    setRetryKey((current) => current + 1)
    const adapter = getDesktopAppletAdapter()
    void adapter.applySurfaceCommand('show', { appletId, instanceId: pageId })
  }

  if (error) {
    return (
      <AppletDisplayFallback
        width={width}
        height={height}
        title={t('applet.runtime.unableToDisplay')}
        description={t('applet.runtime.loadFailedDescription')}
        detail={error.message || t('applet.runtime.unknownError')}
        onRetry={retry}
        onBack={onBack}
      />
    )
  }

  if (timedOut) {
    return (
      <AppletDisplayFallback
        width={width}
        height={height}
        title={t('applet.runtime.unableToDisplay')}
        description={t('applet.runtime.readyTimeoutDescription')}
        detail={t('applet.runtime.readyTimeoutDetail', { seconds: APPLET_READY_TIMEOUT_MS / 1000 })}
        onRetry={retry}
        onBack={onBack}
      />
    )
  }

  return (
    <div
      style={{
        width,
        height,
        minHeight: 0,
        position: 'relative',
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 18,
        overflow: 'hidden',
        background: token.colorBgContainer,
      }}
    >
      {!ready && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: token.colorBgContainer,
          }}
        >
          <Spin size="large" description={t('applet.runtime.loading')} />
        </div>
      )}
      <div
        ref={slotRef}
        style={{
          width: '100%',
          height: '100%',
          opacity: ready ? 1 : 0,
          transition: 'opacity 0.2s ease',
        }}
      />
    </div>
  )
}

function AppletDisplayFallback({
  width,
  height,
  title,
  description,
  detail,
  onRetry,
  onBack,
}: {
  width: number | string
  height: number | string
  title: string
  description: string
  detail?: string
  onRetry: () => void
  onBack?: () => void
}) {
  const { t } = useTranslation('applet')
  const { token } = theme.useToken()

  return (
    <div
      style={{
        width,
        height,
        minHeight: 360,
        borderRadius: 18,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        padding: 32,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 520,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 18,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 62,
            height: 62,
            borderRadius: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: token.colorWarning,
            background: token.colorWarningBg,
            border: `1px solid ${token.colorWarningBorder}`,
          }}
        >
          <RefreshCw size={26} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Text strong style={{ fontSize: 20, lineHeight: '26px', letterSpacing: -0.4 }}>
            {title}
          </Text>
          <Text type="secondary" style={{ fontSize: 14, lineHeight: '22px' }}>
            {description}
          </Text>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Button type="primary" icon={<RefreshCw size={14} />} onClick={onRetry}>
            {t('applet.runtime.retry')}
          </Button>
          {onBack && (
            <Button icon={<RotateCcw size={14} />} onClick={onBack}>
              {t('applet.runtime.backToHome')}
            </Button>
          )}
        </div>
        {detail && (
          <Collapse
            ghost
            style={{ width: '100%', textAlign: 'left' }}
            items={[{
              key: 'detail',
              label: t('applet.runtime.errorDetail'),
              children: <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{detail}</pre>,
            }]}
          />
        )}
      </div>
    </div>
  )
}

export default LynxContainer
