import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Collapse, Spin, Typography, theme } from 'antd'
import { RefreshCw, RotateCcw } from 'lucide-react'
import AppletManager from './AppletManager'
import LynxHost from './LynxHost'
import type { AppletHostDeviceRequest, AppletHostNavigationRequest, AppletHostUiRequest } from './lynx-host-element'
import { createLynxDebugEvent, type LynxDebugEvent } from './LynxDebugPanel'
import type { AppletInfo } from './types'

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
const { Text } = Typography

/**
 * Renders an applet session owned by the applets runtime via <lynx-host>.
 * The container consumes the current manager session; it does not load or
 * unload applet runtime resources.
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
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [appletInfo, setAppletInfo] = useState<AppletInfo | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const loadNotifiedRef = useRef(false)
  const appletManager = AppletManager.getInstance()

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

  useEffect(() => {
    try {
      setLoading(true)
      setReady(false)
      setTimedOut(false)
      setError(null)
      loadNotifiedRef.current = false
      reportDebug('container.resolve.start', { data: { retryKey } })

      const info = appletManager.getAppletInfo(appletId)
      if (!info) {
        throw new Error(t('applet.runtime.registryNotFound', { id: appletId }))
      }
      if (!info.load.desktop) {
        throw new Error(t('applet.runtime.noDesktopLoad', { id: appletId }))
      }

      const currentSessionId = appletManager.getSessionId(appletId)
      if (!currentSessionId) {
        throw new Error(t('applet.runtime.sessionCreateFailed', { id: appletId }))
      }
      reportDebug('container.session.resolved', {
        data: {
          entry: info.load.desktop.entry,
          path: info.path,
        },
        sessionId: currentSessionId,
      })
      setAppletInfo(info)
      setSessionId(currentSessionId)
      setLoading(false)
    } catch (err) {
      const loadError = err instanceof Error ? err : new Error(t('applet.runtime.loadFailedFallback'))
      reportDebug('container.resolve.error', { data: { error: loadError.message }, level: 'error' })
      setError(loadError)
      onError?.(loadError)
      setLoading(false)
    }

    return () => {
      setSessionId(null)
    }
  }, [appletId, appletManager, onError, reportDebug, retryKey, t])

  useEffect(() => {
    if (loading || error || ready || !sessionId) return undefined

    const timer = window.setTimeout(() => {
      setReady(true)
      setTimedOut(false)
      reportDebug('container.hostRenderFallback.ready', { sessionId })
      notifyLoaded('host-render-fallback')
    }, APPLET_HOST_RENDER_FALLBACK_MS)

    return () => window.clearTimeout(timer)
  }, [error, loading, notifyLoaded, ready, reportDebug, sessionId])

  useEffect(() => {
    if (loading || error || ready || !sessionId) return undefined

    const timer = window.setTimeout(() => {
      setTimedOut(true)
      reportDebug('container.ready.timeout', { level: 'warn', sessionId })
    }, APPLET_READY_TIMEOUT_MS)

    return () => window.clearTimeout(timer)
  }, [error, loading, ready, reportDebug, sessionId])

  useEffect(() => {
    const desktopLoad = appletInfo?.load.desktop
    if (!desktopLoad || !sessionId) return
    reportDebug('container.bundle.resolved', {
      data: { bundleUrl: `${appletInfo.path}/${desktopLoad.entry}` },
      sessionId,
    })
  }, [appletInfo, reportDebug, sessionId])

  const retry = () => {
    setRetryKey((current) => current + 1)
  }

  if (loading) {
    return (
      <div
        style={{
          width,
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 18,
          background: token.colorBgContainer,
        }}
      >
        <Spin size="large" description={t('applet.runtime.loading')} />
      </div>
    )
  }

  if (error || !appletInfo || !sessionId) {
    return (
      <AppletDisplayFallback
        width={width}
        height={height}
        title={t('applet.runtime.unableToDisplay')}
        description={t('applet.runtime.loadFailedDescription')}
        detail={error?.message || t('applet.runtime.unknownError')}
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

  const desktopLoad = appletInfo.load.desktop
  if (!desktopLoad) {
    return (
      <AppletDisplayFallback
        width={width}
        height={height}
        title={t('applet.runtime.unsupportedPlatform')}
        description={t('applet.runtime.noDesktopLoad', { id: appletId })}
        onRetry={retry}
        onBack={onBack}
      />
    )
  }

  const bundleUrl = `${appletInfo.path}/${desktopLoad.entry}`

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
      <LynxHost
        key={retryKey}
        appletId={appletId}
        sessionId={sessionId}
        url={bundleUrl}
        style={{
          width: '100%',
          height: '100%',
          opacity: ready ? 1 : 0,
          transition: 'opacity 0.2s ease',
        }}
        onReady={() => {
          setReady(true)
          setTimedOut(false)
          reportDebug('container.ready.received', { sessionId })
          notifyLoaded('lifecycle.reportReady')
        }}
        onError={(hostError) => {
          reportDebug('container.host.error', { data: { error: hostError.message }, level: 'error', sessionId })
          setError(hostError)
          onError?.(hostError)
        }}
        onDebugEvent={onDebugEvent}
        onNavigationRequest={onNavigationRequest}
        onUiRequest={onUiRequest}
        onDeviceRequest={onDeviceRequest}
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
