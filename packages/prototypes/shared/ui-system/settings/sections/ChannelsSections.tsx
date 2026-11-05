/**
 * Channels-group sections (desktop Settings.tsx parity):
 * Bots (compressed registry manager) and Lark (provisioning wizard +
 * connected channel cards). All state is local and real.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Bot, Check, CheckCircle2, Clock3, Link2, Loader2, Plus, Radio, RefreshCw,
  ScanLine, ShieldCheck, Trash2,
} from 'lucide-react';
import {
  Alert, Button, Dialog, Segmented, Select, Switch, Tag, TextField,
} from '@peers-touch/ui';
import { makeTranslate, usePrefs, type StringKey, type Translate } from '../../prefs';
import { SettingsRow, SettingsSection } from '../SettingsPrimitives';
import '../settings.css';

function useT(): { t: Translate } {
  const prefs = usePrefs();
  return { t: makeTranslate(prefs.locale) };
}

/* ── Bots (compressed BotChannels parity) ────────────────────────────── */

type BotState = 'active' | 'disabled' | 'revoked';
interface RegistryBot {
  id: string;
  name: string;
  publishingId: string;
  state: BotState;
  rateLimitPerMinute: number;
}

const INITIAL_BOTS: RegistryBot[] = [
  { id: 'bot-build', name: 'Build Bot', publishingId: 'program/build', state: 'active', rateLimitPerMinute: 60 },
  { id: 'bot-release', name: 'Release Bot', publishingId: 'program/release', state: 'disabled', rateLimitPerMinute: 30 },
];

export function BotsSection() {
  const { t } = useT();
  const [bots, setBots] = useState<RegistryBot[]>(INITIAL_BOTS);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [rate, setRate] = useState('60');
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const patch = (id: string, p: Partial<RegistryBot>) =>
    setBots(list => list.map(bot => bot.id === id ? { ...bot, ...p } : bot));
  const create = () => {
    if (!name.trim()) return;
    const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bot';
    setBots(list => [...list, {
      id: `bot-${Date.now()}`, name: name.trim(),
      publishingId: `program/${base}`, state: 'active',
      rateLimitPerMinute: Number(rate) || 60,
    }]);
    setName(''); setRate('60'); setCreateOpen(false);
  };
  const stateKey = (s: BotState): StringKey =>
    s === 'active' ? 'bots.state.active' : s === 'disabled' ? 'bots.state.disabled' : 'bots.state.revoked';

  return (
    <SettingsSection icon={Bot} title={t('bots.title')} subtitle={t('bots.subtitle')}
      extra={<Button actionId="bot.create-open" emphasis="quiet" density="compact" leading={<Plus size={13} />}
        label={t('bots.add')} onActivate={() => setCreateOpen(true)} />}>
      <div className="sk-bot-list">
        {bots.map(bot => (
          <div className="sk-bot-row" key={bot.id} data-bot={bot.id} data-bot-state={bot.state}>
            <div className="sk-bot-icon"><Bot size={16} /></div>
            <div className="sk-bot-id">
              <div><strong>{bot.name}</strong><Tag tone={bot.state === 'active' ? 'success' : 'neutral'}>{t(stateKey(bot.state))}</Tag></div>
              <code className="sk-mono">{bot.publishingId}</code>
            </div>
            <span className="sk-bot-rate">{t('bots.rateLimit')} · {bot.rateLimitPerMinute}</span>
            {bot.state === 'revoked' ? null : (
              <Switch checked={bot.state === 'active'} aria-label={bot.name}
                onCheckedChange={checked => patch(bot.id, { state: checked ? 'active' : 'disabled' })} />
            )}
            {confirmRevoke === bot.id ? (
              <span className="sk-inline-confirm sk-inline-confirm-danger" data-revoke-confirm>
                <Button actionId={`bot.${bot.id}.revoke-confirm`} emphasis="quiet" density="compact" tone="danger" label={t('bots.revoke')}
                  onActivate={() => patch(bot.id, { state: 'revoked' })} />
                <Button actionId={`bot.${bot.id}.revoke-cancel`} emphasis="quiet" density="compact" label={t('common.cancel')}
                  onActivate={() => setConfirmRevoke(null)} />
              </span>
            ) : (
              /* Same row-action grammar as Lark channels: quiet danger
                 text button, never a bordered icon tile. */
              <Button actionId={`bot.${bot.id}.revoke`} emphasis="quiet" density="compact" tone="danger"
                leading={<Trash2 size={13} />} label={t('bots.revoke')}
                onActivate={() => setConfirmRevoke(bot.id)} />
            )}
          </div>
        ))}
        {bots.length === 0 && <p className="sk-field-hint">{t('bots.empty')}</p>}
      </div>

      <Dialog open={createOpen} onDismiss={() => setCreateOpen(false)} title={t('bots.add')}
        width={420} closeLabel={t('common.close')}
        footer={
          <>
            <Button actionId="bot.create-cancel" emphasis="quiet" label={t('common.cancel')}
              onActivate={() => setCreateOpen(false)} />
            <Button actionId="bot.create-confirm" emphasis="primary" leading={<Check size={14} />}
              label={t('common.confirm')}
              onActivate={create} />
          </>
        }>
        <div className="sk-upload-dialog">
          <TextField aria-label={t('bots.add')} placeholder="CI Bot"
            value={name} data-bot-name onValueChange={setName}
            onEnter={event => { event.preventDefault(); create(); }} />
          <TextField aria-label={t('bots.rateLimit')} type="number" value={rate}
            onValueChange={setRate} />
        </div>
      </Dialog>
    </SettingsSection>
  );
}

