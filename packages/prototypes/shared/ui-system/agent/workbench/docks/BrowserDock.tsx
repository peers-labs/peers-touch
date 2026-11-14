/**
 * BrowserDock — device-held browser session entry.
 *
 * Parity with production BrowserDock/BrowserPanel: the browser is a separate
 * real CDP host, never the HTML artifact reader, so the capability stays
 * fail-closed when no host is verified. With a host and no session it shows a
 * start form; with a session it renders a tab strip, navigation bar with
 * address history, and a seeded viewport placeholder. No page content is
 * fabricated beyond a clearly-labelled render frame.
 */
import { useState } from 'react';
import {
  Alert, Button, Flex, Icon, IconButton, ScrollArea, Text, TextField,
} from '@peers-touch/ui';
import { makeTranslate, usePrefs } from '../../../prefs';
import type { BrowserSessionSeed, BrowserTabSeed } from '../types';

const DEFAULT_URL = 'https://';
// The prototype always probes a verified host in seed; the unavailable branch
// stays implemented to prove the fail-closed contract rather than mocked away.
const HOST_AVAILABLE = true;

function withScheme(url: string): string {
  const value = url.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(about|chrome):/i.test(value)) return value;
  return `http://${value}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function tabLabel(url: string, title: string): string {
  if (title) return title;
  if (!url || url === 'about:blank') return 'New tab';
  return hostOf(url);
}

let seq = 100;

export function BrowserDock() {
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);
  const [startUrl, setStartUrl] = useState(DEFAULT_URL);
  const [session, setSession] = useState<BrowserSessionSeed | null>(null);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [reloading, setReloading] = useState(false);

  const activeTab = session?.tabs.find(tab => tab.tabId === activeTabId) ?? session?.tabs[0] ?? null;
  const canStart = startUrl.trim().length > 0 && startUrl.trim() !== DEFAULT_URL;

  const startSession = () => {
    if (!canStart) return;
    const tab: BrowserTabSeed = {
      tabId: `btab-${(seq += 1)}`,
      title: '',
      url: withScheme(startUrl),
      history: [withScheme(startUrl)],
      historyIndex: 0,
    };
    const next: BrowserSessionSeed = { sessionId: `bsess-${seq}`, tabs: [tab], activeTabId: tab.tabId };
    setSession(next);
    setActiveTabId(tab.tabId);
    setAddress('');
  };

  const openTab = () => {
    if (!session) return;
    const tab: BrowserTabSeed = {
      tabId: `btab-${(seq += 1)}`, title: '', url: 'about:blank',
      history: ['about:blank'], historyIndex: 0,
    };
    setSession({ ...session, tabs: [...session.tabs, tab] });
    setActiveTabId(tab.tabId);
  };

  const closeTab = (tabId: string) => {
    if (!session) return;
    const remaining = session.tabs.filter(tab => tab.tabId !== tabId);
    if (remaining.length === 0) {
      setSession(null);
      setActiveTabId(null);
      return;
    }
    const nextActive = tabId === activeTabId ? remaining[remaining.length - 1].tabId : activeTabId;
    setSession({ ...session, tabs: remaining });
    setActiveTabId(nextActive);
  };

  const mutateActive = (mutate: (tab: BrowserTabSeed) => BrowserTabSeed) => {
    if (!session || !activeTab) return;
    setSession({
      ...session,
      tabs: session.tabs.map(tab => (tab.tabId === activeTab.tabId ? mutate(tab) : tab)),
    });
  };

  const navigate = (raw: string) => {
    const target = raw.trim();
    if (!target || !activeTab) return;
    const url = withScheme(target);
    mutateActive(tab => {
      const history = [...tab.history.slice(0, tab.historyIndex + 1), url];
      return { ...tab, url, title: hostOf(url), history, historyIndex: history.length - 1 };
    });
    setAddress('');
  };

  const walkHistory = (direction: -1 | 1) => {
    if (!activeTab) return;
    const nextIndex = activeTab.historyIndex + direction;
    if (nextIndex < 0 || nextIndex >= activeTab.history.length) return;
    mutateActive(tab => ({ ...tab, historyIndex: nextIndex, url: tab.history[nextIndex] }));
  };

  const reload = () => {
    setReloading(true);
    window.setTimeout(() => setReloading(false), 400);
  };

  if (!HOST_AVAILABLE) {
    return (
      <div className="pa-wb-dock" data-pt-wb-browser-unavailable>
        <Alert tone="warning" title={t('agent.wb.browser.unavailable')}
          description={t('agent.wb.browser.unavailableDesc')} />
      </div>
    );
  }

  if (!session) {
    return (
      <Flex direction="column" align="center" justify="center" gap={10}
        className="pa-wb-dock pa-wb-browser__start" data-pt-wb-browser-start-form>
        <Icon iconId="globe" size={28} className="pa-wb-browser__globe" />
        <TextField
          frameClassName="pa-wb-browser__start-field"
          value={startUrl}
          aria-label={t('agent.wb.browser.urlPlaceholder')}
          placeholder="https://"
          data-pt-wb-browser-start-url
          onValueChange={setStartUrl}
          onEnter={startSession}
        />
        <Button actionId="wb.browser.start" emphasis="primary"
          label={t('agent.wb.browser.start')} data-pt-wb-browser-start
          availability={canStart ? undefined : { kind: 'disabled', reason: t('agent.wb.browser.urlPlaceholder') }}
          onActivate={startSession} />
      </Flex>
    );
  }

  const canBack = (activeTab?.historyIndex ?? 0) > 0;
  const canForward = activeTab ? activeTab.historyIndex < activeTab.history.length - 1 : false;

  return (
    <div className="pa-wb-dock pa-wb-browser" data-pt-wb-browser-panel>
      <Flex direction="row" align="center" gap={2} className="pa-wb-browser__tabs">
        <ScrollArea className="pa-wb-browser__tab-scroll">
          {session.tabs.map(tab => (
            <Flex key={tab.tabId} direction="row" align="center"
              className="pa-wb-browser__tab-wrap" data-pt-wb-browser-tab={tab.tabId}>
              <Button
                actionId={`wb.browser.tab.${tab.tabId}`}
                emphasis="quiet"
                density="compact"
                className="pa-wb-browser__tab"
                aria-current={tab.tabId === activeTab?.tabId ? 'page' : undefined}
                title={tab.url}
                onActivate={() => setActiveTabId(tab.tabId)}
              >
                <span className="pa-wb-browser__tab-label">{tabLabel(tab.url, tab.title)}</span>
              </Button>
              <IconButton actionId={`wb.browser.tab-close.${tab.tabId}`} iconId="close" iconSize={12}
                label={t('agent.common.cancel')} emphasis="quiet" density="compact"
                data-pt-wb-browser-tab-close={tab.tabId} onActivate={() => closeTab(tab.tabId)} />
            </Flex>
          ))}
        </ScrollArea>
        <IconButton actionId="wb.browser.new-tab" iconId="plus" iconSize={14}
          label={t('agent.wb.browser.newTab')} emphasis="quiet" density="compact"
          data-pt-wb-browser-new-tab onActivate={openTab} />
      </Flex>

      <Flex direction="row" align="center" gap={4} className="pa-wb-browser__navbar">
        <IconButton actionId="wb.browser.back" iconId="arrow-left" iconSize={16}
          label={t('agent.wb.browser.back')} emphasis="quiet"
          data-pt-wb-browser-back
          availability={canBack ? undefined : { kind: 'disabled', reason: t('agent.wb.browser.back') }}
          onActivate={() => walkHistory(-1)} />
        <IconButton actionId="wb.browser.forward" iconId="arrow-right" iconSize={16}
          label={t('agent.wb.browser.forward')} emphasis="quiet"
          data-pt-wb-browser-forward
          availability={canForward ? undefined : { kind: 'disabled', reason: t('agent.wb.browser.forward') }}
          onActivate={() => walkHistory(1)} />
        <IconButton actionId="wb.browser.reload" iconId="rotate-cw" iconSize={15}
          label={t('agent.wb.browser.reload')} emphasis="quiet"
          data-pt-wb-browser-reload onActivate={reload} />
        <TextField
          frameClassName="pa-wb-browser__navbar-field"
          value={address || activeTab?.url || ''}
          aria-label={t('agent.wb.browser.urlPlaceholder')}
          placeholder={t('agent.wb.browser.urlPlaceholder')}
          data-pt-wb-browser-url
          onValueChange={setAddress}
          onEnter={event => { event.preventDefault(); navigate(address); }}
        />
        <Button actionId="wb.browser.go" emphasis="primary" density="compact"
          label={t('agent.wb.browser.go')} data-pt-wb-browser-go
          onActivate={() => navigate(address || activeTab?.url || '')} />
      </Flex>

      <ScrollArea className="pa-wb-browser__viewport" data-pt-wb-browser-viewport data-reloading={reloading || undefined}>
        <Flex direction="column" align="center" justify="center" gap={6} className="pa-wb-browser__frame">
          <Icon iconId="monitor" size={26} className="pa-wb-browser__frame-icon" />
          <Text strong>{hostOf(activeTab?.url ?? '')}</Text>
          <Text tone="secondary" className="pa-wb-browser__frame-url">{activeTab?.url}</Text>
          <Text tone="muted" className="pa-wb-browser__frame-hint">{t('agent.wb.browser.frameHint')}</Text>
        </Flex>
      </ScrollArea>
    </div>
  );
}
