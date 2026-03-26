import { useEffect, useState } from 'react'
import { Alert, Card, Spin } from 'antd'
import AppletManager from './AppletManager'
import LynxHost from './LynxHost'

interface LynxContainerProps {
  appletId: string
  width?: number | string
  height?: number | string
  onLoad?: () => void
  onError?: (error: Error) => void
}

const LynxContainer: React.FC<LynxContainerProps> = ({
  appletId,
  width = '100%',
  height = '600px',
  onLoad,
  onError,
}) => {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const appletManager = AppletManager.getInstance()

  useEffect(() => {
    const loadApplet = async () => {
      try {
        setLoading(true)
        setError(null)

        // 获取Applet信息
        const appletInfo = appletManager.getAppletInfo(appletId)
        if (!appletInfo) {
          throw new Error(`Applet ${appletId} not found`)
        }

        // 加载Applet
        await appletManager.loadApplet(appletId)

        setLoading(false)
        onLoad?.()
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to load applet')
        setError(error)
        onError?.(error)
        setLoading(false)
      }
    }

    loadApplet()

    return () => {
      appletManager.unloadApplet(appletId)
    }
  }, [appletId, appletManager, onError, onLoad])

  if (loading) {
    return (
      <Card style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" tip="Loading Applet..." />
      </Card>
    )
  }

  if (error) {
    return (
      <Card style={{ width, height }}>
        <Alert
          message="Failed to load Applet"
          description={error.message}
          type="error"
          showIcon
        />
      </Card>
    )
  }

  const appletInfo = appletManager.getAppletInfo(appletId)
  const appletEntry = appletInfo?.load?.entry || appletInfo?.main || 'index.html'
  const appletUrl = `${appletInfo?.path}/${appletEntry}`

  return (
    <LynxHost
      appletId={appletId}
      src={appletUrl}
      title={appletInfo?.name || appletId}
      style={{
        width,
        height,
        border: '1px solid #f0f0f0',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
      onLoad={() => {
        setLoading(false)
        onLoad?.()
      }}
      onError={(hostError) => {
        const nextError = hostError instanceof Error ? hostError : new Error('Failed to load Lynx Host')
        setError(nextError)
        setLoading(false)
        onError?.(nextError)
      }}
    />
  )
}

export default LynxContainer
