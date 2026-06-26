import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Card, Collapse, Result, Spin, theme } from 'antd'
import { RefreshCw, RotateCcw } from 'lucide-react'
import AppletManager from './AppletManager'
import LynxHost from './LynxHost'
import type { AppletHostDeviceRequest, AppletHostNavigationRequest, AppletHostUiRequest } from './lynx-host-element'
import type { AppletInfo } from './types'

interface LynxContainerProps {
  appletId: string
  width?: number | string
  height?: number | string
  onLoad?: (readySource: string) => void
  onError?: (error: Error) => void
  onNavigationRequest?: (request: AppletHostNavigationRequest) => void
  onUiRequest?: (request: AppletHostUiRequest) => unknown | Promise<unknown>
  onDeviceRequest?: (request: AppletHostDeviceRequest) => unknown | Promise<unknown>
  onBack?: () => void
}

const APPLET_READY_TIMEOUT_MS = 8000
const APPLET_HOST_RENDER_FALLBACK_MS = 2500

/**
 * High-level container that loads an applet by ID and renders it via <lynx-host>.
 * Resolves the bundle URL from the platform-specific load config in the manifest.
 */
const LynxContainer: React.FC<LynxContainerProps> = ({
  appletId,
  width = '100%',
  height = '600px',
  onLoad,
  onError,
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

  const notifyLoaded = useCallback((readySource: string) => {
    if (loadNotifiedRef.current) return
    loadNotifiedRef.current = true
    onLoad?.(readySource)
  }, [onLoad])

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        setReady(false)
        setTimedOut(false)
        setError(null)
        loadNotifiedRef.current = false

        const info = appletManager.getAppletInfo(appletId)
        if (!info) {
          throw new Error(t('applet.runtime.registryNotFound', { id: appletId }))
        }
        if (!info.load.desktop) {
          throw new Error(t('applet.runtime.noDesktopLoad', { id: appletId }))
        }

        await appletManager.loadApplet(appletId)
        const createdSessionId = appletManager.getSessionId(appletId)
        if (!createdSessionId) {
          throw new Error(t('applet.runtime.sessionCreateFailed', { id: appletId }))
        }
        setAppletInfo(info)
        setSessionId(createdSessionId)
        setLoading(false)
      } catch (err) {
        const loadError = err instanceof Error ? err : new Error(t('applet.runtime.loadFailedFallback'))
        setError(loadError)
        onError?.(loadError)
        setLoading(false)
      }
    }

    load()
    return () => {
      void appletManager.unloadApplet(appletId)
      setSessionId(null)
    }
  }, [appletId, appletManager, onError, retryKey, t])

  useEffect(() => {
    if (loading || error || ready || !sessionId) return undefined

    const timer = window.setTimeout(() => {
      setReady(true)
      setTimedOut(false)
      notifyLoaded('host-render-fallback')
    }, APPLET_HOST_RENDER_FALLBACK_MS)

    return () => window.clearTimeout(timer)
  }, [error, loading, notifyLoaded, ready, sessionId])

  useEffect(() => {
    if (loading || error || ready || !sessionId) return undefined

    const timer = window.setTimeout(() => {
      setTimedOut(true)
    }, APPLET_READY_TIMEOUT_MS)

    return () => window.clearTimeout(timer)
  }, [error, loading, ready, sessionId])

  const retry = () => {
    setRetryKey((current) => current + 1)
  }

  if (loading) {
    return (
      <Card style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" tip={t('applet.runtime.loading')} />
      </Card>
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
          <Spin size="large" tip={t('applet.runtime.loading')} />
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
          notifyLoaded('lifecycle.reportReady')
        }}
        onError={(hostError) => {
          setError(hostError)
          onError?.(hostError)
        }}
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

  return (
    <Card
      style={{
        width,
        height,
        borderRadius: 18,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      styles={{ body: { width: '100%' } }}
    >
      <Result
        status="warning"
        title={title}
        subTitle={description}
        extra={[
          <Button key="retry" type="primary" icon={<RefreshCw size={14} />} onClick={onRetry}>
            {t('applet.runtime.retry')}
          </Button>,
          onBack ? (
            <Button key="back" icon={<RotateCcw size={14} />} onClick={onBack}>
              {t('applet.runtime.backToHome')}
            </Button>
          ) : null,
        ].filter(Boolean)}
      >
        {detail && (
          <Collapse
            ghost
            items={[{
              key: 'detail',
              label: t('applet.runtime.errorDetail'),
              children: <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{detail}</pre>,
            }]}
          />
        )}
      </Result>
    </Card>
  )
}

export default LynxContainer
