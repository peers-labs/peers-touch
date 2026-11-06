/**
 * MobileAppView — host for the clean mobile product surface.
 *
 * Owns the single useReducer, resolves the current route to a screen, mounts
 * global overlays (new-chat sheet, call) and the tab bar. Screens are pure
 * functions of state; this file only routes and composes.
 */
import { useMemo, useReducer } from 'react';
import { Button, IconButton } from '@peers-touch/ui';
import type { IconId } from '@peers-touch/ui';
import { createInitialState, resolveConversation } from './model';
import type { AppState, TabId } from './model';
import { reducer, tabBarVisible, type Action } from './state';
import { ActionSheet, StatusBar } from './primitives';
import { CallScreen } from './CallScreen';
import {
  AboutScreen, AgentReservedScreen, ChatsScreen, ContactDetailScreen, GroupDetailScreen,
  MeScreen, MomentsScreen, SearchScreen, SignedOutScreen, StationScreen, ThreadScreen,
} from './screens';

const TABS: { id: TabId; label: string; icon: IconId }[] = [
  { id: 'chats', label: '消息', icon: 'message-circle' },
  { id: 'agent', label: 'Agent', icon: 'bot' },
  { id: 'moments', label: '动态', icon: 'image' },
  { id: 'me', label: '我的', icon: 'circle-user' },
];

function resolveScreen(state: AppState, dispatch: (a: Action) => void) {
  if (state.searchOpen) return <SearchScreen state={state} dispatch={dispatch} />;
  const { route } = state;

  if (route.tab === 'chats') {
    // A pushed contact/group detail takes precedence over the catalog.
    if (route.contactDetail) {
      const { kind, id } = route.contactDetail;
      if (kind === 'person') {
        const p = state.people.find(x => x.id === id);
        if (p) return <ContactDetailScreen person={p} state={state} dispatch={dispatch} />;
      } else {
        const g = state.groups.find(x => x.id === id);
        if (g) return <GroupDetailScreen group={g} state={state} dispatch={dispatch} />;
      }
    }
    const conv = route.conversationId ? resolveConversation(state, route.conversationId) : undefined;
    if (conv) return <ThreadScreen state={state} dispatch={dispatch} conversation={conv} />;
    return <ChatsScreen state={state} dispatch={dispatch} />;
  }
  if (route.tab === 'moments') return <MomentsScreen state={state} dispatch={dispatch} />;
  if (route.tab === 'agent') return <AgentReservedScreen />;
  if (route.tab === 'me') {
    if (route.setting === 'station') return <StationScreen state={state} dispatch={dispatch} />;
    if (route.setting === 'about') return <AboutScreen state={state} dispatch={dispatch} />;
    return <MeScreen state={state} dispatch={dispatch} />;
  }
  return null;
}

export function MobileAppView() {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);
  const unread = useMemo(() => state.conversations.reduce((sum, c) => sum + c.unread, 0), [state.conversations]);
  const activeTab: TabId = state.route.tab;
  const showTabBar = tabBarVisible(state) && !state.searchOpen && !state.newChatOpen;

  // Signed-out gate replaces the whole product (no tabs, sheets, or calls).
  if (state.signedOut) {
    return (
      <div className="ma-root">
        <StatusBar />
        <div className="ma-body"><SignedOutScreen state={state} dispatch={dispatch} /></div>
      </div>
    );
  }

  return (
    <div className="ma-root">
      <StatusBar />
      <div className="ma-body">{resolveScreen(state, dispatch)}</div>

      {showTabBar && (
        <nav className="ma-tabbar" aria-label="主导航">
          {TABS.map(item => (
            <span key={item.id} className={`ma-tab${activeTab === item.id ? ' active' : ''}`}>
              <span className="ma-tab-icon">
                <IconButton actionId={`ma.tab.${item.id}`} iconId={item.icon} iconSize={23}
                  label={item.label} aria-current={activeTab === item.id ? 'page' : undefined}
                  emphasis="quiet"
                  onActivate={() => dispatch({ type: 'tab', tab: item.id })} />
                {item.id === 'chats' && unread > 0 && <span className="ma-badge" aria-hidden="true">{unread}</span>}
              </span>
              <span className="ma-tab-label" aria-hidden="true">{item.label}</span>
            </span>
          ))}
        </nav>
      )}

      <ActionSheet title="发起" open={state.newChatOpen} onClose={() => dispatch({ type: 'newChat/close' })}
        actions={[
          { id: 'ma.sheet.new-group', label: '创建群聊', onActivate: () => { dispatch({ type: 'newChat/close' }); dispatch({ type: 'tab', tab: 'chats' }); } },
          { id: 'ma.sheet.add-contact', label: '添加联系人', onActivate: () => { dispatch({ type: 'newChat/close' }); dispatch({ type: 'tab', tab: 'chats' }); } },
        ]}>
        <Button actionId="ma.sheet.search" fullWidth emphasis="quiet" className="ma-sheet-action"
          onActivate={() => { dispatch({ type: 'newChat/close' }); dispatch({ type: 'search/open' }); }}>
          搜索并发起会话
        </Button>
      </ActionSheet>

      <CallScreen state={state} dispatch={dispatch} />
    </div>
  );
}
