import { useCallback, useEffect, useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import { ActionIcon, DraggablePanel, SideNav } from '@lobehub/ui';
import {
  MessageSquare,
  Settings,
  Search,
  FileText,
  Blocks,
} from 'lucide-react';
import { Spin } from 'antd';
import { ChatPage } from './pages/ChatPage';
import { SettingsPage } from './pages/SettingsPage';
import { SearchPage } from './pages/SearchPage';
import { NotesPage } from './pages/NotesPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { WizardRenderer } from './components/wizard/WizardRenderer';
import { AgentProfilePage } from './pages/AgentProfilePage';
import { AgentSidebar } from './components/AgentSidebar';
import { AgentSettingsDrawer } from './components/AgentSettingsDrawer';
import { GlobalLayout } from './components/GlobalLayout';
import { api } from './services/desktop_api';
import type { Agent } from './services/desktop_api';
import { useChatStore } from './store/chat';
import { useOAuth2Store } from './store/oauth2';
import AppletManager from './applet/AppletManager';
import { getModulesWithSidebar, getModule } from './modules/registry';
import { UserProfilePopover, useUserAvatar } from './components/UserProfilePopover';
import { UserSquareAvatar } from './components/common/UserSquareAvatar';
import { AppletRuntimePage } from './pages/AppletRuntimePage';

type Page = string;
type AppState = 'loading' | 'onboarding' | 'ready';
type OnboardingMode = 'default' | 'wizard';

const CORE_PAGES = ['chat', 'settings', 'search', 'notes', 'agent-profile'];

export interface SettingsNavState {
  tab?: string;
  highlightId?: string;
}

function getPageFromHash(): Page {
  const hash = window.location.hash.slice(1) || '/search';
  const path = hash.startsWith('/') ? hash.slice(1) : hash;
  const segment = path.split('/')[0] || 'search';
  if (segment === 'agent-profile') return 'agent-profile';
  if (CORE_PAGES.includes(segment)) return segment;
  if (segment.startsWith('applet:')) return segment;
  if (getModule(segment)) return segment;
  return 'search';
}

function getDocIdFromHash(): string | undefined {
  const hash = window.location.hash.slice(1) || '';
  const match = hash.match(/^\/notes\/(.+)$/);
  return match?.[1];
}

function getAgentNameFromHash(): string {
  const hash = window.location.hash.slice(1) || '';
  const match = hash.match(/^\/agent-profile\/(.+)$/);
  return match?.[1] || 'assistant';
}

function App() {
  const [appState, setAppState] = useState<AppState>('loading');
  const [onboardingMode, setOnboardingMode] = useState<OnboardingMode>('default');
  const [page, setPageRaw] = useState<Page>(getPageFromHash);
  const [sidebarExpand, setSidebarExpand] = useState(true);
  const [settingsNav, setSettingsNav] = useState<SettingsNavState>({});

  const [profileAgentName, setProfileAgentName] = useState(() => getAgentNameFromHash());
  const appletManager = AppletManager.getInstance();

  const setPage = useCallback((p: Page) => {
    setPageRaw(p);
    window.history.pushState(null, '', `#/${p}`);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const p = getPageFromHash();
      setPageRaw(p);
      if (p === 'agent-profile') {
        setProfileAgentName(getAgentNameFromHash());
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const [pinnedApplets, setPinnedApplets] = useState<string[]>([]);

  // Agent settings drawer state
  const [agentDrawerOpen, setAgentDrawerOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);

  useEffect(() => {
    appletManager.scanApplets().catch(() => {});
  }, [appletManager]);

  useEffect(() => {
    api.getPreferences()
      .then((prefs) => setPinnedApplets(prefs.pinned_applets || []))
      .catch(() => {});
  }, []);

  const togglePin = useCallback((appletId: string) => {
    setPinnedApplets((prev) => {
      const next = prev.includes(appletId)
        ? prev.filter((id) => id !== appletId)
        : [...prev, appletId];
      api.setPreferences({ pinned_applets: next }).catch(() => {});
      return next;
    });
  }, []);

  useEffect(() => {
    Promise.all([api.getOnboarding(), api.getWizard()])
      .then(([state, wizard]) => {
        if (state.completed) {
          setAppState('ready');
          useOAuth2Store.getState().loadAll(); // Preload so Channels hasLarkSimulate is correct
        } else {
          setOnboardingMode(wizard.available ? 'wizard' : 'default');
          setAppState('onboarding');
        }
      })
      .catch(() => {
        setAppState('ready');
        useOAuth2Store.getState().loadAll();
      });
  }, []);

  const handleTabChange = useCallback((key: string) => {
    setPage(key as Page);
  }, [setPage]);

  const handleSearchNavigate = useCallback((url: string) => {
    if (url.startsWith('/chat')) {
      const params = new URLSearchParams(url.split('?')[1] || '');
      const sessionKey = params.get('session');
      if (sessionKey) {
        useChatStore.getState().selectSession(sessionKey);
      }
      setPage('chat');
    } else if (url.startsWith('/notes/') || url.startsWith('/pages/')) {
      const docId = url.split(/\/(?:notes|pages)\//)[1];
      if (docId) {
        window.history.pushState(null, '', `#/notes/${docId}`);
      }
      setPage('notes');
    } else if (url.startsWith('/settings')) {
      const params = new URLSearchParams(url.split('?')[1] || '');
      setSettingsNav({
        tab: params.get('tab') || undefined,
        highlightId: params.get('id') || undefined,
      });
      setPage('settings');
    }
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPage('search');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const userAvatar = useUserAvatar();

  // Listen for cross-component settings tab navigation
  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent).detail;
      setSettingsNav({ tab });
      setPage('settings');
    };
    window.addEventListener('navigate-settings-tab', handler);
    return () => window.removeEventListener('navigate-settings-tab', handler);
  }, [setPage]);

  // Deep link navigation: pt:// URI → page navigation
  useEffect(() => {
    const handler = (e: Event) => {
      const parsed = (e as CustomEvent).detail as { resource: string; id?: string; subResource?: string; subId?: string };
      if (!parsed) return;
      switch (parsed.resource) {
        case 'cron':
          setPage('cron');
          break;
        case 'sessions':
          if (parsed.id) {
            useChatStore.getState().selectSession(parsed.id);
          }
          setPage('chat');
          break;
        case 'settings':
          if (parsed.id) setSettingsNav({ tab: parsed.id });
          setPage('settings');
          break;
        case 'channels':
          setPage('channels');
          break;
        case 'documents':
          setPage('notes');
          break;
      }
    };
    window.addEventListener('agentbox:navigate', handler);
    return () => window.removeEventListener('agentbox:navigate', handler);
  }, [setPage]);

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

  if (appState === 'loading') {
    return (
      <GlobalLayout sideNav={null}>
        <Flexbox align="center" justify="center" style={{ width: '100%', height: '100%' }}>
          <Spin size="large" />
        </Flexbox>
      </GlobalLayout>
    );
  }

  if (appState === 'onboarding') {
    if (onboardingMode === 'wizard') {
      return (
        <GlobalLayout sideNav={null}>
          <WizardRenderer onComplete={() => setAppState('ready')} />
        </GlobalLayout>
      );
    }
    return (
      <GlobalLayout sideNav={null}>
        <OnboardingPage onComplete={() => setAppState('ready')} />
      </GlobalLayout>
    );
  }

  const sideNavElement = (
    <>
      <SideNav
        avatar={
          <UserProfilePopover>
            <div style={{ cursor: 'pointer' }}>
              <UserSquareAvatar url={userAvatar.url} name={userAvatar.name} size={36} radius={8} />
            </div>
          </UserProfilePopover>
        }
        topActions={
          <>
            <ActionIcon
              icon={Search}
              size="large"
              active={page === 'search'}
              onClick={() => handleTabChange('search')}
              title="Search (⌘K)"
            />
            <ActionIcon
              icon={MessageSquare}
              size="large"
              active={page === 'chat'}
              onClick={() => handleTabChange('chat')}
              title="Agents"
            />
            <ActionIcon
              icon={FileText}
              size="large"
              active={page === 'notes'}
              onClick={() => handleTabChange('notes')}
              title="Notes"
            />
            {getModulesWithSidebar()
              .filter((m) => m.sidebarEntry!.position === 'top')
              .map((m) => (
                <ActionIcon
                  key={m.id}
                  icon={m.icon}
                  size="large"
                  active={page === m.id}
                  onClick={() => handleTabChange(m.id)}
                  title={m.sidebarEntry?.title || m.name}
                />
              ))}
            {pinnedApplets.map((appletId) => {
              const info = appletManager.getAppletInfo(appletId);
              if (!info) return null;
              return (
                <ActionIcon
                  key={appletId}
                  icon={Blocks}
                  size="large"
                  active={page === `applet:${appletId}`}
                  onClick={() => handleTabChange(`applet:${appletId}`)}
                  title={info.name}
                />
              );
            })}
          </>
        }
        bottomActions={
          <ActionIcon
            icon={Settings}
            size="large"
            active={page === 'settings'}
            onClick={() => handleTabChange('settings')}
            title="Settings"
          />
        }
      />

      {/* Agent workspace sidebar (LobeChat style) */}
      {(page === 'chat' || page === 'agent-profile') && (
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
              setProfileAgentName(name);
              window.history.pushState(null, '', `#/agent-profile/${name}`);
              setPageRaw('agent-profile');
            }}
            onNavigateChat={() => setPage('chat')}
            onAgentChanged={(name) => {
              if (page === 'agent-profile') {
                setProfileAgentName(name);
                window.history.pushState(null, '', `#/agent-profile/${name}`);
              }
            }}
          />
        </DraggablePanel>
      )}
    </>
  );

  return (
    <GlobalLayout sideNav={sideNavElement}>
      {page === 'chat' && (
        <ChatPage
          onNavigateSettings={() => {
            setSettingsNav({ tab: 'providers' });
            setPage('settings');
          }}
          onNavigateApplets={() => {
            setSettingsNav({ tab: 'applets' });
            setPage('settings');
          }}
          onNavigateSkills={() => {
            setSettingsNav({ tab: 'skills' });
            setPage('settings');
          }}
          onNavigatePages={(docId) => {
            if (docId) {
              window.history.pushState(null, '', `#/notes/${docId}`);
            }
            setPage('notes');
          }}
        />
      )}
      {page === 'settings' && (
        <SettingsPage
          activeTab={settingsNav.tab}
          highlightId={settingsNav.highlightId}
          onNavConsumed={() => setSettingsNav({})}
        />
      )}
      {page === 'search' && <SearchPage onNavigate={handleSearchNavigate} />}
      {page === 'notes' && (
        <NotesPage
          initialDocId={getDocIdFromHash()}
          onNavigateChat={(sessionKey) => {
            useChatStore.getState().selectSession(sessionKey);
            setPage('chat');
          }}
        />
      )}
      {page === 'agent-profile' && (
        <AgentProfilePage
          agentName={profileAgentName}
          onBack={() => setPage('chat')}
          onStartChat={(name) => {
            useChatStore.getState().setSelectedAgent(name);
            setPage('chat');
          }}
          onNavigateCron={() => {
            setSettingsNav({ tab: 'cron' });
            setPage('settings');
          }}
          onNavigateSkills={() => {
            setSettingsNav({ tab: 'skills' });
            setPage('settings');
          }}
          onNavigateApplets={() => {
            setSettingsNav({ tab: 'applets' });
            setPage('settings');
          }}
        />
      )}
      {(() => {
        const mod = getModule(page);
        if (mod?.page) {
          const PageComp = mod.page;
          return <PageComp onNavigate={(p: string) => setPage(p)} />;
        }
        return null;
      })()}
      {page.startsWith('applet:') && (() => {
        const appletId = page.slice('applet:'.length);
        return (
          <AppletRuntimePage
            appletId={appletId}
            onPin={() => togglePin(appletId)}
            pinned={pinnedApplets.includes(appletId)}
          />
        );
      })()}

      {/* Agent Create/Edit Drawer */}
      <AgentSettingsDrawer
        open={agentDrawerOpen}
        editingAgent={editingAgent}
        onClose={() => { setAgentDrawerOpen(false); setEditingAgent(null); }}
        onSaved={handleAgentSaved}
      />
    </GlobalLayout>
  );
}

export default App;
