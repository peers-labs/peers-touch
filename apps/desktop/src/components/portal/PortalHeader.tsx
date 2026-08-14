import { Flexbox } from 'react-layout-kit';
import { ActionIcon } from '@lobehub/ui';
import { X, FolderOpen, Activity, Bot } from 'lucide-react';
import { theme } from 'antd';
import { useTranslation } from 'react-i18next';

import { usePortalStore, type PortalView } from '../../store/portal';
import { useChatStore } from '../../store/chat';
import { useAgentStore } from '../../store/agent';

interface PortalHeaderProps {
  activeView: PortalView | null;
}

function viewTitle(view: PortalView | null, t: (key: string) => string): string {
  if (!view || view.type === 'artifacts') return 'Artifacts';
  if (view.type === 'artifactDetail') return view.artifact.title || 'Artifact';
  if (view.type === 'toolDetail') return 'Tool Detail';
  if (view.type === 'workingFiles') return t('agent.working.files');
  if (view.type === 'workingProgress') return t('agent.working.progress');
  if (view.type === 'agentOverview') return t('agent.working.overview');
  return 'Portal';
}

type WorkingTab = 'files' | 'progress' | 'overview';

function isWorkingView(view: PortalView | null): WorkingTab | null {
  if (!view) return null;
  if (view.type === 'workingFiles') return 'files';
  if (view.type === 'workingProgress') return 'progress';
  if (view.type === 'agentOverview') return 'overview';
  return null;
}

export function PortalHeader({ activeView }: PortalHeaderProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('agent');
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const selectedAgent = useAgentStore((s) => s.selectedAgent);

  const currentWorkingTab = isWorkingView(activeView);

  const handleTabClick = (tab: WorkingTab) => {
    const portal = usePortalStore.getState();
    switch (tab) {
      case 'files':
        portal.openWorkingFiles(currentSessionKey);
        break;
      case 'progress':
        portal.openWorkingProgress();
        break;
      case 'overview':
        portal.openAgentOverview(selectedAgent);
        break;
    }
  };

  const tabItems: Array<{ key: WorkingTab; icon: typeof FolderOpen; label: string }> = [
    { key: 'files', icon: FolderOpen, label: t('agent.working.files') },
    { key: 'progress', icon: Activity, label: t('agent.working.progress') },
    { key: 'overview', icon: Bot, label: t('agent.working.overview') },
  ];

  return (
    <Flexbox
      style={{
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        flexShrink: 0,
      }}
    >
      {/* Title row */}
      <Flexbox
        horizontal
        align="center"
        justify="space-between"
        style={{ height: 44, padding: '0 12px' }}
      >
        <span style={{ fontSize: 14, fontWeight: 500, color: token.colorText }}>
          {viewTitle(activeView, t)}
        </span>
        <ActionIcon
          icon={X}
          size="small"
          onClick={() => usePortalStore.getState().close()}
        />
      </Flexbox>

      {/* Working tabs navigation — visible when portal is in working mode or always as quick-access */}
      <Flexbox
        horizontal
        align="center"
        gap={2}
        style={{ padding: '0 8px 8px' }}
      >
        {tabItems.map(({ key, icon: Icon, label }) => (
          <Flexbox
            key={key}
            horizontal
            align="center"
            gap={4}
            onClick={() => handleTabClick(key)}
            style={{
              padding: '4px 10px',
              borderRadius: token.borderRadiusSM,
              cursor: 'pointer',
              fontSize: 12,
              color: currentWorkingTab === key ? token.colorPrimary : token.colorTextSecondary,
              background: currentWorkingTab === key ? token.colorPrimaryBg : 'transparent',
              fontWeight: currentWorkingTab === key ? 500 : 400,
              transition: 'all 0.2s',
            }}
          >
            <Icon size={13} />
            <span>{label}</span>
          </Flexbox>
        ))}
      </Flexbox>
    </Flexbox>
  );
}
