import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Plus, RotateCw, X } from 'lucide-react';
import { Input, theme } from 'antd';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '../../../../store/chat';
import { resolveBrowserDeviceId, useBrowserSessionsStore } from '../../../../store/browserSessions';
import { useWorkbenchTabsStore } from '../../../../store/workbenchTabs';
import { BrowserViewport } from './BrowserViewport';

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

export function BrowserPanel({
  conversationId,
  deviceId,
}: {
  conversationId: string;
  deviceId: string;
}) {
  const { token } = theme.useToken();
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

  const [startUrl, setStartUrl] = useState('https://');
  const [addressDraft, setAddressDraft] = useState('');
  const [addressFocused, setAddressFocused] = useState(false);
  const [error, setError] = useState('');

  const session = sessions.find((candidate) => candidate.sessionId === activeSessionId) ?? null;
  const tab = session?.tabs.find((candidate) => candidate.tabId === activeTabId)
    ?? session?.tabs[0]
    ?? null;
  const frame = tab ? frameByTab[tab.tabId] ?? null : null;
  const isDraft = conversationId.startsWith('draft:');
  const addressValue = addressFocused ? addressDraft : (tab?.url ?? '');

  const run = async (label: string, fn: () => Promise<void>) => {
    setError('');
    try {
      await fn();
    } catch (actionError) {
      setError(`${label}: ${actionError instanceof Error ? actionError.message : String(actionError)}`);
    }
  };

  const iconButtonStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    border: 'none',
    borderRadius: 6,
    background: 'transparent',
    color: token.colorTextSecondary,
    cursor: 'pointer',
    flexShrink: 0,
  };

  return (
    <div
      data-pt-browser-panel
      style={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: token.colorBgLayout,
      }}
    >
      {!host?.available ? (
        <div data-pt-browser-unavailable style={{ color: token.colorTextSecondary, fontSize: 12, padding: 12 }}>
          {t('chat.browser.unavailable')}
        </div>
      ) : !session ? (
        <div
          data-pt-browser-start-form
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <Input
            data-pt-browser-start-url
            size="large"
            value={startUrl}
            onChange={(event) => setStartUrl(event.target.value)}
            placeholder="https://"
            disabled={isDraft}
            onPressEnter={() => {
              if (!startUrl.trim() || startUrl === 'https://') return;
              void run('start', async () => {
                await createSession({
                  conversationId,
                  deviceId,
                  initialUrl: withScheme(startUrl.trim()),
                });
              });
            }}
          />
          <button
            type="button"
            data-pt-browser-start
            disabled={isDraft || !startUrl.trim() || startUrl === 'https://'}
            onClick={() =>
              void run('start', async () => {
                await createSession({
                  conversationId,
                  deviceId,
                  initialUrl: withScheme(startUrl.trim()),
                });
              })
            }
            style={{
              border: 'none',
              borderRadius: 8,
              padding: '8px 24px',
              background: token.colorPrimary,
              color: '#fff',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {t('chat.browser.start')}
          </button>
          {isDraft ? (
            <div data-pt-browser-start-hint style={{ fontSize: 11, color: token.colorTextTertiary }}>
              {t('chat.browser.start.draftHint')}
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              padding: '4px 6px 0',
              flexShrink: 0,
            }}
          >
            {session.tabs.map((candidate) => {
              const selected = candidate.tabId === tab?.tabId;
              return (
                <div
                  key={candidate.tabId}
                  data-pt-browser-tab={candidate.tabId}
                  onClick={() => selectTab(conversationId, candidate.tabId)}
                  title={candidate.url}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    maxWidth: 180,
                    padding: '4px 8px',
                    borderRadius: '8px 8px 0 0',
                    cursor: 'pointer',
                    fontSize: 12,
                    color: selected ? token.colorText : token.colorTextSecondary,
                    background: selected ? token.colorBgContainer : 'transparent',
                  }}
                >
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {tabLabel(candidate.url, candidate.title)}
                  </span>
                  <X
                    size={12}
                    data-pt-browser-tab-close={candidate.tabId}
                    onClick={(event) => {
                      event.stopPropagation();
                      void run('close-tab', async () => {
                        const wasLast = session.tabs.length === 1;
                        await closeTab(conversationId, candidate.tabId);
                        if (wasLast) await removeSession(conversationId);
                      });
                    }}
                    style={{ opacity: 0.55, flexShrink: 0 }}
                  />
                </div>
              );
            })}
            <button
              type="button"
              aria-label={t('chat.browser.newTab')}
              data-pt-browser-new-tab
              onClick={() => void run('new-tab', () => openTab(conversationId))}
              style={{ ...iconButtonStyle, width: 26, height: 26 }}
            >
              <Plus size={14} />
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '6px 8px',
              background: token.colorBgContainer,
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              aria-label={t('chat.browser.back')}
              data-pt-browser-back
              style={iconButtonStyle}
              onClick={() => tab && void run('back', () => history(conversationId, tab.tabId, 'back'))}
            >
              <ArrowLeft size={16} />
            </button>
            <button
              type="button"
              aria-label={t('chat.browser.forward')}
              data-pt-browser-forward
              style={iconButtonStyle}
              onClick={() => tab && void run('forward', () => history(conversationId, tab.tabId, 'forward'))}
            >
              <ArrowRight size={16} />
            </button>
            <button
              type="button"
              aria-label={t('chat.browser.reload')}
              data-pt-browser-reload
              style={iconButtonStyle}
              onClick={() => tab && void run('reload', () => history(conversationId, tab.tabId, 'reload'))}
            >
              <RotateCw size={15} />
            </button>
            <Input
              data-pt-browser-url
              value={addressValue}
              onChange={(event) => setAddressDraft(event.target.value)}
              onFocus={(event) => {
                setAddressFocused(true);
                setAddressDraft(event.target.value);
              }}
              onBlur={() => {
                setAddressFocused(false);
                setAddressDraft('');
              }}
              placeholder={t('chat.browser.urlPlaceholder')}
              onPressEnter={(event) => {
                const target = (event.target as HTMLInputElement).value.trim();
                if (!tab || !target) return;
                void run('navigate', async () => {
                  await navigate(conversationId, tab.tabId, withScheme(target));
                  setAddressFocused(false);
                  setAddressDraft('');
                });
              }}
            />
            <button
              type="button"
              data-pt-browser-go
              style={{
                border: 'none',
                borderRadius: 6,
                padding: '0 14px',
                height: 28,
                background: token.colorPrimary,
                color: '#fff',
                cursor: 'pointer',
                fontSize: 12,
                flexShrink: 0,
              }}
              onClick={() => {
                if (!tab) return;
                const target = (addressDraft || tab.url || '').trim();
                if (!target) return;
                void run('navigate', () => navigate(conversationId, tab.tabId, withScheme(target)));
              }}
            >
              {t('chat.browser.go')}
            </button>
          </div>

          {error ? (
            <div data-pt-browser-error style={{ fontSize: 12, color: token.colorError, padding: '4px 10px', flexShrink: 0 }}>
              {error}
            </div>
          ) : null}

          {tab ? (
            <BrowserViewport key={tab.tabId} sessionId={session.sessionId} tabId={tab.tabId} frame={frame} />
          ) : null}
        </>
      )}
    </div>
  );
}

const EMPTY_SESSIONS: never[] = [];