/* ── Lark (real provisioning flow: managed QR scan / existing app) ───── */

interface Channel { id: string; name: string; domain: string; connected: boolean; delivery: boolean; inbound: boolean }
const INITIAL_CHANNELS: Channel[] = [
  { id: 'ch-lark-1', name: '飞书 · 松绿物业', domain: 'songlutf.feishu.cn', connected: true, delivery: true, inbound: false },
];

type WizMode = 'managed' | 'existing';
type WizStep = 'form' | 'qr';
type QrPhase = 'waiting' | 'scanned' | 'done';

/* Deterministic decorative QR — prototype-only placeholder for the real
   provisioning code. It renders the three finder squares and a seeded module
   matrix so the layout is reviewable without a network round-trip. */
function QrArtwork({ seed = 'peers-lark' }: { seed?: string }) {
  const N = 25;
  const cells = useMemo(() => {
    let h = 2166136261;
    for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    const inFinder = (r: number, c: number) =>
      (r < 7 && c < 7) || (r < 7 && c > N - 8) || (r > N - 8 && c < 7);
    const matrix: boolean[] = [];
    for (let r = 0; r < N; r += 1) {
      for (let c = 0; c < N; c += 1) {
        h = Math.imul(h ^ (r * 31 + c * 17), 16777619) >>> 0;
        matrix.push(!inFinder(r, c) && (h % 100) / 100 > .52);
      }
    }
    return matrix;
  }, [seed]);
  const finder = (x: number, y: number) => (
    <g key={`${x}-${y}`}>
      <rect x={x} y={y} width={7} height={7} rx={1.5} fill="currentColor" />
      <rect x={x + 1} y={y + 1} width={5} height={5} rx={1} fill="#fff" />
      <rect x={x + 2} y={y + 2} width={3} height={3} rx={.5} fill="currentColor" />
    </g>
  );
  return (
    <svg className="sk-wiz-qr-art" viewBox={`0 0 ${N} ${N}`} role="img" aria-label="QR">
      {cells.map((on, i) => on
        ? <rect key={i} x={i % N} y={Math.floor(i / N)} width={1.04} height={1.04} fill="currentColor" />
        : null)}
      {finder(0, 0)}
      {finder(N - 7, 0)}
      {finder(0, N - 7)}
    </svg>
  );
}

