/**
 * MobileAppView — host for the clean mobile product surface.
 *
 * Owns the single useReducer, resolves the current route to a screen, mounts
 * the call overlay and the tab bar. Screens are pure functions of state; this
 * file only routes and composes. All device chrome and overlay shapes are
 * @peers-touch/ui product primitives.
 */
import { useMemo, useReducer } from 'react';
import { MobileStatusBar, MobileTabBar } from '@peers-touch/ui';
import type { IconId } from '@peers-touch/ui';
import { createInitialState, resolveConversation } from './model';
import type { AppState, ProductScenario, TabId } from './model';
import { reducer, tabBarVisible, type Action } from './state';
import { CallScreen } from './CallScreen';
import {
  AboutScreen, ChatsScreen, ContactDetailScreen, CredentialsScreen, GroupDetailScreen,
  MeScreen, MomentsScreen, SignedOutScreen, StationScreen, ThreadScreen,
} from './screens';

// Mirrors the desktop outer rail (DesignDirections RAIL_NAV): the two social
// destinations then identity. The moments glyph is Sparkles on both surfaces.
// Search is never a tab or page — each surface's header icon expands in place
// into a local filter, exactly like the desktop rail.
const TABS: { id: TabId; label: string; icon: IconId }[] = [
  { id: 'chats', label: '消息', icon: 'message-circle' },
  { id: 'moments', label: '动态', icon: 'sparkles' },
  { id: 'me', label: '我的', icon: 'circle-user' },
];

function resolveScreen(state: AppState, dispatch: (a: Action) => void) {
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
  if (route.tab === 'me') {
    if (route.setting === 'credentials') return <CredentialsScreen state={state} dispatch={dispatch} />;
    if (route.setting === 'station') return <StationScreen state={state} dispatch={dispatch} />;
    if (route.setting === 'about') return <AboutScreen state={state} dispatch={dispatch} />;
    return <MeScreen state={state} dispatch={dispatch} />;
  }
  return null;
}

export function MobileAppView({ scenario = 'default' }: { scenario?: ProductScenario } = {}) {
  const [state, dispatch] = useReducer(reducer, scenario, createInitialState);
  const unread = useMemo(() => state.conversations.reduce((sum, c) => sum + c.unread, 0), [state.conversations]);
  const activeTab: TabId = state.route.tab;
  // Immersive cover belongs ONLY to the Me landing surface; pushed detail
  // pages (credentials/station/about) keep their own nav bar + in-flow bar.
  const immersive = state.route.tab === 'me' && !state.route.setting;
  // A bottom sheet physically covers the tab-bar strip; suppress the bar
  // while either messages or moments sheet is open (no chrome ghosting
  // through the frosted material).
  const sheetCoveringTabBar = state.chatsSheet !== 'none' || state.composerOpen;
  const showTabBar = tabBarVisible(state) && !sheetCoveringTabBar;

  // Signed-out gate replaces the whole product (no tabs, sheets, or calls).
  if (state.signedOut) {
    return (
      <div className="ma-root">
        <MobileStatusBar island time="9:41" carrier="5G" signalLevel={4} wifi battery={100} />
        <div className="ma-body"><SignedOutScreen state={state} dispatch={dispatch} /></div>
      </div>
    );
  }

  return (
    <div className="ma-root" data-tab={activeTab} data-immersive={immersive ? '' : undefined}>
      <MobileStatusBar island time="9:41" carrier="5G" signalLevel={4} wifi battery={100} />
      <div className="ma-body">{resolveScreen(state, dispatch)}</div>

      {showTabBar && (
        <MobileTabBar ariaLabel="主导航" value={activeTab}
          items={TABS.map(item => ({ ...item, badgeCount: item.id === 'chats' ? unread : undefined }))}
          onValueChange={id => dispatch({ type: 'tab', tab: id as TabId })} />
      )}

      <CallScreen state={state} dispatch={dispatch} />
    </div>
  );
}
