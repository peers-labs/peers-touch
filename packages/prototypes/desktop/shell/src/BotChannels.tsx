import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Bot,
  Check,
  Copy,
  KeyRound,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import './BotChannels.css';

type BotState = 'active' | 'disabled' | 'revoked';

type RegistryBot = {
  id: string;
  name: string;
  publishingId: string;
  state: BotState;
  rateLimitPerMinute: number;
  avatarName: string | null;
};

type CredentialReveal = {
  title: string;
  secret: string;
  ingressUrl?: string;
};

const storageKey = 'peers.prototype.registry-bots.v1';

const initialBots: RegistryBot[] = [
  {
    id: 'bot-build',
    name: 'Build Bot',
    publishingId: 'program/build',
    state: 'active',
    rateLimitPerMinute: 60,
    avatarName: null,
  },
  {
    id: 'bot-release',
    name: 'Release Bot',
    publishingId: 'program/release',
    state: 'disabled',
    rateLimitPerMinute: 30,
    avatarName: null,
  },
];

function loadBots() {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (!Array.isArray(parsed)) return initialBots;
    return parsed.filter((item): item is RegistryBot => (
      item &&
      typeof item === 'object' &&
      typeof item.id === 'string' &&
      typeof item.name === 'string' &&
      typeof item.publishingId === 'string' &&
      ['active', 'disabled', 'revoked'].includes(item.state) &&
      typeof item.rateLimitPerMinute === 'number'
    ));
  } catch {
    return initialBots;
  }
}

function createSecret() {
  return `ptb_${crypto.randomUUID().replace(/-/g, '').slice(0, 28)}`;
}

