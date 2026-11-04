/**
 * Channels-group sections (desktop Settings.tsx parity):
 * Bots (compressed registry manager) and Lark (provisioning wizard +
 * connected channel cards). All state is local and real.
 */
import { useState } from 'react';
import {
  Bot, Check, Link2, Plus, Radio, Trash2,
} from 'lucide-react';
import {
  Alert, Button, Dialog, IconButton, Switch, Tag, TextField,
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
      extra={<Button actionId="bot.create-open" emphasis="primary" density="compact" leading={<Plus size={13} />}
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
              <IconButton actionId={`bot.${bot.id}.revoke`} iconId="delete" iconSize={14} label={t('bots.revoke')}
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

/* ── Lark (existing provisioning wizard) ─────────────────────────────── */

interface Channel { id: string; name: string; domain: string; connected: boolean; delivery: boolean; inbound: boolean }
const INITIAL_CHANNELS: Channel[] = [
  { id: 'ch-lark-1', name: '飞书 · 松绿物业', domain: 'songlutf.feishu.cn', connected: true, delivery: true, inbound: false },
];

export function LarkSection() {
  const { t } = useT();
  const [channels, setChannels] = useState<Channel[]>(INITIAL_CHANNELS);
  const [wizard, setWizard] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [domain, setDomain] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);

  const patch = (id: string, p: Partial<Channel>) =>
    setChannels(list => list.map(channel => channel.id === id ? { ...channel, ...p } : channel));
  const openWizard = () => { setDomain(''); setStep(1); setWizard(true); };
  const authorize = () => {
    setStep(2);
    window.setTimeout(() => setStep(3), 900);
    window.setTimeout(() => {
      setStep(1);
      setWizard(false);
      setChannels(list => [...list, {
        id: `local-${Date.now()}`,
        name: t('channels.nameNew', { tenant: domain.split('.')[0] || t('channels.tenantFallback') }),
        domain: domain || 'new.feishu.cn', connected: true, delivery: true, inbound: false,
      }]);
    }, 1900);
  };

  return (
    <SettingsSection icon={Radio} title={t('channels.title')} subtitle={t('channels.subtitle')}>
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
      <Button actionId="channel.add-open" emphasis="primary" leading={<Plus size={14} />}
        label={t('channels.add')} onActivate={openWizard} />
      <Alert tone="info" title={t('channels.botsTitle')} description={t('channels.botsDesc')} />

      <Dialog open={wizard} onDismiss={() => setWizard(false)} title={t('channels.dialogTitle')}
        width={460} closeLabel={t('common.cancel')}
        footer={step === 1
          ? <Button actionId="channel.authorize" emphasis="primary" leading={<Check size={14} />}
              label={t('channels.authorize')}
              availability={!domain.trim() ? { kind: 'disabled', reason: t('channels.domainReason') } : undefined}
              onActivate={authorize} />
          : undefined}>
        <div className="sk-wizard" data-wizard-step={step}>
          {step === 1 && (
            <div className="sk-wizard-step">
              <strong>{t('channels.step1Title')}</strong>
              <TextField aria-label={t('channels.domainAria')} placeholder="your-tenant.feishu.cn"
                value={domain} data-channel-domain onValueChange={setDomain} />
              <p className="sk-field-hint">{t('channels.step1Hint')}</p>
            </div>
          )}
          {step === 2 && (
            <div className="sk-wizard-step is-center">
              <strong>{t('channels.step2Title')}</strong>
              <p className="sk-field-hint">{t('channels.step2Hint')}</p>
            </div>
          )}
          {step === 3 && (
            <div className="sk-wizard-step is-center">
              <strong>{t('channels.step3Title')}</strong>
              <p className="sk-field-hint">{t('channels.step3Hint')}</p>
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
