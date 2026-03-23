import { useState, useEffect } from 'react'
import { Card, Button, Space, Typography, Alert, List, Tag } from 'antd'
import LynxContainer from '@/applet/LynxContainer'
import AppletManager from '@/applet/AppletManager'

const { Title, Paragraph, Text } = Typography

const AppletExample: React.FC = () => {
  const [availableApplets, setAvailableApplets] = useState<any[]>([])
  const [selectedApplet, setSelectedApplet] = useState<string | null>(null)
  const [appletLoaded, setAppletLoaded] = useState(false)
  const [scanning, setScanning] = useState(false)
  const appletManager = AppletManager.getInstance()

  useEffect(() => {
    scanApplets()
  }, [])

  const scanApplets = async () => {
    try {
      setScanning(true)
      const applets = await appletManager.scanApplets()
      setAvailableApplets(applets)
    } catch (error) {
      console.error('Failed to scan applets:', error)
    } finally {
      setScanning(false)
    }
  }

  const handleLoadApplet = async (appletId: string) => {
    try {
      setSelectedApplet(appletId)
      setAppletLoaded(false)
    } catch (error) {
      console.error('Failed to load applet:', error)
    }
  }

  const handleUnloadApplet = () => {
    if (selectedApplet) {
      appletManager.unloadApplet(selectedApplet)
    }
    setSelectedApplet(null)
    setAppletLoaded(false)
  }

  const handleAppletLoad = () => {
    setAppletLoaded(true)
    console.log('Applet loaded successfully')
  }

  const handleAppletError = (error: Error) => {
    console.error('Applet load error:', error)
  }

  return (
    <div style={{ padding: '20px' }}>
      <Title level={2}>Applet Runtime Example</Title>
      
      <Alert
        message="Applet Runtime"
        description="This page demonstrates how to load and run Applet from local applets-dist directory."
        type="info"
        showIcon
        style={{ marginBottom: '20px' }}
      />

      <Card style={{ marginBottom: '20px' }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Paragraph>
            The Applet runtime allows you to run lightweight applications within the desktop client,
            powered by the Lynx cross-platform rendering engine. Applets are loaded from the local
            <code>applets-dist</code> directory.
          </Paragraph>
          
          <Space>
            <Button 
              type="primary" 
              onClick={scanApplets}
              loading={scanning}
            >
              Scan Applets
            </Button>
            {selectedApplet && (
              <Button 
                danger 
                onClick={handleUnloadApplet}
              >
                Close Applet
              </Button>
            )}
          </Space>

          <div>
            <Title level={4}>Available Applets ({availableApplets.length})</Title>
            <List
              grid={{ gutter: 16, column: 3 }}
              dataSource={availableApplets}
              renderItem={(applet) => (
                <List.Item>
                  <Card 
                    hoverable
                    style={{ width: '100%' }}
                    onClick={() => handleLoadApplet(applet.id)}
                    actions={[
                      <Button 
                        type="link" 
                        onClick={(e) => {
                          e.stopPropagation()
                          handleLoadApplet(applet.id)
                        }}
                      >
                        Open
                      </Button>
                    ]}
                  >
                    <Card.Meta
                      title={
                        <Space>
                          <span>{applet.name}</span>
                          <Tag color="blue">v{applet.version}</Tag>
                        </Space>
                      }
                      description={
                        <>
                          <Paragraph ellipsis={{ rows: 2 }}>{applet.description}</Paragraph>
                          <Text type="secondary" style={{ fontSize: '12px' }}>
                            Author: {applet.author}
                          </Text>
                        </>
                      }
                    />
                  </Card>
                </List.Item>
              )}
            />
          </div>

          {appletLoaded && (
            <Alert
              message="Applet Loaded"
              description="The applet has been loaded successfully. You can interact with it below."
              type="success"
              showIcon
            />
          )}
        </Space>
      </Card>

      {selectedApplet && (
        <Card 
          title={
            <Space>
              <span>{availableApplets.find(a => a.id === selectedApplet)?.name || selectedApplet}</span>
              <Tag color="green">Running</Tag>
            </Space>
          }
          extra={
            <Button 
              danger 
              size="small" 
              onClick={handleUnloadApplet}
            >
              Close
            </Button>
          }
        >
          <LynxContainer
            appletId={selectedApplet}
            height="600px"
            onLoad={handleAppletLoad}
            onError={handleAppletError}
          />
        </Card>
      )}
    </div>
  )
}

export default AppletExample
