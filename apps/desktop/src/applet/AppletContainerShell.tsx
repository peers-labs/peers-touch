import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Blocks, ExternalLink, EyeOff, Maximize2, Minimize2, Pin, PinOff, X } from 'lucide-react';
import { theme } from 'antd';
import { Button, Tag } from '@lobehub/ui';

import { PageHeader } from '../components/PageHeader';
import { LynxDebugPanel, type LynxDebugEvent } from './LynxDebugPanel';

interface AppletContainerShellProps {
  readonly appletId: string;
  readonly appletName: string;
  readonly controlsVisible: boolean;
  readonly debugEvents: LynxDebugEvent[];
  readonly immersive: boolean;
  readonly pinned?: boolean;
  readonly runtimeContent: ReactNode;
  readonly subtitle?: string;
  readonly version?: string;
  readonly onClearDebugEvents: () => void;
  readonly onClose: () => void;
  readonly onEnterImmersive: () => void;
  readonly onExitImmersive: () => void;
  readonly onHideControls: () => void;
  readonly onOpenStandalone: () => void;
  readonly onPin?: () => void;
  readonly onShowControls: () => void;
}

export function AppletContainerShell({
  appletId,
  appletName,
  controlsVisible,
  debugEvents,
  immersive,
  pinned = false,
  runtimeContent,
  subtitle,
  version,
  onClearDebugEvents,
  onClose,
  onEnterImmersive,
  onExitImmersive,
  onHideControls,
  onOpenStandalone,
  onPin,
  onShowControls,
}: AppletContainerShellProps) {
  const { t } = useTranslation('applet');
  const { token } = theme.useToken();

  return (
    <Flexbox
      data-applet-container-shell={appletId}
      data-applet-container-mode={immersive ? 'immersive' : 'contained'}
      data-applet-runtime={appletId}
      data-applet-runtime-mode={immersive ? 'immersive' : 'contained'}
      style={{ height: '100%', position: 'relative' }}
    >
      {!immersive && (
        <PageHeader
          title={appletName}
          subtitle={subtitle}
          icon={<Blocks size={20} />}
          actions={(
            <Flexbox horizontal align="center" gap={8}>
              {version && <Tag>v{version}</Tag>}
              <Button
                size="small"
                onClick={onOpenStandalone}
                icon={<ExternalLink size={14} />}
              >
                {t('applet.runtime.openStandalone')}
              </Button>
              <Button
                size="small"
                onClick={onEnterImmersive}
                icon={<Maximize2 size={14} />}
              >
                {t('applet.runtime.fullscreen')}
              </Button>
              {onPin && (
                <Button
                  size="small"
                  onClick={onPin}
                  icon={pinned ? <PinOff size={14} /> : <Pin size={14} />}
                >
                  {pinned ? t('applet.runtime.unpin') : t('applet.runtime.pin')}
                </Button>
              )}
              <Button
                size="small"
                onClick={onClose}
                icon={<X size={14} />}
              >
                {t('applet.runtime.close')}
              </Button>
            </Flexbox>
          )}
        />
      )}
      <Flexbox
        style={{
          flex: 1,
          minHeight: 0,
          padding: immersive ? 0 : 16,
          background: immersive ? token.colorBgContainer : token.colorBgLayout,
        }}
      >
        {runtimeContent}
      </Flexbox>
      {immersive && (
        <AppletFloatingControls
          appletName={appletName}
          controlsVisible={controlsVisible}
          onClose={onClose}
          onExit={onExitImmersive}
          onHide={onHideControls}
          onShow={onShowControls}
        />
      )}
      <LynxDebugPanel appletId={appletId} events={debugEvents} onClear={onClearDebugEvents} />
    </Flexbox>
  );
}

function AppletFloatingControls({
  appletName,
  controlsVisible,
  onClose,
  onExit,
  onHide,
  onShow,
}: {
  readonly appletName: string;
  readonly controlsVisible: boolean;
  readonly onClose: () => void;
  readonly onExit: () => void;
  readonly onHide: () => void;
  readonly onShow: () => void;
}) {
  const { t } = useTranslation('applet');
  const { token } = theme.useToken();

  if (!controlsVisible) {
    return (
      <Button
        size="small"
        onClick={onShow}
        style={{
          position: 'absolute',
          right: 14,
          top: 14,
          zIndex: 30,
          boxShadow: token.boxShadowSecondary,
        }}
      >
        {t('applet.runtime.showControls')}
      </Button>
    );
  }

  return (
    <Flexbox
      horizontal
      align="center"
      gap={8}
      style={{
        position: 'absolute',
        right: 14,
        top: 14,
        zIndex: 30,
        maxWidth: 'calc(100% - 28px)',
        padding: '8px 10px',
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 999,
        background: token.colorBgElevated,
        boxShadow: token.boxShadowSecondary,
      }}
    >
      <span
        style={{
          maxWidth: 180,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: token.colorTextSecondary,
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        {appletName}
      </span>
      <Button size="small" onClick={onExit} icon={<Minimize2 size={14} />}>
        {t('applet.runtime.exitFullscreen')}
      </Button>
      <Button size="small" onClick={onHide} icon={<EyeOff size={14} />}>
        {t('applet.runtime.hideControls')}
      </Button>
      <Button size="small" onClick={onClose} icon={<X size={14} />}>
        {t('applet.runtime.close')}
      </Button>
    </Flexbox>
  );
}
