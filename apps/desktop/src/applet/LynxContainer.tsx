import { useEffect, useState } from 'react'
import { Alert } from '@lobehub/ui'
import { Card, Spin } from 'antd'
import AppletManager from './AppletManager'
import LynxHost from './LynxHost'
import type { AppletInfo } from './types'

interface LynxContainerProps {
  appletId: string
  width?: number | string
  height?: number | string
  onLoad?: () => void
  onError?: (error: Error) => void
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
}) => {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [appletInfo, setAppletInfo] = useState<AppletInfo | null>(null)
  const appletManager = AppletManager.getInstance()

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        setError(null)

        const info = appletManager.getAppletInfo(appletId)
        if (!info) {
          throw new Error(`Applet "${appletId}" not found in registry`)
        }

        await appletManager.loadApplet(appletId)
        setAppletInfo(info)
        setLoading(false)
      } catch (err) {
        const loadError = err instanceof Error ? err : new Error('Failed to load applet')
        setError(loadError)
        onError?.(loadError)
        setLoading(false)
      }
    }

    load()
    return () => {
      appletManager.unloadApplet(appletId)
    }
  }, [appletId, appletManager, onError])

  if (loading) {
    return (
      <Card style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" tip="Loading Applet..." />
      </Card>
    )
  }

  if (error || !appletInfo) {
    return (
      <Card style={{ width, height }}>
        <Alert
          message="Failed to load Applet"
          description={error?.message || 'Unknown error'}
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
          message="Unsupported Platform"
          description={`Applet "${appletId}" has no desktop load configuration`}
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
    />
  )
}

export default LynxContainer
