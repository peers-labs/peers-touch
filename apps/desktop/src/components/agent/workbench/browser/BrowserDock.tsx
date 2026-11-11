import { useEffect, useState } from 'react';
import { Button, Icon, IconButton, TextField } from '@peers-touch/ui';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '../../../../store/chat';
import { resolveBrowserDeviceId, useBrowserSessionsStore } from '../../../../store/browserSessions';
import { useWorkbenchTabsStore } from '../../../../store/workbenchTabs';
import { BrowserViewport } from './BrowserViewport';
import './browser.css';

// TW-D6: entry for device-held browser sessions. The browser is a separate
// real CDP host, never the HTML artifact reader. When no host binary is
// verified on the device, the capability stays closed (fail-closed).
// Rendered as a tab inside the unified WorkbenchPanel.
export function BrowserDock() {
  const conversationId = useChatStore((state) => state.currentSessionKey);
  const active = useWorkbenchTabsStore((state) => state.active);
  const initConversation = useBrowserSessionsStore((state) => state.initConversation);
  const probeHost = useBrowserSessionsStore((state) => state.probeHost);
  const hostChecked = useBrowserSessionsStore((state) => state.hostChecked);
  const hostAvailable = useBrowserSessionsStore((state) => state.host?.available === true);
  const [deviceId, setDeviceId] = useState('');

  useEffect(() => {
    void probeHost();
  }, [probeHost]);

  useEffect(() => {
    if (!hostChecked || !hostAvailable) return;
    void resolveBrowserDeviceId().then(setDeviceId).catch(() => setDeviceId(''));
  }, [hostChecked, hostAvailable]);

  useEffect(() => {
    if (active !== 'browser' || !conversationId || !deviceId || conversationId.startsWith('draft:')) return;
    void initConversation(conversationId, deviceId).catch(() => undefined);
  }, [active, conversationId, deviceId, initConversation]);

  if (!hostChecked) return null;
  if (active !== 'browser') return null;
  return <BrowserPanel conversationId={conversationId ?? ''} deviceId={deviceId} />;
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function tabLabel(url: string, title: string): string {
  if (title) return title;
  if (!url || url === 'about:blank') return 'New tab';
  return hostFromUrl(url);
}

function withScheme(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (/^about:/i.test(url) || /^chrome:/i.test(url)) return url;
  return `http://${url}`;
}

// Conventional-browser navigation toolbar: back / forward / reload on the
// left, the address field fills the remaining width, then Go. The same chrome
// serves the start surface and live tabs, so the address bar never drops into
// a centered modal form.
function BrowserToolbar({
  address,
  placeholder,
  goLabel,
  addressAttr,
  goAttr,
  canNavigate,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onReload,
  onSubmit,
}: {
  address: string;
  placeholder: string;
  goLabel: string;
  addressAttr: string;
  goAttr: string;
  canNavigate: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onSubmit: (value: string) => void;
}) {
  const { t } = useTranslation('chat');
  const [draft, setDraft] = useState(address);
  const [focused, setFocused] = useState(false);

  // Keep the field in sync with the live tab url whenever the user is not
  // editing it; while focused the draft owns the input.
  useEffect(() => {
    if (!focused) setDraft(address);
  }, [address, focused]);

  const submit = () => {
    const target = draft.trim();
    if (!target || target === 'https://') return;
    onSubmit(target);
    setFocused(false);
  };

  return (
    <div className="wb-browser__toolbar">
      <div className="wb-browser__nav">
        <IconButton
          actionId="wb.browser.back"
          iconId="arrow-left"
          iconSize={16}
          label={t('chat.browser.back')}
          emphasis="quiet"
          data-pt-browser-back
          availability={canGoBack ? undefined : { kind: 'disabled', reason: t('chat.browser.back') }}
          onActivate={onBack}
        />
        <IconButton
          actionId="wb.browser.forward"
          iconId="arrow-right"
          iconSize={16}
          label={t('chat.browser.forward')}
          emphasis="quiet"
          data-pt-browser-forward
          availability={canGoForward ? undefined : { kind: 'disabled', reason: t('chat.browser.forward') }}
          onActivate={onForward}
        />
        <IconButton
          actionId="wb.browser.reload"
          iconId="refresh-cw"
          iconSize={15}
          label={t('chat.browser.reload')}
          emphasis="quiet"
          data-pt-browser-reload
          availability={canNavigate ? undefined : { kind: 'disabled', reason: t('chat.browser.reload') }}
          onActivate={onReload}
        />
      </div>
      <TextField
        className="wb-browser__address"
        value={focused ? draft : address}
        placeholder={placeholder}
        aria-label={placeholder}
        {...{ [addressAttr]: '' }}
        onFocus={() => {
          setDraft(address);
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
          setDraft(address);
        }}
        onValueChange={setDraft}
        onEnter={submit}
      />
      <Button
        actionId="wb.browser.go"
        className="wb-browser__go"
        emphasis="primary"
        availability={canNavigate ? undefined : { kind: 'disabled', reason: goLabel }}
        {...{ [goAttr]: '' }}
        onActivate={submit}
      >
        {goLabel}
      </Button>
    </div>
  );
}

export function BrowserPanel({
  conversationId,
  deviceId,
}: {
  conversationId: string;
  deviceId: string;
}) {
  const { t } = useTranslation('chat');
  const host = useBrowserSessionsStore((state) => state.host);
  const sessions = useBrowserSessionsStore((state) => state.sessionsByConversation[conversationId] ?? EMPTY_SESSIONS);
  const activeSessionId = useBrowserSessionsStore((state) => state.activeSessionByConversation[conversationId] ?? null);
  const activeTabId = useBrowserSessionsStore((state) => state.activeTabByConversation[conversationId] ?? null);
  const createSession = useBrowserSessionsStore((state) => state.createSession);
  const openTab = useBrowserSessionsStore((state) => state.openTab);
  const closeTab = useBrowserSessionsStore((state) => state.closeTab);
  const removeSession = useBrowserSessionsStore((state) => state.removeSession);
  const selectTab = useBrowserSessionsStore((state) => state.selectTab);
  const navigate = useBrowserSessionsStore((state) => state.navigate);
  const history = useBrowserSessionsStore((state) => state.history);
  const frameByTab = useBrowserSessionsStore((state) => state.frameByTab);

  const [error, setError] = useState('');

  const session = sessions.find((candidate) => candidate.sessionId === activeSessionId) ?? null;
  const tab = session?.tabs.find((candidate) => candidate.tabId === activeTabId)
    ?? session?.tabs[0]
    ?? null;
  const frame = tab ? frameByTab[tab.tabId] ?? null : null;
  const isDraft = conversationId.startsWith('draft:');

  const run = async (label: string, fn: () => Promise<void>) => {
    setError('');
    try {
      await fn();
    } catch (actionError) {
      setError(`${label}: ${actionError instanceof Error ? actionError.message : String(actionError)}`);
    }
  };

  if (!host?.available) {
    return (
      <div data-pt-browser-panel className="wb-browser">
        <div data-pt-browser-unavailable className="wb-browser__unavailable">
          <Icon iconId="globe" size={28} className="wb-browser__unavailable-icon" />
          <div className="wb-browser__unavailable-text">{t('chat.browser.unavailable')}</div>
        </div>
      </div>
    );
  }

  return (
    <div data-pt-browser-panel className="wb-browser">
      {session ? (
        <div className="wb-browser__tabstrip">
          {session.tabs.map((candidate) => {
            const selected = candidate.tabId === tab?.tabId;
            return (
              <div
                key={candidate.tabId}
                className="wb-browser__tab"
                data-pt-browser-tab={candidate.tabId}
                data-selected={selected}
                title={candidate.url}
                onClick={() => selectTab(conversationId, candidate.tabId)}
              >
                <span className="wb-browser__tab-label">{tabLabel(candidate.url, candidate.title)}</span>
                <IconButton
                  actionId={`wb.browser.tab-close.${candidate.tabId}`}
                  iconId="close"
                  iconSize={12}
                  label={`${tabLabel(candidate.url, candidate.title)} ×`}
                  emphasis="quiet"
                  density="compact"
                  {...{ 'data-pt-browser-tab-close': candidate.tabId }}
                  onActivate={(event) => {
                    event.stopPropagation();
                    void run('close-tab', async () => {
                      const wasLast = session.tabs.length === 1;
                      await closeTab(conversationId, candidate.tabId);
                      if (wasLast) await removeSession(conversationId);
                    });
                  }}
                />
              </div>
            );
          })}
          <IconButton
            actionId="wb.browser.new-tab"
            iconId="plus"
            iconSize={14}
            label={t('chat.browser.newTab')}
            emphasis="quiet"
            density="compact"
            data-pt-browser-new-tab
            onActivate={() => void run('new-tab', () => openTab(conversationId))}
          />
        </div>
      ) : null}

      {session && tab ? (
        <BrowserToolbar
          address={tab.url ?? ''}
          placeholder={t('chat.browser.urlPlaceholder')}
          goLabel={t('chat.browser.go')}
          addressAttr="data-pt-browser-url"
          goAttr="data-pt-browser-go"
          canNavigate
          canGoBack
          canGoForward
          onBack={() => void run('back', () => history(conversationId, tab.tabId, 'back'))}
          onForward={() => void run('forward', () => history(conversationId, tab.tabId, 'forward'))}
          onReload={() => void run('reload', () => history(conversationId, tab.tabId, 'reload'))}
          onSubmit={(target) => void run('navigate', () => navigate(conversationId, tab.tabId, withScheme(target)))}
        />
      ) : (
        <div data-pt-browser-start-form>
          <BrowserToolbar
            address="https://"
            placeholder="https://"
            goLabel={t('chat.browser.start')}
            addressAttr="data-pt-browser-start-url"
            goAttr="data-pt-browser-start"
            canNavigate={!isDraft}
            canGoBack={false}
            canGoForward={false}
            onBack={() => undefined}
            onForward={() => undefined}
            onReload={() => undefined}
            onSubmit={(target) =>
              void run('start', async () => {
                await createSession({
                  conversationId,
                  deviceId,
                  initialUrl: withScheme(target),
                });
              })
            }
          />
        </div>
      )}

      {error ? (
        <div data-pt-browser-error className="wb-browser__error">
          {error}
        </div>
      ) : null}

      {session && tab ? (
        <div className="wb-browser__viewport">
          <BrowserViewport key={tab.tabId} sessionId={session.sessionId} tabId={tab.tabId} frame={frame} />
        </div>
      ) : (
        <div className="wb-browser__start">
          {isDraft ? (
            <div data-pt-browser-start-hint className="wb-browser__start-hint">
              {t('chat.browser.start.draftHint')}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

const EMPTY_SESSIONS: never[] = [];
