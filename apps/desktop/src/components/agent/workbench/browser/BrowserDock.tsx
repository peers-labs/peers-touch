import { useEffect, useRef, useState } from 'react';
import { Button, Input, theme } from 'antd';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '../../../../store/chat';
import {
  resolveBrowserDeviceId,
  useBrowserSessionsStore,
} from '../../../../store/browserSessions';
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
  const takeover = useBrowserSessionsStore((state) => state.takeover);
  const release = useBrowserSessionsStore((state) => state.release);
  const snapshotByTab = useBrowserSessionsStore((state) => state.snapshotByTab);
  const screenshotByTab = useBrowserSessionsStore((state) => state.screenshotByTab);

  const [startUrl, setStartUrl] = useState('https://example.com/');
  const [urlInput, setUrlInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');
  const [fillDraft, setFillDraft] = useState<Record<string, string>>({});

  const session = sessions.find((candidate) => candidate.sessionId === activeSessionId) ?? null;
  const tab = session?.tabs?.[0] ?? null;
  const snapshot = tab ? snapshotByTab[tab.tabId] : undefined;
  const viewportShot = tab ? screenshotByTab[tab.tabId] ?? null : null;
  const isDraft = conversationId.startsWith('draft:');

  // Fallback frame pull: the create-time observe can finish before the page
  // paints (or its state gets replaced by a later release/init), so whenever
  // the panel holds an active tab without a frame, observe once on mount.
  // The lease is part of the key: release invalidates frames, so regaining
  // agent control pulls a fresh generation instead of leaving an empty view.
  const attemptedFrameRef = useRef<string>('');
  useEffect(() => {
    if (!tab || session?.lease !== 'agent' || viewportShot) return;
    const key = `${session?.sessionId}:${tab.tabId}:${session.lease}`;
    if (attemptedFrameRef.current === key) return;
    attemptedFrameRef.current = key;
    const timer = setTimeout(() => {
      void observe(conversationId, tab.tabId).catch(() => undefined);
    }, 1500);
    return () => clearTimeout(timer);
  }, [tab, session, viewportShot, observe, conversationId]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    setBusyAction(label);
    setError('');
    try {
      await fn();
    } catch (actionError) {
      logBrowserError(label, actionError, setError);
    } finally {
      setBusy(false);
      setBusyAction('');
    }
  };

  return (
    <div
      data-pt-browser-panel
      style={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        // Match the WorkbenchPanel tab header rhythm so the URL row aligns
        // with the tab label instead of sitting flush on the panel edge.
        padding: '8px 10px 10px',
      }}
    >
      {!host?.available ? (
        <div data-pt-browser-unavailable style={{ color: token.colorTextSecondary, fontSize: 12 }}>
          {t('chat.browser.unavailable')}
        </div>
      ) : !session ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} data-pt-browser-start-form>
          <div style={{ display: 'flex', gap: 4, width: '100%' }}>
            <Input
              data-pt-browser-start-url
              value={startUrl}
              onChange={(event) => setStartUrl(event.target.value)}
              placeholder="https://"
              disabled={isDraft}
            />
            <Button
              data-pt-browser-start
              type="primary"
              disabled={busy || isDraft}
              onClick={() =>
                run('start', async () => {
                  await createSession({ conversationId, deviceId, initialUrl: startUrl || undefined });
                })
              }
            >
              {t('chat.browser.start')}
            </Button>
          </div>
          {isDraft ? (
            <div data-pt-browser-start-hint style={{ fontSize: 11, color: token.colorTextTertiary }}>
              {t('chat.browser.start.draftHint')}
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
            <div data-pt-browser-meta style={{ fontSize: 12, color: token.colorTextSecondary }}>
              <span data-pt-browser-status>{t(`chat.browser.status.${session.status}`)}</span>
              {' · '}
              <span data-pt-browser-lease>{t(`chat.browser.lease.${session.lease}`)}</span>
              {' · '}
              <span>{session.engine}</span>
            </div>
            {(busyAction === 'takeover' || busyAction === 'release') && (
              <div
                data-pt-browser-lease-switching
                style={{ fontSize: 12, color: token.colorPrimary }}
              >
                {busyAction === 'takeover'
                  ? t('chat.browser.takeover.preparing')
                  : t('chat.browser.release.preparing')}
              </div>
            )}
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
                    await observe(conversationId, tab!.tabId);
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
          </div>

          {error ? (
            <div
              data-pt-browser-error
              style={{ fontSize: 12, color: token.colorError, flexShrink: 0 }}
            >
              {error}
            </div>
          ) : null}

          <BrowserViewport
            snapshot={snapshot}
            screenshot={viewportShot}
            busy={busy}
            agentLease={session.lease === 'agent'}
            onHotspotClick={(ref) =>
              run('click', () => click(conversationId, tab!.tabId, ref))
            }
          />

          {snapshot ? (
            <div
              data-pt-browser-snapshot
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                flexShrink: 0,
              }}
            >
              <div
                data-pt-browser-snapshot-url
                data-viewport={JSON.stringify(snapshot.viewport)}
                style={{
                  fontSize: 11,
                  color: token.colorTextQuaternary,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                g{snapshot.tab.generation} · {snapshot.tab.url}
              </div>
              <div
                data-pt-browser-elements
                style={{
                  maxHeight: 140,
                  overflowY: 'auto',
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: 6,
                  padding: 6,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  background: token.colorBgContainer,
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
                    maxHeight: 120,
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
            ) : null}

            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flexShrink: 0 }}>
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
          </>
        )}
    </div>
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
