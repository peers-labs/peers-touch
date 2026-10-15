import { useState } from 'react';
import { Button, Empty, Input, Modal, Switch, Typography } from 'antd';
import { Copy, LogOut, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useMobileI18n } from '../../app/mobileI18n';
import { requestSettingsExit } from '../../app/navigation';
import { BoundedList } from '../../components/BoundedList';
import { MobileNotice } from '../../components/MobileNotice';
import type { MobileAuthSession } from '../../features/auth/authSession';
import { requestSocialCurrentUserProfile } from '../../features/social/socialRuntime';
import { useSocialStore } from '../../features/social/socialStore';
import { activeStationEntry, type StoredStationRegistry } from '../../features/station/stationRegistry';
import type { FederationSummary } from '../../gen/proto/domain/federation/federation_projection_service_pb';
import { copyTextToClipboard } from '../../services/clipboard';
import { SettingsChoiceField } from './SettingsChoiceField';
import { SettingsExitBoundary, type SettingsDraftOwner } from './SettingsExitBoundary';
import { StationSection } from './SettingsSections';
import { useFederationSettingsController } from './useFederationSettingsController';
import { useSettingsController } from './useSettingsController';
import './agent-settings.css';

const { Text } = Typography;

export function FederationDetail({
  session, stationRegistry, onBack, onChangeStation, onLogout, loggingOut,
}: {
  readonly session: MobileAuthSession | null;
  readonly stationRegistry: StoredStationRegistry;
  readonly onBack: () => void;
  readonly onChangeStation: () => Promise<void>;
  readonly onLogout: () => void;
  readonly loggingOut: boolean;
}) {
  const { t } = useMobileI18n();
  const profile = useSocialStore((state) => state.currentUserProfile);
  const updateProfile = useSocialStore((state) => state.updateCurrentUserProfile);
  const settings = useSettingsController(session, profile, updateProfile,
    () => requestSocialCurrentUserProfile(true),
    { profile: true, device: false, permissions: false, version: false });
  const federation = useFederationSettingsController(session);
  const [pending, setPending] = useState<FederationSummary | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const draft = settings.draftProfile;
  const busy = federation.busy || settings.profileSaveStatus === 'saving';
  const station = activeStationEntry(stationRegistry);
  const owner: SettingsDraftOwner = {
    dirty: settings.profileDirty || federation.dirty, conflict: settings.profileConflict,
    saveStatus: busy ? 'saving' : settings.profileSaveStatus,
    saveError: settings.profileSaveError ?? federation.error,
    save: async () => {
      if (settings.profileDirty && !await settings.saveProfile()) return false;
      return !federation.dirty || federation.join();
    },
    discard: () => { settings.discardProfile(); federation.discardJoin(); },
    reload: async () => { await settings.reloadProfile(); await federation.reload(); },
  };
  const deleting = pending?.capability?.canArchive && pending.sequencerStationPeerId === session?.stationPeerId;
  const handle = profile?.federatedHandle || session?.actorRef.acct || '';
  return <SettingsExitBoundary title={t('mobile.settings.federation.title')} settingId="federation" owner={owner} onBack={onBack}>
    <section className="settings-agent-editor">
      <Text strong>{t('mobile.settings.federation.discovery')}</Text>
      {settings.profileAvailable && draft ? <>
        <div className="settings-row"><Text>{t('mobile.settings.federation.discoverable')}</Text>
          <Switch checked={draft.discoverability !== 'hidden'} disabled={busy}
            aria-label={t('mobile.settings.federation.discoverable')} data-federation-field="discoverable"
            onChange={(enabled) => settings.patchProfile({ discoverability: enabled ? 'by_handle' : 'hidden' })} />
        </div>
        <SettingsChoiceField field="federation-visibility" label={t('mobile.settings.privacy.discoverability')}
          value={draft.discoverability} disabled={busy}
          options={(['hidden', 'by_handle', 'indexed'] as const).map((value, index) => ({
            value, label: t(['mobile.settings.privacy.discoverability.hidden',
              'mobile.settings.privacy.discoverability.byHandle', 'mobile.settings.privacy.discoverability.indexed'][index]),
          }))} onChange={(discoverability) => settings.patchProfile({ discoverability })} />
        <SettingsChoiceField field="federation-reach" label={t('mobile.settings.privacy.messagePermission')}
          value={draft.messagePermission} disabled={busy}
          options={['everyone', 'friends', 'none'].map((value) => ({
            value, label: t(`mobile.settings.privacy.message.${value}`),
          }))} onChange={(messagePermission) => settings.patchProfile({ messagePermission })} />
        <div className="settings-row"><Text>{t('mobile.settings.privacy.manuallyApprovesFollowers')}</Text>
          <Switch checked={draft.manuallyApprovesFollowers} disabled={busy}
            aria-label={t('mobile.settings.privacy.manuallyApprovesFollowers')}
            onChange={(manuallyApprovesFollowers) => settings.patchProfile({ manuallyApprovesFollowers })} />
        </div>
      </> : <Button block onClick={() => void settings.retryProfile()}>{t('common.action.retry')}</Button>}
    </section>
    <section className="settings-agent-editor">
      <div className="settings-row"><Text strong>{t('mobile.settings.federation.contexts')}</Text>
        <div className="settings-agent-actions">
          <Button icon={<RefreshCw size={16} />} aria-label={t('common.action.refresh')} loading={federation.loading}
            disabled={busy} onClick={() => void federation.reload()} />
          <Button icon={<Plus size={16} />} disabled={busy}
            onClick={() => requestSettingsExit(federation.openJoin)}>{t('mobile.settings.federation.join')}</Button>
        </div>
      </div>
      <Text type="secondary">{t('mobile.settings.federation.stationScope')}</Text>
      {federation.error ? <MobileNotice>{t(federation.error)}</MobileNotice> : null}
      {federation.joinStatus ? <MobileNotice tone="info">{t(`mobile.settings.federation.join.${federation.joinStatus}`)}</MobileNotice> : null}
      {federation.joinOpen ? <div className="settings-agent-editor">
        <label className="settings-profile-field"><Text>{t('mobile.settings.federation.endpoint')}</Text>
          <Input type="url" autoCapitalize="none" autoCorrect="off" disabled={busy}
            data-federation-field="endpoint" value={federation.endpoint} onChange={(event) => federation.setEndpoint(event.target.value)} />
        </label>
        <label className="settings-profile-field"><Text>{t('mobile.settings.federation.id')}</Text>
          <Input autoCapitalize="none" autoCorrect="off" disabled={busy}
            data-federation-field="id" value={federation.federationId} onChange={(event) => federation.setFederationId(event.target.value)} />
        </label>
        <div className="settings-agent-actions">
          <Button disabled={busy} onClick={federation.discardJoin}>{t('common.action.cancel')}</Button>
          <Button type="primary" loading={federation.busy} disabled={busy || !federation.dirty}
            data-federation-action="join" onClick={() => void federation.join()}>{t('mobile.settings.federation.join')}</Button>
        </div>
      </div> : null}
      {!federation.loading && !federation.error && federation.federations.every((entry) => entry.status !== 'active')
        ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('mobile.settings.federation.empty')} /> : null}
      <BoundedList surfaceKey="settings:federation" items={federation.federations.filter((entry) => entry.status === 'active')}
        itemKey={(entry) => entry.federationId} size={40}>
        {(items) => items.map((entry) => {
          const canDelete = entry.capability?.canArchive && entry.sequencerStationPeerId === session?.stationPeerId;
          return <div className="settings-row" key={entry.federationId} data-federation-id={entry.federationId}>
            <span className="settings-agent-copy"><Text strong>{entry.name}</Text>
              <Text type="secondary">{t('mobile.settings.federation.stations', { count: entry.memberStationCount })}</Text>
              <Text type="secondary">{t(`mobile.settings.federation.role.${entry.myRole || 'viewer'}`)}</Text></span>
            {canDelete || entry.capability?.canLeave ? <Button danger type="text" disabled={busy}
              data-federation-action={canDelete ? 'delete' : 'leave'} icon={canDelete ? <Trash2 size={16} /> : <LogOut size={16} />}
              onClick={() => requestSettingsExit(() => setPending(entry))}>
              {t(canDelete ? 'common.action.delete' : 'mobile.settings.federation.leave')}
            </Button> : null}
          </div>;
        })}
      </BoundedList>
    </section>
    <section className="settings-agent-editor">
      <Text strong>{t('mobile.settings.federation.identity')}</Text>
      <Text type="secondary">{handle}</Text>
      <Button icon={<Copy size={16} />} disabled={!handle} data-federation-action="copy"
        onClick={() => void copyTextToClipboard(handle).then(() => setCopyStatus('copied'), () => setCopyStatus('error'))}>
        {t(copyStatus === 'copied' ? 'mobile.settings.copied' : 'mobile.settings.federation.copyHandle')}
      </Button>
      {copyStatus === 'error' ? <MobileNotice>{t('mobile.settings.copyFailed')}</MobileNotice> : null}
    </section>
    <StationSection stationLabel={station?.label ?? t('common.stationPicker.fallbackLabel')} stationUrl={station?.url ?? ''}
      identityVerified={station?.identityVerified === true} onChangeStation={async () => requestSettingsExit(onChangeStation)}
      onLogout={onLogout} loggingOut={loggingOut} />
    <Modal open={pending !== null} title={t(deleting ? 'mobile.settings.federation.deleteTitle' : 'mobile.settings.federation.leaveTitle')}
      okText={t(deleting ? 'common.action.delete' : 'mobile.settings.federation.leave')} okButtonProps={{ danger: true }}
      cancelText={t('common.action.cancel')} cancelButtonProps={{ disabled: federation.busy }}
      confirmLoading={federation.busy} closable={!federation.busy}
      onCancel={() => { if (!federation.busy) setPending(null); }} destroyOnHidden
      onOk={() => { if (pending) void federation.remove(pending).then((success) => { if (success) setPending(null); }); }}>
      {t(deleting ? 'mobile.settings.federation.deleteBody' : 'mobile.settings.federation.leaveBody', { name: pending?.name ?? '' })}
      {federation.error ? <MobileNotice>{t(federation.error)}</MobileNotice> : null}
    </Modal>
  </SettingsExitBoundary>;
}
