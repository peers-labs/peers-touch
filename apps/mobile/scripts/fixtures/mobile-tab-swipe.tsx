import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { UIProvider, useMobileTabSwipe } from '@peers-touch/ui';
import { MobileNavigationHost } from '../../src/components/MobileNavigationHost';
import {
  primaryTabDescriptors, registerSettingsExitGuard, requestSettingsExit,
  useMobileNavigationStore, type MobilePrimaryRouteId,
} from '../../src/app/navigation';
import { MobileApp } from '../../../../packages/prototypes/mobile/chat/src/MobileApp';
import '../../src/styles.css';

const tabs = primaryTabDescriptors.map(item => item.routeId as MobilePrimaryRouteId);
const observations = { changes: [] as string[], rowClicks: 0, blockedExits: 0 };
Object.assign(window, { mobileSwipeFixture: observations });

function Page({ route }: { route: string }) {
  const [draft, setDraft] = useState('');
  return <div data-swipe-page={route} style={{ height: '100%', overflowY: 'auto' }}>
    <label>Retained query<input aria-label={`${route} query`} value={draft}
      onChange={event => setDraft(event.target.value)} /></label>
    <div data-horizontal-scroll style={{ overflowX: 'auto', width: '100%', height: 64 }}>
      <div style={{ width: 900, height: 64 }}>Horizontal media rail</div>
    </div>
    <div data-mobile-swipe="exclude" style={{ height: 64 }}>Owned media gesture</div>
    {Array.from({ length: 55 }, (_, index) => <button key={index} data-swipe-row={index}
      style={{ display: 'block', width: '100%', height: 52 }}
      onClick={() => { observations.rowClicks += 1; }}>{route} conversation {index}</button>)}
  </div>;
}

function Fixture() {
  const root = useRef<HTMLDivElement>(null);
  const route = useMobileNavigationStore(state => state.primaryRouteId);
  const [detail, setDetail] = useState(false);
  const [guarded, setGuarded] = useState(false);
  const switchTab = useCallback((next: MobilePrimaryRouteId) => requestSettingsExit(() => {
    observations.changes.push(next);
    useMobileNavigationStore.getState().navigatePrimary(next);
  }), []);
  useEffect(() => guarded ? registerSettingsExitGuard(() => {
    observations.blockedExits += 1;
  }) : undefined, [guarded]);
  useMobileTabSwipe({ root, enabled: !detail, items: tabs, value: route, onValueChange: switchTab });
  return <UIProvider inputFocus="explicit">
    <nav>
      {tabs.map(tab => <button key={tab} onClick={() => switchTab(tab)}>{tab}</button>)}
      <button onClick={() => setDetail(value => !value)}>Toggle detail</button>
      <button onClick={() => setGuarded(value => !value)}>Toggle exit guard</button>
    </nav>
    <div ref={root} data-swipe-root data-route={route} style={{ height: 540 }}>
      <MobileNavigationHost primary={{ key: route, content: <Page route={route} /> }} />
    </div>
  </UIProvider>;
}

createRoot(document.getElementById('root')!).render(
  location.search.includes('prototype') ? <MobileApp /> : <Fixture />,
);
