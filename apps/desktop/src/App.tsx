import { useCallback, useEffect, useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import { ActionIcon, DraggablePanel, SideNav } from '@lobehub/ui';
import {
  Bot,
  MessageCircle,
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
import { LoginPage } from './pages/LoginPage';
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
import { PlatformLogo } from './components/common/PlatformLogo';
import { AppletRuntimePage } from './pages/AppletRuntimePage';
import { EVENT, eventBus, onWindowKeydown, onWindowPopState } from './kernel/events';
import { globalContext } from './kernel/global-context';
import type { ParsedDeepLink } from './utils/deeplink';

type Page = string;
type AppState = 'loading' | 'login' | 'ready';

const CORE_PAGES = ['chat', 'agent', 'settings', 'search', 'notes', 'agent-profile'];

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
  const [restoredUser, setRestoredUser] = useState<{ name: string; email: string; avatar?: string } | null>(null);
  const [page, setPageRaw] = useState<Page>(getPageFromHash);
  const [sidebarExpand, setSidebarExpand] = useState(true);
  const [settingsNav, setSettingsNav] = useState<SettingsNavState>({});

  const [profileAgentName, setProfileAgentName] = useState(() => getAgentNameFromHash());
  const appletManager = AppletManager.getInstance();

  useEffect(() => {
    globalContext.bootstrap().catch(() => {});
  }, []);

  useEffect(() => {
    if (appState === 'loading') {
      globalContext.setRuntimeAppState('booting');
    } else if (appState === 'ready') {
      globalContext.setRuntimeAppState('ready');
    } else {
      globalContext.setRuntimeAppState('degraded');
    }
  }, [appState]);

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
    return onWindowPopState(onPopState);
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
    const store = useOAuth2Store.getState();
    Promise.all([
      store.restoreSession().catch(() => {}),
      store.loadAll().catch(() => {}),
    ]).then(() => {
      const { authenticated, connections } = useOAuth2Store.getState();
      if (authenticated) {
        const active = connections.find(c => c.status === 'active' && c.user_id && c.user_id !== 'unknown');
        if (active) {
          setRestoredUser({
            name: active.user_name || active.user_id || 'User',
            email: active.email || '',
            avatar: active.avatar_url,
          });
        }
      }
      setAppState('login');
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
      setPage('agent');
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
    return onWindowKeydown(handler);
  }, []);

  const userAvatar = useUserAvatar();

  // Deep link navigation: pt:// URI → page navigation
  useEffect(() => eventBus.subscribe(EVENT.NAVIGATION_REQUESTED, (parsed) => {
    const nav = parsed as ParsedDeepLink;
    if (!nav?.resource) return;
    switch (nav.resource) {
      case 'cron':
        setPage('cron');
        break;
      case 'sessions':
        if (nav.id) {
          useChatStore.getState().selectSession(nav.id);
        }
        setPage('agent');
        break;
      case 'settings':
        if (nav.id) setSettingsNav({ tab: nav.id });
        setPage('settings');
        break;
      case 'channels':
        setPage('channels');
        break;
      case 'documents':
        setPage('notes');
        break;
    }
  }), [setPage]);

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

  if (appState === 'login') {
    return (
      <GlobalLayout sideNav={null}>
        <LoginPage
          onComplete={() => {
            useOAuth2Store.getState().loadAll();
            setAppState('ready');
          }}
          restoredUser={restoredUser}
        />
      </GlobalLayout>
    );
  }

  const sideNavElement = (
    <>
      <SideNav
        avatar={
          <UserProfilePopover>
            <div style={{ cursor: 'pointer', position: 'relative', width: 36, height: 36 }}>
              <UserSquareAvatar url={userAvatar.url} name={userAvatar.name} size={36} radius={8} />
              {userAvatar.provider && (
                <div
                  style={{
                    position: 'absolute',
                    right: -4,
                    bottom: -4,
                    width: 14,
                    height: 14,
                    borderRadius: 7,
                    background: '#fff',
                    border: '1px solid #f0f0f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <PlatformLogo providerId={userAvatar.provider} size={10} />
                </div>
              )}
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
              icon={MessageCircle}
              size="large"
              active={page === 'chat'}
              onClick={() => handleTabChange('chat')}
              title="Chat"
            />
            <ActionIcon
              icon={Bot}
              size="large"
              active={page === 'agent'}
              onClick={() => handleTabChange('agent')}
              title="Agent"
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
              setProfileAgentName(name);
              window.history.pushState(null, '', `#/agent-profile/${name}`);
              setPageRaw('agent-profile');
            }}
            onNavigateChat={() => setPage('agent')}
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
      {page === 'agent' && (
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
            setPage('agent');
          }}
        />
      )}
      {page === 'agent-profile' && (
        <AgentProfilePage
          agentName={profileAgentName}
          onBack={() => setPage('agent')}
          onStartChat={(name) => {
            useChatStore.getState().setSelectedAgent(name);
            setPage('agent');
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
