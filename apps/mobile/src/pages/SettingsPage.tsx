import { lazy, Suspense, useMemo, useState, useSyncExternalStore } from 'react';
import { Card, Modal, Spin, Typography } from 'antd';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useMobileI18n } from '../app/mobileI18n';
import { requestSettingsExit, type MobileSettingDetailId } from '../app/navigation';
import type { MobileAuthSession } from '../features/auth/authSession';
import { projectAcceptedContacts } from '../features/social/socialProjection';
import { useSocialStore } from '../features/social/socialStore';
import { activeStationEntry, type StoredStationRegistry } from '../features/station/stationRegistry';
import { stationDisplayName } from '../features/station/stationDisplayName';
import { useSettingsSurfaceFixture } from '../acceptance/settingsSurfaceFixture';
import { MobileAvatar } from '../components/MobileAvatar';
import { readCurrentActiveProfileRuntime } from '../runtimes/socialProjectionRuntime';
import { SettingsAcceptanceSurface } from './settings/SettingsAcceptanceSurface';
import { findSetting, settingGroups } from './settings/settingsCatalog';

const SettingsDetail = lazy(() => import('./settings/SettingsDetail').then((module) => ({ default: module.SettingsDetail })));
const GeneralDetail = lazy(() => import('./settings/GeneralDetail').then((module) => ({ default: module.GeneralDetail })));
const SecurityDetail = lazy(() => import('./settings/SecurityDetail').then((module) => ({ default: module.SecurityDetail })));
const FederationDetail = lazy(() => import('./settings/FederationDetail').then((module) => ({ default: module.FederationDetail })));
const { Text } = Typography;
const noSubscription = () => () => undefined;
const unavailableProfile = () => null;

interface SettingsPageProps {
  readonly stationRegistry: StoredStationRegistry;
  readonly authSession: MobileAuthSession | null;
  readonly activeSettingId: MobileSettingDetailId | null;
  readonly onOpenSetting: (settingId: MobileSettingDetailId) => void;
  readonly onBack: () => void;
  readonly onChangeStation: () => Promise<void>;
  readonly onLogout: () => Promise<void>;
}

export function SettingsPage(props: SettingsPageProps) {
  const fixture = useSettingsSurfaceFixture();
  return fixture.surfaceId ? <SettingsAcceptanceSurface
    key={`${fixture.surfaceId}:${fixture.revision}`} surfaceId={fixture.surfaceId}
  /> : <SettingsPageContent {...props} />;
}

/** Me is a lightweight projection; only the selected detail mounts a controller. */
function SettingsPageContent(props: SettingsPageProps) {
  const { t } = useMobileI18n();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const requestLogout = () => requestSettingsExit(() => setLogoutConfirmOpen(true));
  const confirmLogout = async () => {
    setLogoutConfirmOpen(false);
    setLoggingOut(true);
    try { await props.onLogout(); } finally { setLoggingOut(false); }
  };
  const id = props.activeSettingId;
  const selectedSetting = id ? findSetting(id) : undefined;
  return <>
    {id ? <Suspense fallback={<div className="page-container settings-loading"><Spin /></div>}>
      {selectedSetting?.availability === 'pending'
        ? <PendingAgentDetail title={t(selectedSetting.labelKey)} onBack={props.onBack} />
        : id === 'general' ? <GeneralDetail key={id} session={props.authSession} onBack={props.onBack} />
        : id === 'security' ? <SecurityDetail key={id} session={props.authSession} onBack={props.onBack} />
        : id === 'federation' ? <FederationDetail key={id} session={props.authSession} onBack={props.onBack}
          stationRegistry={props.stationRegistry} onChangeStation={props.onChangeStation}
          onLogout={requestLogout} loggingOut={loggingOut} />
          : <SettingsDetail key={id} settingId={id} stationRegistry={props.stationRegistry}
            authSession={props.authSession} onBack={props.onBack} onChangeStation={props.onChangeStation}
            onLogout={requestLogout} loggingOut={loggingOut} />}
    </Suspense> : <SettingsSummary {...props} loggingOut={loggingOut} onRequestLogout={requestLogout} />}
    <Modal title={t('mobile.settings.station.logoutConfirmTitle')} open={logoutConfirmOpen}
      okText={t('mobile.settings.logout')} okButtonProps={{ danger: true }}
      cancelText={t('common.action.cancel')} onOk={() => void confirmLogout()}
      onCancel={() => setLogoutConfirmOpen(false)} destroyOnHidden>
      <div data-product-surface="settings.logout-confirm">{t('mobile.settings.station.logoutConfirmBody')}</div>
    </Modal>
  </>;
}

function PendingAgentDetail({ title, onBack }: { readonly title: string; readonly onBack: () => void }) {
  const { t } = useMobileI18n();
  return <div className="page-container settings-page mobile-detail-page" data-product-surface="settings.agent-pending">
    <header className="page-header">
      <button type="button" className="header-action" aria-label={t('common.action.back')} onClick={onBack}>
        <ArrowLeft size={20} />
      </button>
      <h1 className="header-title compact">{title}</h1>
    </header>
    <div className="settings-detail-body">
      <Card className="settings-section" variant="borderless">
        <Text strong>{t('mobile.settings.agent.pending')}</Text>
        <Text type="secondary">{t('mobile.settings.agent.pendingBody')}</Text>
      </Card>
    </div>
  </div>;
}

