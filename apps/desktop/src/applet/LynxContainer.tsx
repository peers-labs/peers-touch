import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert } from '@lobehub/ui'
import { Card, Spin } from 'antd'
import AppletManager from './AppletManager'
import LynxHost from './LynxHost'
import type { AppletHostDeviceRequest, AppletHostNavigationRequest, AppletHostUiRequest } from './lynx-host-element'
import type { AppletInfo } from './types'

interface LynxContainerProps {
  appletId: string
  width?: number | string
  height?: number | string
  onLoad?: () => void
  onError?: (error: Error) => void
  onNavigationRequest?: (request: AppletHostNavigationRequest) => void
  onUiRequest?: (request: AppletHostUiRequest) => unknown | Promise<unknown>
  onDeviceRequest?: (request: AppletHostDeviceRequest) => unknown | Promise<unknown>
}

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
}) => {
  const { t } = useTranslation('applet')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [appletInfo, setAppletInfo] = useState<AppletInfo | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const appletManager = AppletManager.getInstance()

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        setError(null)

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
  }, [appletId, appletManager, onError, t])

  if (loading) {
    return (
      <Card style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" description={t('applet.runtime.loading')} />
      </Card>
    )
  }

  if (error || !appletInfo || !sessionId) {
    return (
      <Card style={{ width, height }}>
        <Alert
          message={t('applet.runtime.loadFailed')}
          description={error?.message || t('applet.runtime.unknownError')}
          type="error"
          showIcon
        />
      </Card>
    )
  }

  // Resolve bundle URL from platform-specific load config
  const desktopLoad = appletInfo.load.desktop
  if (!desktopLoad) {
    return (
      <Card style={{ width, height }}>
        <Alert
          message={t('applet.runtime.unsupportedPlatform')}
          description={t('applet.runtime.noDesktopLoad', { id: appletId })}
          type="warning"
          showIcon
        />
      </Card>
    )
  }

  const bundleUrl = `${appletInfo.path}/${desktopLoad.entry}`

  return (
    <LynxHost
      appletId={appletId}
      sessionId={sessionId}
      url={bundleUrl}
      style={{
        width,
        height,
        border: '1px solid #f0f0f0',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
      onLoad={() => {
        onLoad?.()
      }}
      onError={(hostError) => {
        setError(hostError)
        onError?.(hostError)
      }}
      onNavigationRequest={onNavigationRequest}
      onUiRequest={onUiRequest}
      onDeviceRequest={onDeviceRequest}
    />
  )
}

export default LynxContainer
