import { useEffect, useState } from 'react';
import type React from 'react';
import { Globe } from 'lucide-react';
import { Button, Input, theme } from 'antd';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '../../../../store/chat';
import {
  resolveBrowserDeviceId,
  useBrowserSessionsStore,
} from '../../../../store/browserSessions';

// TW-D6: entry for device-held browser sessions. The browser is a separate
// real CDP host, never the HTML artifact reader. When no host binary is
// verified on the device, the capability stays closed (fail-closed).
export function BrowserDock() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const conversationId = useChatStore((state) => state.currentSessionKey);
  const open = useBrowserSessionsStore((state) => state.open);
  const setOpen = useBrowserSessionsStore((state) => state.setOpen);
  const initConversation = useBrowserSessionsStore((state) => state.initConversation);
  const probeHost = useBrowserSessionsStore((state) => state.probeHost);
  const hostChecked = useBrowserSessionsStore((state) => state.hostChecked);
  const host = useBrowserSessionsStore((state) => state.host);
  const [deviceId, setDeviceId] = useState('');

  useEffect(() => {
    void probeHost();
  }, [probeHost]);

  useEffect(() => {
    if (!hostChecked || !host?.available) return;
    void resolveBrowserDeviceId().then(setDeviceId).catch(() => setDeviceId(''));
  }, [hostChecked, host]);

  useEffect(() => {
    if (!open || !conversationId || !deviceId || conversationId.startsWith('draft:')) return;
    void initConversation(conversationId, deviceId).catch(() => undefined);
  }, [open, conversationId, deviceId, initConversation]);

  if (!hostChecked) return null;

  return (
    <>
      <div
        data-pt-browser-dock
        style={{ position: 'absolute', right: 14, bottom: 58, zIndex: 2 }}
      >
        <Button
          data-pt-browser-toggle
          type={open ? 'primary' : 'default'}
          shape="circle"
          size="large"
          icon={<Globe size={16} />}
          onClick={() => setOpen(!open)}
          title={t('chat.browser.dock.title')}
          aria-label={t('chat.browser.dock.title')}
          style={{
            border: 0,
            background: open ? token.colorPrimary : token.colorFillQuaternary,
            color: open ? token.colorPrimaryText : token.colorTextSecondary,
          }}
        />
      </div>
      {open ? <BrowserPanel conversationId={conversationId ?? ''} deviceId={deviceId} /> : null}
    </>
  );
}

