import { useEffect, useMemo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Blocks, Pin, PinOff } from 'lucide-react';
import { Button, Empty, Spin, Tag, theme, Typography } from 'antd';
import { PageHeader } from '../components/PageHeader';
import AppletManager from '../applet/AppletManager';
import LynxContainer from '../applet/LynxContainer';

const { Text } = Typography;

interface Props {
  appletId: string;
  onPin?: () => void;
  pinned?: boolean;
}

export function AppletRuntimePage({ appletId, onPin, pinned = false }: Props) {
  const { token } = theme.useToken();
  const [loading, setLoading] = useState(true);
  const [exists, setExists] = useState(false);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const appletManager = useMemo(() => AppletManager.getInstance(), []);
  const applet = appletManager.getAppletInfo(appletId);

  useEffect(() => {
    let cancelled = false;
    const checkApplet = async () => {
      setLoading(true);
      const scanned = await appletManager.scanApplets();
      if (!cancelled) {
        setExists(scanned.some((item) => item.id === appletId));
        const issues = appletManager
          .getDiagnostics()
          .filter((diag) => diag.source === appletId)
          .flatMap((diag) => diag.issues);
        setDiagnostics(issues);
        setLoading(false);
      }
    };
    checkApplet();
    return () => {
      cancelled = true;
    };
  }, [appletId, appletManager]);

  if (loading) {
    return (
      <Flexbox align="center" justify="center" style={{ height: '100%' }}>
        <Spin size="large" />
      </Flexbox>
    );
  }

  if (!exists) {
    return (
      <Flexbox style={{ height: '100%' }}>
        <PageHeader title="Applet" icon={<Blocks size={20} />} />
        <Flexbox align="center" justify="center" style={{ flex: 1 }}>
          <Empty
            description={[
              `Applet "${appletId}" 未找到，请先构建 packages/applets`,
              ...diagnostics.map((issue, index) => `诊断 ${index + 1}: ${issue}`),
            ].join('\n')}
          />
        </Flexbox>
      </Flexbox>
    );
  }

  return (
    <Flexbox style={{ height: '100%' }}>
      <PageHeader
        title={applet?.name || appletId}
        subtitle={applet?.description || ''}
        icon={<Blocks size={20} />}
        actions={(
          <Flexbox horizontal align="center" gap={8}>
            {applet?.version && <Tag>v{applet.version}</Tag>}
            {onPin && (
              <Button
                size="small"
                onClick={onPin}
                icon={pinned ? <PinOff size={14} /> : <Pin size={14} />}
              >
                {pinned ? 'Unpin' : 'Pin'}
              </Button>
            )}
          </Flexbox>
        )}
      />
      <Flexbox style={{ flex: 1, padding: 16 }} gap={8}>
        <Text type="secondary" style={{ fontSize: 12, color: token.colorTextTertiary }}>
          Source: /applets-dist/{appletId}
        </Text>
        <LynxContainer appletId={appletId} height="100%" />
      </Flexbox>
    </Flexbox>
  );
}
