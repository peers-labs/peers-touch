/**
 * MobileAppView — host for the clean mobile product surface.
 *
 * Owns the single useReducer, resolves the current route to a screen, mounts
 * the call overlay and the tab bar. Screens are pure functions of state; this
 * file only routes and composes. All device chrome and overlay shapes are
 * @peers-touch/ui product primitives.
 */
import { Activity, useCallback, useMemo, useReducer, useRef, useState } from 'react';
import { MobileStatusBar, MobileTabBar, useMobileTabSwipe } from '@peers-touch/ui';
import type { IconId } from '@peers-touch/ui';
import { createInitialState, resolveConversation } from './model';
import type { AppState, ProductScenario, TabId } from './model';
import { reducer, tabBarVisible, type Action } from './state';
import { CallScreen } from './CallScreen';
import {
  AboutScreen, ChatsScreen, ContactDetailScreen, CredentialsScreen, FindPeopleScreen,
  GroupDetailScreen, MeScreen, MomentsScreen, SignedOutScreen, StationScreen, ThreadScreen,
} from './screens';

// User-confirmed shell: messages → moments → me. Chats and contacts share
// the messages header segmented control; existing app routes do not override it.
const TABS: { id: TabId; label: string; icon: IconId }[] = [
  { id: 'chats', label: '消息', icon: 'message-circle' },
  { id: 'moments', label: '动态', icon: 'sparkles' },
  { id: 'settings', label: '我的', icon: 'circle-user' },
];
const SWIPE_TABS = TABS.map(tab => tab.id);

function resolveScreen(state: AppState, dispatch: (a: Action) => void) {
  const { route } = state;

  if (route.tab === 'chats') {
    if (route.findPeople) return <FindPeopleScreen state={state} dispatch={dispatch} />;
    const conv = route.conversationId ? resolveConversation(state, route.conversationId) : undefined;
    if (conv) return <ThreadScreen state={state} dispatch={dispatch} conversation={conv} />;
    // Contact/group details are pushed within messages, above its two panes.
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
    return <ChatsScreen state={state} dispatch={dispatch} />;
  }
  if (route.tab === 'moments') return <MomentsScreen state={state} dispatch={dispatch} />;
  if (route.tab === 'settings') {
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
  const [visitedTabs, setVisitedTabs] = useState<readonly TabId[]>([activeTab]);
  if (!visitedTabs.includes(activeTab)) setVisitedTabs([...visitedTabs, activeTab]);
  const tabs = visitedTabs.includes(activeTab) ? visitedTabs : [...visitedTabs, activeTab];
  const detail = state.route.tab === 'chats'
    ? Boolean(state.route.findPeople || state.route.conversationId || state.route.contactDetail)
    : state.route.tab === 'settings' && Boolean(state.route.setting);
  const detailKey = state.route.tab === 'chats'
    ? state.route.findPeople ? 'find-people'
      : state.route.conversationId || state.route.contactDetail?.id
    : state.route.tab === 'settings' ? state.route.setting : undefined;
  // Immersive cover belongs ONLY to the settings landing surface; pushed detail
  // pages (credentials/station/about) keep their own nav bar + in-flow bar.
  const immersive = state.route.tab === 'settings' && !state.route.setting;
  // A bottom sheet physically covers the tab-bar strip; suppress the bar
  // while either messages or moments sheet is open (no chrome ghosting
  // through the frosted material).
  const sheetCoveringTabBar = state.chatsSheet !== 'none' || state.composerOpen;
  const showTabBar = tabBarVisible(state) && !sheetCoveringTabBar;
  const body = useRef<HTMLDivElement>(null);
  const switchTab = useCallback((tab: string) => dispatch({ type: 'tab', tab: tab as TabId }), []);
  useMobileTabSwipe({
    root: body, enabled: showTabBar && !detail && !state.signedOut,
    items: SWIPE_TABS, value: activeTab, onValueChange: switchTab,
  });

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
      <div className="ma-body" ref={body}>
        {tabs.map(tab => <Activity key={tab} mode={tab === activeTab && !detail ? 'visible' : 'hidden'}>
          <div className="ma-navigation-frame" data-ma-page={tab}>
            {resolveScreen({ ...state, route: { tab } }, dispatch)}
          </div>
        </Activity>)}
        {detail ? <div className="ma-navigation-frame" key={detailKey} data-ma-detail={detailKey}>
          {resolveScreen(state, dispatch)}
        </div> : null}
      </div>

      <div className="ma-tabbar-host" hidden={!showTabBar}>
        <MobileTabBar ariaLabel="主导航" value={activeTab}
          items={TABS.map(item => ({ ...item, badgeCount: item.id === 'chats' ? unread : undefined }))}
          onValueChange={switchTab} />
      </div>

      <CallScreen state={state} dispatch={dispatch} />
    </div>
  );
}
