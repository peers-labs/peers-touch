import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, Typography, List } from 'antd'
import { Flexbox } from 'react-layout-kit'
import { Button, Tag, Alert } from '@lobehub/ui'
import LynxContainer from '@/applet/LynxContainer'
import AppletManager from '@/applet/AppletManager'
import { log } from '../utils/logger'

const { Title, Paragraph, Text } = Typography

const AppletExample: React.FC = () => {
  const { t } = useTranslation('applet')
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
      log.error('applet', 'Failed to scan applets', error)
    } finally {
      setScanning(false)
    }
  }

  const handleLoadApplet = async (appletId: string) => {
    try {
      setSelectedApplet(appletId)
      setAppletLoaded(false)
    } catch (error) {
      log.error('applet', 'Failed to load applet', error)
    }
  }

  const handleUnloadApplet = () => {
    if (selectedApplet) {
      void appletManager.unloadApplet(selectedApplet)
    }
    setSelectedApplet(null)
    setAppletLoaded(false)
  }

  const handleAppletLoad = () => {
    setAppletLoaded(true)
    log.info('applet', 'Applet loaded successfully')
  }

  const handleAppletError = (error: Error) => {
    log.error('applet', 'Applet load error', error)
  }

  return (
    <div style={{ padding: '20px' }}>
      <Title level={2}>{t('applet.example.title')}</Title>
      
      <Alert
        message={t('applet.example.alertTitle')}
        description={t('applet.example.alertDesc')}
        type="info"
        showIcon
        style={{ marginBottom: '20px' }}
      />

      <Card style={{ marginBottom: '20px' }}>
        <Flexbox gap={8} style={{ width: '100%' }}>
          <Paragraph>
            {t('applet.example.description')}
          </Paragraph>
          
          <Flexbox gap={8} horizontal>
            <Button 
              type="primary" 
              onClick={scanApplets}
              loading={scanning}
            >
              {t('applet.example.scan')}
            </Button>
            {selectedApplet && (
              <Button 
                danger 
                onClick={handleUnloadApplet}
              >
                {t('applet.example.closeApplet')}
              </Button>
            )}
          </Flexbox>

          <div>
            <Title level={4}>{t('applet.example.available', { count: availableApplets.length })}</Title>
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
                        {t('applet.example.open')}
                      </Button>
                    ]}
                  >
                    <Card.Meta
                      title={
                        <Flexbox gap={8} horizontal>
                          <span>{applet.name}</span>
                          <Tag color="blue">v{applet.version}</Tag>
                        </Flexbox>
                      }
                      description={
                        <>
                          <Paragraph ellipsis={{ rows: 2 }}>{applet.description}</Paragraph>
                          <Text type="secondary" style={{ fontSize: '12px' }}>
                            {t('applet.example.author', { author: applet.author })}
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
              message={t('applet.example.loaded.title')}
              description={t('applet.example.loaded.desc')}
              type="success"
              showIcon
            />
          )}
        </Flexbox>
      </Card>

      {selectedApplet && (
        <Card 
          title={
            <Flexbox gap={8} horizontal>
              <span>{availableApplets.find(a => a.id === selectedApplet)?.name || selectedApplet}</span>
              <Tag color="green">{t('applet.runtime.running')}</Tag>
            </Flexbox>
          }
          extra={
            <Button 
              danger 
              size="small" 
              onClick={handleUnloadApplet}
            >
              {t('applet.runtime.close')}
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
