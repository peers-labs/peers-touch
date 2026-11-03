/**
 * Network-group sections (desktop Settings.tsx parity):
 * Your Station, Discovery, Federation.
 *
 * Local prototype state only: station binding, reachability choices and
 * federation membership are real local interactions; operator-only actions
 * that belong to the Station Dashboard render honestly disabled.
 */
import { useState } from 'react';
import {
  Copy, Globe, LogOut, Network as NetworkIcon,
  Plus, Server, Shield, Wifi,
} from 'lucide-react';
import { Button, Segmented, Switch, Tag, TextField } from '@peers-touch/ui';
import { makeTranslate, setPrefs, usePrefs, type Translate } from '../../prefs';
import { SettingsItemCard, SettingsRow, SettingsSection } from '../SettingsPrimitives';
import { LinkedDevices } from './LinkedDevices';
import '../settings.css';

const STATION = { id: 'alpha.peers.social', name: 'alpha.peers.social' };
const ONLINE = true;

type ReachPolicy = 'anyone' | 'federations' | 'nobody';

interface JoinedFederation {
  id: string;
  name: string;
  description: string;
  role: 'operator' | 'member';
  stationCount: number;
  joinedAt: string;
  endpoint: string;
}

const INITIAL_FEDERATIONS: JoinedFederation[] = [
  { id: 'fed-1', name: 'Peers Social Network', description: '邻里社交主联邦', role: 'operator', stationCount: 12, joinedAt: '2026-05-12', endpoint: 'https://federation.peers.social' },
  { id: 'fed-2', name: 'Lab Federation', description: '内部测试联邦', role: 'member', stationCount: 3, joinedAt: '2026-06-20', endpoint: 'https://fed.lab.internal' },
  { id: 'fed-3', name: 'East Asia Network', description: '东亚区域联邦', role: 'member', stationCount: 7, joinedAt: '2026-07-01', endpoint: 'https://east.peers.network' },
];

function useT(): { t: Translate } {
  const prefs = usePrefs();
  return { t: makeTranslate(prefs.locale) };
}

/* ── Your Station ─────────────────────────────────────────────────────── */

export function StationSection() {
  const { t } = useT();
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  return (
    <>
      <SettingsSection icon={Wifi} title={t('station.title')} subtitle={t('station.subtitle')}>
        <div className="sk-station-binding" data-station-binding>
          <div className="sk-station-tile"><Server size={22} /></div>
          <div className="sk-station-meta">
            <strong>{STATION.name}</strong>
            <span className="sk-station-status">
              <i data-online={ONLINE ? '1' : '0'} />
              {ONLINE ? t('station.connected') : t('station.offline')}
            </span>
          </div>
        </div>
        <p className="sk-field-hint" style={{ marginTop: 10 }}>{t('station.relayNote')}</p>
      </SettingsSection>

      <LinkedDevices />

      <section className="sk-settings-section sk-danger-zone" data-danger="switch-station">
        <header>
          <h3>{t('station.switchTitle')}</h3>
          <p>{t('station.switchDesc')}</p>
        </header>
        {confirmSwitch ? (
          <div className="sk-inline-confirm" data-switch-confirm>
            <span>{t('station.switchConfirmText')}</span>
            <div className="sk-inline-actions">
              <Button actionId="switch-station-cancel" emphasis="quiet" density="compact" label={t('common.cancel')} onActivate={() => setConfirmSwitch(false)} />
              <Button actionId="switch-station-confirm" emphasis="primary" density="compact" tone="danger"
                label={t('station.signoutSwitch')} onActivate={() => setConfirmSwitch(false)} />
            </div>
          </div>
        ) : (
          <button type="button" className="sk-danger-link" data-switch-station
            onClick={() => setConfirmSwitch(true)}>
            <LogOut size={14} /> {t('station.switchTitle')}
          </button>
        )}
      </section>
    </>
  );
}

/* ── Discovery ────────────────────────────────────────────────────────── */