export function LarkSection() {
  const { t } = useT();
  const [channels, setChannels] = useState<Channel[]>(INITIAL_CHANNELS);
  const [wizard, setWizard] = useState(false);
  const [mode, setMode] = useState<WizMode>('managed');
  const [step, setStep] = useState<WizStep>('form');
  const [appName, setAppName] = useState('');
  const [platform, setPlatform] = useState<'feishu' | 'lark'>('feishu');
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [qrPhase, setQrPhase] = useState<QrPhase>('waiting');
  const [checking, setChecking] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const patch = (id: string, p: Partial<Channel>) =>
    setChannels(list => list.map(channel => channel.id === id ? { ...channel, ...p } : channel));

  const finishManaged = (name: string, domainHost: string) => {
    setChannels(list => [...list, {
      id: `local-${Date.now()}`,
      name: t('channels.nameNew', { tenant: name || t('channels.tenantFallback') }),
      domain: domainHost, connected: true, delivery: true, inbound: false,
    }]);
    setWizard(false);
  };

  const openWizard = () => {
    setMode('managed'); setStep('form'); setAppName(''); setPlatform('feishu');
    setAppId(''); setAppSecret(''); setQrPhase('waiting'); setChecking(false);
    setWizard(true);
  };

  // Managed-app provisioning is a staged scan: waiting → phone-confirmed →
  // Station-side enable. The QR phase auto-advances so the prototype shows
  // real sequencing without a backend.
  useEffect(() => {
    if (!(wizard && step === 'qr' && mode === 'managed')) return;
    setQrPhase('waiting');
    const timers = [
      window.setTimeout(() => setQrPhase('scanned'), 800),
      window.setTimeout(() => setQrPhase('done'), 1600),
      window.setTimeout(() => {
        const host = platform === 'feishu' ? 'feishu.cn' : 'larksuite.com';
        finishManaged(appName.trim(), host);
      }, 2150),
    ];
    return () => timers.forEach(window.clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizard, step, mode]);

  const existingReady = appId.trim().length > 0 && appSecret.trim().length > 0;
  const checkExisting = () => {
    if (!existingReady || checking) return;
    setChecking(true);
    window.setTimeout(() => {
      const host = platform === 'feishu' ? 'feishu.cn' : 'larksuite.com';
      finishManaged(appId.trim(), host);
    }, 900);
  };

  const platformOptions = [
    { value: 'feishu', label: t('channels.platform.feishu') },
    { value: 'lark', label: t('channels.platform.lark') },
  ] as const;

  return (
    <SettingsSection icon={Radio} title={t('channels.title')} subtitle={t('channels.subtitle')}
      extra={
        /* Add is a section-level operation: it belongs in the header action
           zone, right-aligned beside the title — never interleaved with the
           data rows below. */
        <Button actionId="channel.add-open" emphasis="quiet" density="compact"
          leading={<Plus size={14} />} label={t('channels.add')} onActivate={openWizard} />
      }>
      <div className="sk-channel-list">
        {channels.map(channel => (
          <div className="sk-channel-card" key={channel.id} data-channel-id={channel.id}>
            <div className="sk-channel-id">
              <div className="sk-channel-title">
                <strong>{channel.name}</strong>
                <Tag tone={channel.connected ? 'success' : 'neutral'}>
                  {channel.connected ? t('channels.connected') : t('channels.disconnected')}
                </Tag>
              </div>
              <span className="sk-channel-domain"><Link2 size={12} /> {channel.domain}</span>
            </div>
            <div className="sk-channel-switches">
              <Switch checked={channel.delivery} aria-label={t('channels.deliveryAria')}
                label={t('channels.delivery')}
                onCheckedChange={checked => patch(channel.id, { delivery: checked })} />
              <Switch checked={channel.inbound} aria-label={t('channels.inboundAria')}
                label={t('channels.inbound')}
                onCheckedChange={checked => patch(channel.id, { inbound: checked })} />
              <Button actionId={`channel.remove-${channel.id}`} emphasis="quiet" density="compact" tone="danger"
                leading={<Trash2 size={13} />} label={t('common.remove')}
                onActivate={() => setRemoving(channel.id)} />
            </div>
          </div>
        ))}
      </div>
      <Alert tone="info" title={t('channels.botsTitle')} description={t('channels.botsDesc')} />

      <Dialog open={wizard} onDismiss={() => setWizard(false)} title={t('channels.dialogTitle')}
        width={680} closeLabel={t('common.cancel')}
        footer={step === 'qr'
          ? <Button actionId="channel.qr-back" emphasis="quiet" leading={<ArrowLeft size={14} />}
              label={t('channels.back')} onActivate={() => setStep('form')} />
          : mode === 'managed'
            ? <Button actionId="channel.authorize" emphasis="primary" leading={<ScanLine size={14} />}
                label={t('channels.next')}
                availability={!appName.trim() ? { kind: 'disabled', reason: t('channels.appName') } : undefined}
                onActivate={() => setStep('qr')} />
            : <Button actionId="channel.check-app" emphasis="primary"
                leading={checking ? <Loader2 size={14} className="sk-spin" /> : <Check size={14} />}
                label={t('channels.checkApp')}
                availability={!existingReady
                  ? { kind: 'disabled', reason: t('channels.appId') }
                  : checking ? { kind: 'disabled', reason: t('channels.checkApp') } : undefined}
                onActivate={checkExisting} />}>
        <div className="sk-wizard" data-wizard-step={step} data-wiz-mode={mode}>
          {step === 'form' && (
            <>
              {/* Provisioning method: managed app via Lark scan, or bind an
                  existing app by credentials — a Segmented, never hand-rolled tabs. */}
              <div className="sk-wiz-tabs">
                <Segmented<WizMode> label="接入方式" density="compact" value={mode}
                  options={(['managed', 'existing'] as WizMode[]).map(m => ({
                    value: m,
                    label: t(m === 'managed' ? 'channels.method.managed' : 'channels.method.existing'),
                  }))}
                  onValueChange={value => setMode(value ?? 'managed')} />
              </div>

              {mode === 'managed' ? (
                <div className="sk-wiz-form">
                  <div className="sk-wiz-grid">
                    <label className="sk-wiz-field">
                      <span>{t('channels.appName')}</span>
                      <TextField aria-label={t('channels.appName')}
                        placeholder={t('channels.appNamePlaceholder')}
                        value={appName} data-channel-app-name
                        onValueChange={setAppName} />
                    </label>
                    <label className="sk-wiz-field">
                      <span>{t('channels.platform')}</span>
                      <Select value={platform} options={platformOptions}
                        onValueChange={value => setPlatform((value as 'feishu' | 'lark') ?? 'feishu')} />
                    </label>
                  </div>
                  <div className="sk-wiz-scancard">
                    <span className="sk-wiz-scancard-icon"><ScanLine size={17} /></span>
                    <span className="sk-wiz-scancard-text">
                      <strong>{t('channels.scanCard.title')}</strong>
                      <span>{t('channels.scanCard.body')}</span>
                    </span>
                  </div>
                  <ul className="sk-wiz-points">
                    <li><Check size={13} /> {t('channels.managed.point1')}</li>
                    <li><Check size={13} /> {t('channels.managed.point2')}</li>
                  </ul>
                </div>
              ) : (
                <div className="sk-wiz-form">
                  <div className="sk-wiz-grid sk-wiz-grid-3">
                    <label className="sk-wiz-field">
                      <span>{t('channels.platform')}</span>
                      <Select value={platform} options={platformOptions}
                        onValueChange={value => setPlatform((value as 'feishu' | 'lark') ?? 'feishu')} />
                    </label>
                    <label className="sk-wiz-field">
                      <span>{t('channels.appId')}</span>
                      <TextField aria-label={t('channels.appId')} placeholder={t('channels.appIdPlaceholder')}
                        value={appId} data-channel-app-id onValueChange={setAppId} />
                    </label>
                    <label className="sk-wiz-field">
                      <span>{t('channels.appSecret')}</span>
                      <TextField aria-label={t('channels.appSecret')} placeholder={t('channels.appSecretPlaceholder')}
                        type="password" value={appSecret} data-channel-app-secret onValueChange={setAppSecret} />
                    </label>
                  </div>
                  <p className="sk-wiz-note"><ShieldCheck size={13} /> {t('channels.existing.note')}</p>
                </div>
              )}
            </>
          )}

          {step === 'qr' && (
            <div className="sk-wiz-qr" data-qr-phase={qrPhase}>
              {/* Left: the code is the hero — everything explanatory moves right. */}
              <div className="sk-wiz-qr-main">
                <div className="sk-wiz-qr-frame">
                  <QrArtwork seed={appName || 'peers-lark'} />
                </div>
                <span className="sk-wiz-qr-scan"><ScanLine size={14} /> {t('channels.qr.scanHint')}</span>
                <Button actionId="channel.qr.refresh" emphasis="quiet" density="compact"
                  className="sk-wiz-qr-refresh"
                  leading={<RefreshCw size={12} />} label={t('channels.qr.refresh')}
                  onActivate={() => undefined} />
              </div>
              <div className="sk-wiz-qr-side">
                <span className="sk-wiz-qr-eyebrow">{t('channels.qr.eyebrow')}</span>
                <h3>{t('channels.qr.title')}</h3>
                <div className="sk-wiz-qr-status">
                  {qrPhase === 'waiting' && <Clock3 size={15} />}
                  {qrPhase === 'scanned' && <Loader2 size={15} className="sk-spin" />}
                  {qrPhase === 'done' && <CheckCircle2 size={15} />}
                  <span>{t(`channels.qr.status.${qrPhase}` as StringKey)}</span>
                </div>
                <ol className="sk-wiz-steps">
                  {[
                    { key: 'step1', phase: 'waiting' as QrPhase },
                    { key: 'step2', phase: 'scanned' as QrPhase },
                    { key: 'step3', phase: 'done' as QrPhase },
                  ].map((s, i) => {
                    const order = ['waiting', 'scanned', 'done'] as const;
                    const phaseIndex = order.indexOf(qrPhase);
                    const reached = phaseIndex > i;
                    const active = phaseIndex === i;
                    return (
                      <li key={s.key} data-reached={reached ? 'true' : 'false'} data-active={active ? 'true' : 'false'}>
                        <span className="sk-wiz-steps-index">{reached ? <Check size={12} /> : i + 1}</span>
                        <span>{t(`channels.qr.${s.key}` as StringKey)}</span>
                      </li>
                    );
                  })}
                </ol>
                <div className="sk-wiz-qr-meta">
                  <span>{t('channels.qr.managedName')}：{appName.trim() || '—'}</span>
                  <span>{t('channels.qr.expire')}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </Dialog>

      <Dialog open={!!removing} onDismiss={() => setRemoving(null)} title={t('channels.removeDialogTitle')}
        width={420} closeLabel={t('common.cancel')}
        footer={
          <>
            <Button actionId="channel.remove-cancel" emphasis="quiet" label={t('common.cancel')}
              onActivate={() => setRemoving(null)} />
            <Button actionId="channel.remove-confirm" emphasis="primary" tone="danger"
              label={t('channels.removeConfirm')}
              onActivate={() => {
                setChannels(list => list.filter(channel => channel.id !== removing));
                setRemoving(null);
              }} />
          </>
        }>
        <p className="sk-field-hint">{t('channels.removeBody')}</p>
      </Dialog>
    </SettingsSection>
  );
}