function BrowserPanel({
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
  const createSession = useBrowserSessionsStore((state) => state.createSession);
  const removeSession = useBrowserSessionsStore((state) => state.removeSession);
  const selectSession = useBrowserSessionsStore((state) => state.selectSession);
  const navigate = useBrowserSessionsStore((state) => state.navigate);
  const history = useBrowserSessionsStore((state) => state.history);
  const observe = useBrowserSessionsStore((state) => state.observe);
  const click = useBrowserSessionsStore((state) => state.click);
  const fill = useBrowserSessionsStore((state) => state.fill);
  const submit = useBrowserSessionsStore((state) => state.submit);
  const closeTab = useBrowserSessionsStore((state) => state.closeTab);
  const screenshot = useBrowserSessionsStore((state) => state.screenshot);
  const takeover = useBrowserSessionsStore((state) => state.takeover);
  const release = useBrowserSessionsStore((state) => state.release);
  const snapshotByTab = useBrowserSessionsStore((state) => state.snapshotByTab);

  const [startUrl, setStartUrl] = useState('https://example.com/');
  const [urlInput, setUrlInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [shot, setShot] = useState('');
  const [error, setError] = useState('');
  const [fillDraft, setFillDraft] = useState<Record<string, string>>({});

  const session = sessions.find((candidate) => candidate.sessionId === activeSessionId) ?? null;
  const tab = session?.tabs?.[0] ?? null;
  const snapshot = tab ? snapshotByTab[tab.tabId] : undefined;

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (actionError) {
      logBrowserError(label, actionError, setError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      title={t('chat.browser.panel.title')}
      onClose={() => useBrowserSessionsStore.getState().setOpen(false)}
      token={token}
    >
      {!host?.available ? (
        <div data-pt-browser-unavailable style={{ color: token.colorTextSecondary, fontSize: 12 }}>
          {t('chat.browser.unavailable')}
        </div>
      ) : !session ? (
        <div style={{ display: 'flex', gap: 4, width: '100%' }} data-pt-browser-start-form>
          <Input
            data-pt-browser-start-url
            value={startUrl}
            onChange={(event) => setStartUrl(event.target.value)}
            placeholder="https://"
          />
          <Button
            data-pt-browser-start
            type="primary"
            disabled={busy || conversationId.startsWith('draft:')}
            onClick={() =>
              run('start', async () => {
                await createSession({ conversationId, deviceId, initialUrl: startUrl || undefined });
              })
            }
          >
            {t('chat.browser.start')}
          </Button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div data-pt-browser-meta style={{ fontSize: 12, color: token.colorTextSecondary }}>
              <span data-pt-browser-status>{t(`chat.browser.status.${session.status}`)}</span>
              {' · '}
              <span data-pt-browser-lease>{t(`chat.browser.lease.${session.lease}`)}</span>
              {' · '}
              <span>{session.engine}</span>
            </div>
            <div style={{ display: 'flex', gap: 4, width: '100%' }}>
              <Button
                onClick={() => run('back', () => history(conversationId, tab!.tabId, 'back'))}
                disabled={busy || !tab}
              >
                ‹
              </Button>
              <Button
                onClick={() => run('reload', () => history(conversationId, tab!.tabId, 'reload'))}
                disabled={busy || !tab}
              >
                ⟳
              </Button>
              <Button
                onClick={() => run('forward', () => history(conversationId, tab!.tabId, 'forward'))}
                disabled={busy || !tab}
              >
                ›
              </Button>
              <Input
                data-pt-browser-url
                value={urlInput || tab?.url || ''}
                onChange={(event) => setUrlInput(event.target.value)}
                placeholder={t('chat.browser.urlPlaceholder')}
              />
              <Button
                data-pt-browser-go
                type="primary"
                disabled={busy || !tab || session.lease !== 'agent'}
                onClick={() =>
                  run('navigate', () =>
                    navigate(conversationId, tab!.tabId, withScheme(urlInput || tab?.url || '')),
                  ).then(() => setUrlInput(''))
                }
              >
                {t('chat.browser.go')}
              </Button>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Button
                data-pt-browser-observe
                size="small"
                disabled={busy || !tab || session.lease !== 'agent'}
                onClick={() => run('observe', async () => {
                  await observe(conversationId, tab!.tabId);
                })}
              >
                {t('chat.browser.observe')}
              </Button>
              <Button
                data-pt-browser-screenshot
                size="small"
                disabled={busy || !tab || session.lease !== 'agent'}
                onClick={() =>
                  run('screenshot', async () => {
                    setShot(await screenshot(conversationId, tab!.tabId));
                  })
                }
              >
                {t('chat.browser.screenshot')}
              </Button>
              {session.lease === 'agent' ? (
                <Button
                  data-pt-browser-takeover
                  size="small"
                  danger
                  // Takeover must always be clickable: a human can pause the
                  // agent even while an agent operation is in flight.
                  onClick={() => run('takeover', () => takeover(conversationId))}
                >
                  {t('chat.browser.takeover')}
                </Button>
              ) : (
                <Button
                  data-pt-browser-release
                  size="small"
                  type="primary"
                  disabled={busy}
                  onClick={() => run('release', () => release(conversationId))}
                >
                  {t('chat.browser.release')}
                </Button>
              )}
              <Button
                size="small"
                disabled={busy || !tab}
                onClick={() => run('close-tab', () => closeTab(conversationId, tab!.tabId))}
              >
                {t('chat.browser.closeTab')}
              </Button>
              <Button
                data-pt-browser-remove
                size="small"
                disabled={busy}
                onClick={() => run('remove', () => removeSession(conversationId))}
              >
                {t('chat.browser.remove')}
              </Button>
            </div>
            {error ? (
              <div data-pt-browser-error style={{ fontSize: 12, color: token.colorError }}>
                {error}
              </div>
            ) : null}
            {snapshot ? (
              <div data-pt-browser-snapshot style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div
                  data-pt-browser-snapshot-url
                  data-viewport={JSON.stringify(snapshot.viewport)}
                  style={{ fontSize: 11, color: token.colorTextQuaternary }}
                >
                  g{snapshot.tab.generation} · {snapshot.tab.url}
                </div>
                <div
                  data-pt-browser-elements
                  style={{
                    maxHeight: 200,
                    overflowY: 'auto',
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: 6,
                    padding: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  {snapshot.elements.map((element) => (
                    <div
                      key={element.ref}
                      data-pt-browser-element={element.ref}
                      data-x={element.x}
                      data-y={element.y}
                      data-width={element.width}
                      data-height={element.height}
                      style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}
                    >
                      <span style={{ color: token.colorTextQuaternary, minWidth: 90 }}>
                        {element.tag}
                        {element.inputType ? `:${element.inputType}` : ''}
                      </span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {element.name}
                      </span>
                      {editableTag(element) ? (
                        <>
                          <Input
                            data-pt-browser-fill-input
                            size="small"
                            style={{ width: 120 }}
                            value={fillDraft[element.ref] ?? ''}
                            onChange={(event) =>
                              setFillDraft((previous) => ({
                                ...previous,
                                [element.ref]: event.target.value,
                              }))
                            }
                          />
                          <Button
                            data-pt-browser-fill
                            size="small"
                            disabled={session.lease !== 'agent'}
                            onClick={() =>
                              run('fill', () =>
                                fill(
                                  conversationId,
                                  tab!.tabId,
                                  element.ref,
                                  fillDraft[element.ref] ?? '',
                                ),
                              )
                            }
                          >
                            {t('chat.browser.fill')}
                          </Button>
                        </>
                      ) : null}
                      <Button
                        data-pt-browser-click
                        size="small"
                        disabled={session.lease !== 'agent'}
                        onClick={() => run('click', () => click(conversationId, tab!.tabId, element.ref))}
                      >
                        {t('chat.browser.click')}
                      </Button>
                      {element.tag === 'input' && element.inputType !== 'button' ? null : (
                        <Button
                          data-pt-browser-submit
                          size="small"
                          type="primary"
                          disabled={session.lease !== 'agent'}
                          onClick={() => run('submit', () => submit(conversationId, tab!.tabId, element.ref))}
                        >
                          {t('chat.browser.submit')}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
                <pre
                  data-pt-browser-text
                  style={{
                    margin: 0,
                    maxHeight: 160,
                    overflow: 'auto',
                    fontSize: 11,
                    background: token.colorFillQuaternary,
                    borderRadius: 6,
                    padding: 8,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {snapshot.text.slice(0, 4000)}
                </pre>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
                {t('chat.browser.observeHint')}
              </div>
            )}
            {shot ? (
              <img
                data-pt-browser-screenshot-img
                src={shot}
                alt="browser screenshot"
                style={{ maxWidth: '100%', borderRadius: 6, border: `1px solid ${token.colorBorderSecondary}` }}
              />
            ) : null}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {sessions.map((candidate) => (
                <Button
                  key={candidate.sessionId}
                  data-pt-browser-session={candidate.sessionId}
                  data-pt-browser-session-status={candidate.status}
                  size="small"
                  type={candidate.sessionId === activeSessionId ? 'primary' : 'default'}
                  onClick={() => selectSession(conversationId, candidate.sessionId)}
                >
                  {candidate.sessionId.slice(-6)}
                </Button>
              ))}
            </div>
          </div>
        </>
      )}
    </Drawer>
  );
}

const EMPTY_SESSIONS: never[] = [];

function editableTag(element: { tag: string; inputType: string }): boolean {
  return (
    element.tag === 'textarea'
    || element.tag === 'select'
    || (element.tag === 'input'
      && !['button', 'submit', 'checkbox', 'radio', 'reset'].includes(element.inputType))
  );
}

function withScheme(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `http://${url}`;
}

function logBrowserError(
  label: string,
  error: unknown,
  setError: (message: string) => void,
): void {
  const message = error instanceof Error ? error.message : String(error);
  setError(`${label}: ${message}`);
}

// Local layout primitives keep the dock dependency-light.
function Drawer({
  title,
  onClose: _onClose,
  token,
  children,
}: {
  title: string;
  onClose: () => void;
  token: { colorBgContainer: string; colorBorderSecondary: string; colorText: string };
  children: React.ReactNode;
}) {
  return (
    <div
      data-pt-browser-panel
      style={{
        position: 'absolute',
        right: 14,
        bottom: 100,
        zIndex: 3,
        width: 520,
        maxHeight: '70vh',
        display: 'flex',
        flexDirection: 'column',
        background: token.colorBgContainer,
        borderRadius: 10,
        boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
        border: `1px solid ${token.colorBorderSecondary}`,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          fontWeight: 600,
          fontSize: 14,
          color: token.colorText,
        }}
      >
        {title}
      </div>
      <div style={{ padding: 12, overflowY: 'auto' }}>{children}</div>
    </div>
  );
}
