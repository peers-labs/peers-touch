import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionIcon, DraggablePanel, SideNav } from '@lobehub/ui';
import {
  Bot,
  MessageCircle,
  Settings,
  Search,
  FileText,
  Blocks,
} from 'lucide-react';
import { AgentSidebar } from './AgentSidebar';
import { AgentSettingsDrawer } from './AgentSettingsDrawer';
import { NotificationBell } from './NotificationBell';
import { UserProfilePopover, useUserAvatar } from './UserProfilePopover';
import { UserSquareAvatar } from './common/UserSquareAvatar';
import AppletManager from '../applet/AppletManager';
import { getModulesWithSidebar } from '../modules/registry';
import { useAppletsStore } from '../store/applets';
import type { Agent } from '../services/desktop_api';
import type { Page, Navigation, AppletPins, HashRouter } from '../types/navigation';

interface AppSideNavProps {
  page: Page;
  router: HashRouter;
  navigation: Navigation;
  appletPins: AppletPins;
}

export function AppSideNav({ page, router, navigation, appletPins }: AppSideNavProps) {
  const userAvatar = useUserAvatar();
  const appletManager = AppletManager.getInstance();
  const { t } = useTranslation('layout');
  const installedApplets = useAppletsStore((state) => state.applets);
  const installedAppletById = new Map(installedApplets.map((info) => [info.manifest.id, info.manifest]));

  const [sidebarExpand, setSidebarExpand] = useState(true);
  const [agentDrawerOpen, setAgentDrawerOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);

  const handleCreateAgent = useCallback(() => {
    setEditingAgent(null);
    setAgentDrawerOpen(true);
  }, []);

  const handleEditAgent = useCallback((agent: Agent) => {
    setEditingAgent(agent);
    setAgentDrawerOpen(true);
  }, []);

  const handleAgentSaved = useCallback(() => {
    setAgentDrawerOpen(false);
    setEditingAgent(null);
  }, []);

  return (
    <>
      <SideNav
        avatar={
          <UserProfilePopover>
            <div style={{ cursor: 'pointer', width: 36, height: 36 }}>
              <UserSquareAvatar remoteUrl={userAvatar.url} name={userAvatar.name} size={36} radius={8} />
            </div>
          </UserProfilePopover>
        }
        topActions={
          <>
            <ActionIcon
              icon={Search}
              size="large"
              active={page === 'search'}
              onClick={() => navigation.navigateTo('search')}
              title={t('layout.nav.search')}
            />
            <ActionIcon
              icon={MessageCircle}
              size="large"
              active={page === 'chat'}
              onClick={() => navigation.navigateTo('chat')}
              title={t('layout.nav.chat')}
            />
            <ActionIcon
              icon={Bot}
              size="large"
              active={page === 'agent'}
              onClick={() => navigation.navigateTo('agent')}
              title={t('layout.nav.agent')}
            />
            <ActionIcon
              icon={FileText}
              size="large"
              active={page === 'notes'}
              onClick={() => navigation.navigateTo('notes')}
              title={t('layout.nav.notes')}
            />
            {getModulesWithSidebar()
              .filter((m) => m.sidebarEntry!.position === 'top')
              .map((m) => (
                <ActionIcon
                  key={m.id}
                  icon={m.icon}
                  size="large"
                  active={page === m.id}
                  onClick={() => navigation.navigateTo(m.id)}
                  title={m.id === 'applets' ? t('layout.nav.applets') : m.sidebarEntry?.title || m.name}
                />
              ))}
            {appletPins.pinnedApplets.filter((appletId) => installedAppletById.has(appletId)).map((appletId) => {
              const info = installedAppletById.get(appletId) ?? appletManager.getAppletInfo(appletId);
              if (!info) return null;
              return (
                <ActionIcon
                  key={appletId}
                  icon={Blocks}
                  size="large"
                  active={page === `applet:${appletId}`}
                  onClick={() => navigation.navigateTo(`applet:${appletId}`)}
                  title={info.name}
                />
              );
            })}
          </>
        }
        bottomActions={
          <>
            <NotificationBell />
            <ActionIcon
              icon={Settings}
              size="large"
              active={page === 'settings'}
              onClick={() => navigation.navigateTo('settings')}
              title={t('layout.nav.settings')}
            />
          </>
        }
      />

      {(page === 'agent' || page === 'agent-profile') && (
        <DraggablePanel
          placement="left"
          defaultSize={{ width: 260 }}
          minWidth={220}
          maxWidth={400}
          expand={sidebarExpand}
          onExpandChange={setSidebarExpand}
          style={{
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <AgentSidebar
            onCreateAgent={handleCreateAgent}
            onEditAgent={handleEditAgent}
            onNavigateProfile={(name) => {
              router.setProfileAgentName(name);
              window.history.pushState(null, '', `#/agent-profile/${name}`);
              router.setPage('agent-profile');
            }}
            onNavigateChat={() => router.setPage('agent')}
            onAgentChanged={(name) => {
              if (page === 'agent-profile') {
                router.setProfileAgentName(name);
                window.history.pushState(null, '', `#/agent-profile/${name}`);
              }
            }}
          />
        </DraggablePanel>
      )}

      <AgentSettingsDrawer
        open={agentDrawerOpen}
        editingAgent={editingAgent}
        onClose={() => { setAgentDrawerOpen(false); setEditingAgent(null); }}
        onSaved={handleAgentSaved}
      />
    </>
  );
}