export function DiscoverySection() {
  const { t } = useT();
  const prefs = usePrefs();
  const [perFed, setPerFed] = useState<Record<string, boolean>>({
    'fed-1': true, 'fed-2': false, 'fed-3': true,
  });
  // Reach policy enforcement needs a Station-side policy; the choice is a
  // local seed pending that backend.
  const [reach, setReach] = useState<ReachPolicy>('federations');
  return (
    <>
      <SettingsSection icon={Globe} title={t('discovery.title')}>
        <SettingsRow label={t('discoverable')}
          description={prefs.privacy.onlineVisible ? t('discovery.discoverableOn') : t('discovery.discoverableOff')}>
          <Switch checked={prefs.privacy.onlineVisible} aria-label={t('discoverable')}
            data-discovery="master"
            onCheckedChange={checked =>
              setPrefs({ privacy: { ...prefs.privacy, onlineVisible: checked } })} />
        </SettingsRow>
        <div className="sk-discovery-feds" data-discovery-federations>
          <div className="sk-discovery-feds-head">
            <strong>{t('discovery.perFed')}</strong>
          </div>
          <p className="sk-field-hint">{t('discovery.perFedNote')}</p>
          {INITIAL_FEDERATIONS.map(fed => (
            <SettingsRow key={fed.id} label={fed.name} description={fed.endpoint}>
              <Switch checked={!!perFed[fed.id]} aria-label={fed.name}
                onCheckedChange={checked => setPerFed(map => ({ ...map, [fed.id]: checked }))} />
            </SettingsRow>
          ))}
        </div>
        <SettingsRow label={t('discovery.handle')} description={t('discovery.handleDesc')}>
          <span className="sk-handle">
            @linye@alpha.peers.social
            <button type="button" className="sk-quiet-icon" aria-label={t('account.copy')}
              onClick={() => { void navigator.clipboard?.writeText('@linye@alpha.peers.social'); }}>
              <Copy size={14} />
            </button>
          </span>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection icon={NetworkIcon} title={t('discovery.whoCanContact')}>
        <SettingsRow label={t('discovery.whoCanContact')}>
          <Segmented<ReachPolicy>
            label={t('discovery.whoCanContact')}
            options={[
              { value: 'anyone', label: t('discovery.anyone') },
              { value: 'federations', label: t('discovery.federations') },
              { value: 'nobody', label: t('discovery.nobody') },
            ]}
            value={reach}
            onValueChange={value => setReach(value ?? 'federations')} />
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

/* ── Federation ───────────────────────────────────────────────────────── */

export function FederationSection() {
  const { t } = useT();
  const [federations, setFederations] = useState<JoinedFederation[]>(INITIAL_FEDERATIONS);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [error, setError] = useState('');
  const [confirmLeaveId, setConfirmLeaveId] = useState<string | null>(null);

  const join = () => {
    const url = endpoint.trim();
    if (!url) { setError(t('federation.invalidEndpoint')); return; }
    if (!/^(https?:\/\/|[\w-]+(\.[\w-]+)+)/.test(url)) { setError(t('federation.invalidEndpoint')); return; }
    const host = url.replace(/^https?:\/\//, '').split('/')[0];
    setFederations(list => [...list, {
      id: `fed-${Date.now()}`, name: host, description: t('federation.joinedSuffix'),
      role: 'member', stationCount: 1, joinedAt: new Date().toISOString().slice(0, 10),
      endpoint: url.startsWith('http') ? url : `https://${url}`,
    }]);
    setEndpoint(''); setError(''); setAddOpen(false);
  };
  const leave = (id: string) => {
    setFederations(list => list.filter(f => f.id !== id));
    setConfirmLeaveId(null);
    setExpandedId(null);
  };

  return (
    <SettingsSection icon={NetworkIcon} title={t('federation.title')} subtitle={t('federation.subtitle')}
      extra={
        <Button actionId="federation.add-open" emphasis="secondary" density="compact" leading={<Plus size={13} />}
          label={t('federation.join')} onActivate={() => setAddOpen(open => !open)} />
      }>
      {addOpen && (
        <div className="sk-federation-add" data-federation-add>
          <TextField aria-label={t('federation.endpoint')} data-fed-endpoint
            placeholder="https://federation.example.com"
            value={endpoint} onValueChange={value => { setEndpoint(value); setError(''); }}
            onEnter={event => { event.preventDefault(); join(); }} />
          {error && <p className="sk-error-text">{error}</p>}
          <div className="sk-inline-actions" style={{ justifyContent: 'flex-end' }}>
            <Button actionId="federation.join-cancel" emphasis="quiet" density="compact" label={t('common.cancel')}
              onActivate={() => { setAddOpen(false); setEndpoint(''); setError(''); }} />
            <Button actionId="federation.join-confirm" emphasis="primary" density="compact"
              label={t('federation.join')} onActivate={join} />
          </div>
        </div>
      )}
      <div className="sk-federation-list">
        {federations.map(fed => {
          const expanded = expandedId === fed.id;
          return (
            <SettingsItemCard key={fed.id} onClick={() => setExpandedId(expanded ? null : fed.id)} active={expanded}>
              <div className="sk-federation-row">
                <div className="sk-federation-id">
                  <strong>{fed.name}</strong>
                  <i data-federation-state="active" />
                  <Tag tone={fed.role === 'operator' ? 'info' : 'neutral'}>
                    {fed.role === 'operator' ? t('federation.operator') : t('federation.member')}
                  </Tag>
                </div>
                <span className="sk-federation-count">
                  <strong>{fed.stationCount}</strong>
                  <em>{t('federation.stations')}</em>
                </span>
              </div>
              <p className="sk-federation-desc">{fed.description}</p>
              {expanded && (
                <div className="sk-federation-detail">
                  <dl>
                    <div><dt>{t('federation.endpointLabel')}</dt><dd>{fed.endpoint}</dd></div>
                    <div><dt>{t('federation.joinedLabel')}</dt><dd>{fed.joinedAt}</dd></div>
                  </dl>
                  {fed.role === 'operator' && (
                    <div className="sk-inline-actions">
                      <Button actionId="federation.manage-dashboard" emphasis="quiet" density="compact" leading={<Shield size={13} />}
                        label={t('federation.manageDashboard')}
                        availability={{ kind: 'disabled', reason: t('data.pendingReason') }} />
                    </div>
                  )}
                  {confirmLeaveId === fed.id ? (
                    <div className="sk-inline-confirm sk-inline-confirm-danger" data-leave-confirm>
                      <span>{t('federation.leaveConfirm')}</span>
                      <div className="sk-inline-actions">
                        <Button actionId="federation.leave-confirm" emphasis="quiet" density="compact" tone="danger"
                          label={t('federation.leaveOk')}
                          onClick={event => event.stopPropagation()}
                          onActivate={() => leave(fed.id)} />
                        <Button actionId="federation.leave-cancel" emphasis="quiet" density="compact" label={t('common.cancel')}
                          onClick={event => event.stopPropagation()}
                          onActivate={() => setConfirmLeaveId(null)} />
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="sk-danger-link" data-leave-federation
                      onClick={event => { event.stopPropagation(); setConfirmLeaveId(fed.id); }}>
                      <LogOut size={13} /> {t('federation.leave')}
                    </button>
                  )}
                </div>
              )}
            </SettingsItemCard>
          );
        })}
        {federations.length === 0 && <p className="sk-field-hint">{t('federation.empty')}</p>}
      </div>
    </SettingsSection>
  );
}