function createPublishingId(name: string, bots: RegistryBot[]) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'bot';
  let candidate = `program/${base}`;
  let suffix = 2;
  while (bots.some((bot) => bot.publishingId === candidate)) {
    candidate = `program/${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function State({ value }: { value: BotState }) {
  return <span className={`pt-bots-state pt-bots-state--${value}`}>{value[0].toUpperCase() + value.slice(1)}</span>;
}

function Modal({
  title,
  children,
  onClose,
  footer,
  destructive = false,
  focusClose = true,
  returnFocus,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer: ReactNode;
  destructive?: boolean;
  focusClose?: boolean;
  returnFocus?: HTMLElement | null;
}) {
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const sourceFocus = useRef<HTMLElement | null>(
    returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null),
  );
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (focusClose) closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled])',
      ) ?? []);
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      const source = sourceFocus.current;
      if (source?.isConnected) window.requestAnimationFrame(() => source.focus());
    };
  }, [focusClose]);

  return (
    <div className="pt-bots-backdrop" role="presentation">
      <section ref={dialog} className="pt-bots-dialog" role="dialog" aria-modal="true" aria-labelledby="pt-bots-dialog-title">
        <header>
          <span className={destructive ? 'is-destructive' : ''}>{destructive ? <Trash2 size={18} /> : <Bot size={18} />}</span>
          <h2 id="pt-bots-dialog-title">{title}</h2>
          <button ref={closeButton} type="button" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="pt-bots-dialog__body">{children}</div>
        <footer>{footer}</footer>
      </section>
    </div>
  );
}

export function BotChannels() {
  const [bots, setBots] = useState(loadBots);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [avatarName, setAvatarName] = useState('');
  const [credentials, setCredentials] = useState<CredentialReveal | null>(null);
  const [rotating, setRotating] = useState<RegistryBot | null>(null);
  const [revoking, setRevoking] = useState<RegistryBot | null>(null);
  const [busyBotId, setBusyBotId] = useState<string | null>(null);
  const modalSource = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setLoading(false), 450);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(bots));
  }, [bots]);

  const curlSnippet = useMemo(() => {
    if (!credentials?.ingressUrl) return '';
    return `curl -X POST "$STATION_ORIGIN${credentials.ingressUrl}" \\
  -H "Authorization: Bearer ${credentials.secret}" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: <unique-id>" \\
  --data '{"content":{"text":{"text":"Build passed"}},"source_context":{"program":"ci"}}'`;
  }, [credentials]);

  function refresh() {
    setLoading(true);
    setNotice('');
    window.setTimeout(() => {
      setLoading(false);
      setNotice('Bot registry refreshed.');
    }, 500);
  }

  function closeModal(close: () => void) {
    close();
    const source = modalSource.current;
    if (source?.isConnected) window.requestAnimationFrame(() => source.focus());
  }

  function createBot() {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const publishingId = createPublishingId(trimmedName, bots);
    const nextBot: RegistryBot = {
      id: `bot-${crypto.randomUUID()}`,
      name: trimmedName,
      publishingId,
      state: 'active',
      rateLimitPerMinute: 60,
      avatarName: avatarName || null,
    };
    setBots((current) => [...current, nextBot]);
    setCreateOpen(false);
    setName('');
    setAvatarName('');
    setCredentials({
      title: 'Bot credentials',
      ingressUrl: `/v1/message-publishing/${publishingId}`,
      secret: createSecret(),
    });
  }

  function changeState(botId: string, state: BotState) {
    setBusyBotId(botId);
    window.setTimeout(() => {
      setBots((current) => current.map((bot) => bot.id === botId ? { ...bot, state } : bot));
      setBusyBotId(null);
      setNotice(state === 'active' ? 'Bot enabled.' : state === 'disabled' ? 'Bot disabled.' : 'Bot revoked permanently.');
    }, 350);
  }

  function rotateSecret() {
    if (!rotating) return;
    const name = rotating.name;
    setBusyBotId(rotating.id);
    window.setTimeout(() => {
      setBusyBotId(null);
      setRotating(null);
      setCredentials({
        title: 'New secret',
        secret: createSecret(),
      });
      setNotice(`${name}'s previous secret is no longer valid.`);
    }, 400);
  }

  function copy(value: string) {
    void navigator.clipboard?.writeText(value);
    setNotice('Copied.');
  }

  function updateAvatar(botId: string, file: File | undefined) {
    if (!file) return;
    setBusyBotId(botId);
    window.setTimeout(() => {
      setBots((current) => current.map((bot) => (
        bot.id === botId ? { ...bot, avatarName: file.name } : bot
      )));
      setBusyBotId(null);
      setNotice('Avatar updated.');
    }, 350);
  }

  return (
    <section className="pt-bots" data-testid="bots-product">
      <header className="pt-bots-header">
        <div>
          <span>Channels</span>
          <h1>Bots</h1>
        </div>
        <div>
          <button type="button" onClick={refresh} disabled={loading}><RefreshCw className={loading ? 'is-spinning' : ''} size={15} /> Refresh</button>
          <button
            type="button"
            className="is-primary"
            onClick={(event) => {
              modalSource.current = event.currentTarget;
              setCreateOpen(true);
            }}
          ><Plus size={15} /> Create bot</button>
        </div>
      </header>

      <main className="pt-bots-main">
        <header className="pt-bots-section-title">
          <span><Bot size={18} /></span>
          <div>
            <h2>Your bots</h2>
            <p>Bots are automated actors backed by the common message publishing channel.</p>
          </div>
        </header>

        {notice ? (
          <div className="pt-bots-notice" role="status">
            <Check size={15} />
            <span>{notice}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setNotice('')}><X size={14} /></button>
          </div>
        ) : null}

        {loading ? (
          <div className="pt-bots-loading" role="status"><RefreshCw className="is-spinning" size={18} /> Loading bots</div>
        ) : bots.length === 0 ? (
          <div className="pt-bots-empty">
            <Bot size={30} />
            <b>No bots yet</b>
            <button
              type="button"
              className="is-primary"
              onClick={(event) => {
                modalSource.current = event.currentTarget;
                setCreateOpen(true);
              }}
            ><Plus size={15} /> Create bot</button>
          </div>
        ) : (
          <div className="pt-bots-table" role="table" aria-label="Bots">
            <div className="pt-bots-table__header" role="row">
              <span role="columnheader">Bot</span>
              <span role="columnheader">State</span>
              <span role="columnheader">Rate limit/min</span>
              <span role="columnheader">Actions</span>
            </div>
            {bots.map((bot) => {
              const revoked = bot.state === 'revoked';
              const busy = busyBotId === bot.id;
              return (
                <div className="pt-bots-row" role="row" key={bot.id}>
                  <span className="pt-bots-row__identity" role="cell">
                    <span className="pt-bots-avatar">{bot.avatarName ? bot.name.slice(0, 2).toUpperCase() : <Bot size={17} />}</span>
                    <span><b>{bot.name}</b><small>{bot.publishingId}</small></span>
                  </span>
                  <span role="cell"><State value={bot.state} /></span>
                  <span className="pt-bots-row__rate" role="cell">{bot.rateLimitPerMinute}</span>
                  <span className="pt-bots-row__actions" role="cell">
                    <label className={revoked || busy ? 'is-disabled' : ''} title="Change avatar">
                      <Upload size={15} />
                      <span className="pt-bots-sr-only">Change avatar for {bot.name}</span>
                      <input
                        type="file"
                        accept="image/*"
                        disabled={revoked || busy}
                        onChange={(event) => updateAvatar(bot.id, event.target.files?.[0])}
                      />
                    </label>
                    <button
                      type="button"
                      title="Rotate secret"
                      aria-label={`Rotate secret for ${bot.name}`}
                      disabled={revoked || busy}
                      onClick={(event) => {
                        modalSource.current = event.currentTarget;
                        setRotating(bot);
                      }}
                    ><KeyRound size={15} /></button>
                    {bot.state === 'active' ? (
                      <button type="button" title="Disable" aria-label={`Disable ${bot.name}`} disabled={busy} onClick={() => changeState(bot.id, 'disabled')}><Pause size={15} /></button>
                    ) : bot.state === 'disabled' ? (
                      <button type="button" title="Enable" aria-label={`Enable ${bot.name}`} disabled={busy} onClick={() => changeState(bot.id, 'active')}><Play size={15} /></button>
                    ) : null}
                    {!revoked ? (
                      <button
                        type="button"
                        className="is-danger"
                        title="Revoke"
                        aria-label={`Revoke ${bot.name}`}
                        disabled={busy}
                        onClick={(event) => {
                          modalSource.current = event.currentTarget;
                          setRevoking(bot);
                        }}
                      ><Trash2 size={15} /></button>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {createOpen ? (
        <Modal
          title="Create a bot"
          focusClose={false}
          returnFocus={modalSource.current}
          onClose={() => closeModal(() => setCreateOpen(false))}
          footer={(
            <>
              <button type="button" onClick={() => closeModal(() => setCreateOpen(false))}>Cancel</button>
              <button type="button" className="is-primary" disabled={!name.trim()} onClick={createBot}>Generate channel &amp; secret</button>
            </>
          )}
        >
          <label className="pt-bots-field">
            <span>Bot name</span>
            <input autoFocus value={name} placeholder="e.g. Claude Code" onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="pt-bots-avatar-picker">
            <Upload size={15} />
            {avatarName || 'Avatar (optional)'}
            <input type="file" accept="image/*" onChange={(event) => setAvatarName(event.target.files?.[0]?.name ?? '')} />
          </label>
        </Modal>
      ) : null}

      {credentials ? (
        <Modal
          title={credentials.title}
          returnFocus={modalSource.current}
          onClose={() => closeModal(() => setCredentials(null))}
          footer={<button type="button" className="is-primary" onClick={() => closeModal(() => setCredentials(null))}>I saved it, done</button>}
        >
          <p className="pt-bots-once">Save these credentials now. The secret is shown only once.</p>
          {credentials.ingressUrl ? (
            <label className="pt-bots-field">
              <span>Message ingress URL (path)</span>
              <span className="pt-bots-copy-field">
                <input readOnly value={credentials.ingressUrl} />
                <button type="button" title="Copy ingress URL" aria-label="Copy ingress URL" onClick={() => copy(credentials.ingressUrl ?? '')}><Copy size={15} /></button>
              </span>
            </label>
          ) : null}
          <label className="pt-bots-field">
            <span>Secret, shown only once</span>
            <span className="pt-bots-copy-field">
              <input readOnly type="password" value={credentials.secret} />
              <button type="button" title="Copy secret" aria-label="Copy secret" onClick={() => copy(credentials.secret)}><Copy size={15} /></button>
            </span>
          </label>
          {curlSnippet ? (
            <div className="pt-bots-snippet">
              <span>Quick test (curl)</span>
              <pre>{curlSnippet}</pre>
              <button type="button" onClick={() => copy(curlSnippet)}><Copy size={14} /> Copy curl</button>
            </div>
          ) : null}
        </Modal>
      ) : null}

      {rotating ? (
        <Modal
          title="Rotate secret"
          destructive
          returnFocus={modalSource.current}
          onClose={() => closeModal(() => setRotating(null))}
          footer={(
            <>
              <button type="button" onClick={() => closeModal(() => setRotating(null))}>Cancel</button>
              <button type="button" className="is-danger-solid" onClick={rotateSecret}>Rotate now</button>
            </>
          )}
        >
          <p>Rotating the secret invalidates the current secret immediately. Update every publisher that sends to <b>{rotating.name}</b>.</p>
        </Modal>
      ) : null}

      {revoking ? (
        <Modal
          title="Revoke this bot?"
          destructive
          returnFocus={modalSource.current}
          onClose={() => closeModal(() => setRevoking(null))}
          footer={(
            <>
              <button type="button" onClick={() => closeModal(() => setRevoking(null))}>Cancel</button>
              <button
                type="button"
                className="is-danger-solid"
                onClick={() => {
                  changeState(revoking.id, 'revoked');
                  setRevoking(null);
                }}
              >
                Revoke
              </button>
            </>
          )}
        >
          <p>The secret for <b>{revoking.name}</b> is cleared and cannot be restored. This action cannot be undone.</p>
        </Modal>
      ) : null}
    </section>
  );
}
