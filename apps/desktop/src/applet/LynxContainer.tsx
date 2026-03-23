import { useEffect, useRef, useState } from 'react'
import { Card, Spin, Alert } from 'antd'
import AppletManager from './AppletManager'

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
  const iframeRef = useRef<HTMLIFrameElement>(null)
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
  }, [appletId])

  const handleIframeLoad = () => {
    console.log(`Applet ${appletId} loaded successfully`)
    // 向Applet发送初始化消息
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({
        type: 'applet-init',
        appletId,
      }, '*')
    }
  }

  const handleIframeError = () => {
    setError(new Error('Failed to load Applet iframe'))
    setLoading(false)
  }

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
  const appletUrl = `${appletInfo?.path}/${appletInfo?.main || 'index.html'}`

  return (
    <iframe
      ref={iframeRef}
      src={appletUrl}
      style={{
        width,
        height,
        border: '1px solid #f0f0f0',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
      data-applet-id={appletId}
      onLoad={handleIframeLoad}
      onError={handleIframeError}
      sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
      title={appletInfo?.name || appletId}
    />
  )
}

export default LynxContainer