function SettingsSummary({
  stationRegistry, authSession, onOpenSetting, loggingOut, onRequestLogout,
}: SettingsPageProps & { readonly loggingOut: boolean; readonly onRequestLogout: () => void }) {
  const { t, language } = useMobileI18n();
  const currentUserProfile = useSocialStore((state) => state.currentUserProfile);
  const currentUserPtid = useSocialStore((state) => state.currentUserPtid);
  const friendRequests = useSocialStore((state) => state.friendRequests);
  const peerOnline = useSocialStore((state) => state.peerOnline);
  const groupCount = useSocialStore((state) => state.messagingConversations.reduce(
    (count, conversation) => count + Number(conversation.active && conversation.kind === 2), 0,
  ));
  const blockedUsersCount = useSocialStore((state) => state.blockedUsers.length);
  const blockedOwner = useSocialStore((state) => state.socialGateway !== null);
  const profileRuntime = readCurrentActiveProfileRuntime();
  const profileProjection = useSyncExternalStore(
    profileRuntime?.projection.subscribe ?? noSubscription,
    profileRuntime?.projection.state ?? unavailableProfile,
    profileRuntime?.projection.state ?? unavailableProfile,
  );
  const visibleProfile = profileProjection?.availability.available ? currentUserProfile : null;
  const displayName = visibleProfile?.displayName || authSession?.actorRef.acct;
  const unavailableLabel = t('mobile.launch.unavailable');
  const momentsCount = visibleProfile?.statusesCount ?? unavailableLabel;
  const friendCount = useMemo(() => projectAcceptedContacts(
    friendRequests, currentUserPtid, peerOnline,
  ).length, [friendRequests, currentUserPtid, peerOnline]);
  const station = activeStationEntry(stationRegistry);
  const values: Partial<Record<MobileSettingDetailId, string>> = {
    'blocked-users': blockedOwner ? String(blockedUsersCount) : unavailableLabel,
    'station-connection': station ? stationDisplayName(
      station.label, station.url, t('common.stationPicker.fallbackLabel'),
    ) : t('mobile.settings.stationNotSelected'),
    language: language === 'zh-CN' ? '简体中文' : 'English',
  };

  return <div className="page-container settings-page" data-product-surface="settings.summary">
    <header className="page-header"><h1 className="header-title">{t('mobile.settings.title')}</h1></header>
    <div className="settings-body">
      <button type="button" className="settings-profile-trigger" onClick={() => onOpenSetting('account-info')}>
        <Card className="settings-profile-header-card" variant="borderless">
          <div className="settings-profile-header">
            <MobileAvatar identityKey={authSession?.actorRef.ptid ?? displayName} identityRole="person"
              name={displayName} size={64} src={visibleProfile?.avatar || undefined} />
            <div className="settings-profile-info">
              <Text strong className="settings-profile-name">{displayName || t('mobile.settings.notLoggedIn')}</Text>
              <Text type="secondary" className="settings-profile-subtitle">{t('mobile.settings.connected')}</Text>
            </div>
            <ChevronRight size={20} />
          </div>
          <div className="settings-profile-stats">
            {[
              [friendCount, 'mobile.settings.stats.friends'],
              [groupCount, 'mobile.settings.stats.groups'],
              [momentsCount, 'mobile.settings.stats.moments'],
            ].map(([value, key]) => <div className="settings-stat" key={key}>
              <Text strong className="settings-stat-value">{value}</Text>
              <Text type="secondary" className="settings-stat-label">{t(String(key))}</Text>
            </div>)}
          </div>
        </Card>
      </button>
      {settingGroups.map((group) => <div key={group.titleKey} className="settings-group-block">
        <div className="settings-group-block-title">{t(group.titleKey)}</div>
        <Card className="settings-group-card" variant="borderless">
          {group.items.map((item, index) => {
            const Icon = item.icon;
            return <button type="button" key={item.id}
              className={`setting-row ${index > 0 ? 'setting-row--border' : ''}`}
              data-setting-id={item.id} disabled={item.availability === 'pending'}
              aria-disabled={item.availability === 'pending'}
              onClick={() => onOpenSetting(item.id)}>
              <span className="setting-row-icon" style={{ color: 'var(--brand-primary)' }}><Icon size={17} /></span>
              <Text className="setting-row-label">{t(item.labelKey)}</Text>
              {item.availability === 'pending'
                ? <Text type="secondary" className="setting-row-value">{t('mobile.settings.agent.pending')}</Text>
                : values[item.id] ? <Text type="secondary" className="setting-row-value">{values[item.id]}</Text> : null}
              {item.availability === 'pending' ? null : <ChevronRight size={17} />}
            </button>;
          })}
        </Card>
      </div>)}
      <button type="button" className="settings-sign-out" onClick={onRequestLogout} disabled={loggingOut}>
        {t(loggingOut ? 'mobile.settings.station.loggingOut' : 'mobile.settings.signOut')}
      </button>
    </div>
  </div>;
}
