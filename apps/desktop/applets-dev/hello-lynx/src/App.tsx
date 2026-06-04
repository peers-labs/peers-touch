import { useCallback, useState } from '@lynx-js/react'
import { sdk } from '@peers-touch/applet-sdk'

export function App() {
  const [message, setMessage] = useState('Press button to test bridge')
  const [sysInfo, setSysInfo] = useState('')

  const testSystemInfo = useCallback(async () => {
    setMessage('Calling system.getInfo...')
    try {
      const info = await sdk.system.getInfo()
      setSysInfo(`Platform: ${info.platform}, App: ${info.appName} v${info.version}`)
      setMessage('Bridge OK!')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setMessage(`Error: ${msg}`)
    }
  }, [])

  const testStorage = useCallback(async () => {
    setMessage('Calling storage.set + storage.get...')
    try {
      await sdk.storage.set('hello', 'world')
      const val = await sdk.storage.get('hello')
      setMessage(`storage.get("hello") = "${val}"`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setMessage(`Error: ${msg}`)
    }
  }, [])

  return (
    <view style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
      <text style={{ fontSize: 28, fontWeight: 'bold', marginBottom: 20 }}>
        Hello Lynx!
      </text>
      <text style={{ fontSize: 14, color: '#999', marginBottom: 8 }}>
        Runtime: {sdk.runtime}
      </text>
      <text style={{ fontSize: 16, color: '#666', marginBottom: 12, textAlign: 'center' }}>
        {message}
      </text>
      {sysInfo ? (
        <text style={{ fontSize: 14, color: '#333', marginBottom: 20 }}>
          {sysInfo}
        </text>
      ) : null}

      <view style={{ flexDirection: 'row', gap: 12 }}>
        <view
          style={{
            backgroundColor: '#1890ff',
            paddingTop: 12,
            paddingBottom: 12,
            paddingLeft: 24,
            paddingRight: 24,
            borderRadius: 8,
          }}
          bindtap={testSystemInfo}
        >
          <text style={{ color: '#fff', fontSize: 14 }}>system.getInfo</text>
        </view>

        <view
          style={{
            backgroundColor: '#52c41a',
            paddingTop: 12,
            paddingBottom: 12,
            paddingLeft: 24,
            paddingRight: 24,
            borderRadius: 8,
          }}
          bindtap={testStorage}
        >
          <text style={{ color: '#fff', fontSize: 14 }}>storage test</text>
        </view>
      </view>
    </view>
  )
}
