import type { ReactNode } from 'react';
import {
  Avatar,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  Spin,
  Switch,
  Tag,
  Typography,
} from 'antd';
import {
  ArrowLeft,
  Ban,
  Bell,
  Check,
  ChevronRight,
  Fingerprint,
  Globe,
  HardDrive,
  Image as ImageIcon,
  MessageCircle,
  Palette,
  RefreshCw,
  Server,
  Shield,
  ShieldCheck,
  Trash2,
  User,
} from 'lucide-react';

import {
  setSettingsSurfaceFixture,
  settingsSurfaceFixtureRoute,
  type SettingsSurfaceFixtureId,
} from '../../acceptance/settingsSurfaceFixture';
import {
  applyMobileNavigationIntent,
  type MobileSettingDetailId,
} from '../../app/navigation';
import { useMobileI18n } from '../../app/mobileI18n';
import { MobileNotice } from '../../components/MobileNotice';

const { Text } = Typography;

const SETTING_LABELS: Record<MobileSettingDetailId, string> = {
  'account-info': 'mobile.settings.accountInfo',
  notifications: 'mobile.settings.section.notifications',
  'privacy-security': 'mobile.settings.privacySecurity',
  'safety-number': 'mobile.settings.safetyNumber',
  'blocked-users': 'mobile.settings.blockedUsers',
  'chat-settings': 'mobile.settings.chatSettings',
  'chat-background': 'mobile.settings.chatBackground',
  'station-connection': 'mobile.settings.stationConnection',
  encryption: 'mobile.settings.encryption',
  language: 'mobile.settings.section.language',
  about: 'mobile.settings.aboutApp',
};

const SUMMARY_DETAILS: ReadonlyArray<{
  readonly id: MobileSettingDetailId;
  readonly icon: ReactNode;
  readonly value?: string;
}> = [
  { id: 'account-info', icon: <User size={17} /> },
  { id: 'notifications', icon: <Bell size={17} /> },
  { id: 'privacy-security', icon: <Shield size={17} /> },
  { id: 'safety-number', icon: <Fingerprint size={17} /> },
  { id: 'blocked-users', icon: <Ban size={17} />, value: '2' },
  { id: 'chat-settings', icon: <MessageCircle size={17} /> },
  { id: 'chat-background', icon: <ImageIcon size={17} /> },
  { id: 'station-connection', icon: <Server size={17} />, value: 'Product Station' },
  { id: 'encryption', icon: <ShieldCheck size={17} /> },
  { id: 'language', icon: <Globe size={17} />, value: 'English' },
  { id: 'about', icon: <ShieldCheck size={17} />, value: '1.0.0' },
];

const SUMMARY_SURFACES = new Set<SettingsSurfaceFixtureId>([
  'settings.summary',
  'settings.summary-loading',
  'settings.summary-error',
]);

const OVERLAY_SURFACES = new Set<SettingsSurfaceFixtureId>([
  'settings.station-change',
  'settings.unsaved-exit',
  'settings.logout-confirm',
]);

export function SettingsAcceptanceSurface({
  surfaceId,
}: {
  readonly surfaceId: SettingsSurfaceFixtureId;
}) {
  if (SUMMARY_SURFACES.has(surfaceId)) {
    return <SettingsFixtureSummary surfaceId={surfaceId} />;
  }
  if (OVERLAY_SURFACES.has(surfaceId)) {
    return <SettingsFixtureOverlay surfaceId={surfaceId} />;
  }
  return <SettingsFixtureDetail surfaceId={surfaceId} />;
}

function openSetting(settingId: MobileSettingDetailId): void {
  applyMobileNavigationIntent({
    kind: 'detail.push',
    route: { routeId: 'detail:setting', settingId },
  });
  setSettingsSurfaceFixture(`settings.${settingId}` as SettingsSurfaceFixtureId);
}

function SettingsFixtureSummary({
  surfaceId = 'settings.summary',
  background = false,
}: {
  readonly surfaceId?: SettingsSurfaceFixtureId;
  readonly background?: boolean;
}) {
  const { t } = useMobileI18n();
  const loading = surfaceId === 'settings.summary-loading';
  const failed = surfaceId === 'settings.summary-error';

  return (
    <div
      className="page-container settings-page settings-acceptance-fixture"
      data-product-surface={background ? undefined : surfaceId}
      aria-hidden={background || undefined}
    >
      <header className="page-header">
        <h1 className="header-title">{t('mobile.settings.title')}</h1>
        <button
          type="button"
          className="header-action"
          aria-label={t('mobile.settings.accountInfo')}
          onClick={() => openSetting('account-info')}
        >
          <User size={20} />
        </button>
      </header>
      <div className="settings-body settings-fixture-summary">
        {loading ? (
          <FixtureState>
            <Spin />
            <Text>{t('common.state.loading')}</Text>
          </FixtureState>
        ) : failed ? (
          <FixtureState>
            <MobileNotice>
              {t('common.state.error')}
              <Button icon={<RefreshCw size={15} />}>
                {t('common.action.retry')}
              </Button>
            </MobileNotice>
          </FixtureState>
        ) : (
          <>
            <Card className="settings-profile-header-card" variant="borderless">
              <div className="settings-profile-header">
                <Avatar className="settings-fixture-avatar" size={64}>AC</Avatar>
                <div className="settings-profile-info">
                  <Text strong className="settings-profile-name">Alice Chen</Text>
                  <Text type="secondary" className="settings-profile-subtitle">
                    {t('mobile.settings.connected')}
                  </Text>
                </div>
                <ChevronRight size={20} />
              </div>
              <div className="settings-profile-stats">
                {[
                  ['128', 'mobile.settings.stats.friends'],
                  ['12', 'mobile.settings.stats.groups'],
                  ['34', 'mobile.settings.stats.moments'],
                ].map(([value, label], index) => (
                  <span className="settings-fixture-stat-fragment" key={label}>
                    {index > 0 ? <span className="settings-stat-divider" /> : null}
                    <span className="settings-stat">
                      <Text strong className="settings-stat-value">{value}</Text>
                      <Text type="secondary" className="settings-stat-label">
                        {t(label)}
                      </Text>
                    </span>
                  </span>
                ))}
              </div>
            </Card>
            <Card className="settings-group-card" variant="borderless">
              {SUMMARY_DETAILS.map((item, index) => (
                <button
                  type="button"
                  className={`setting-row ${index > 0 ? 'setting-row--border' : ''}`}
                  data-settings-fixture-open={item.id}
                  key={item.id}
                  onClick={() => openSetting(item.id)}
                >
                  <span className="setting-row-icon">{item.icon}</span>
                  <Text className="setting-row-label">{t(SETTING_LABELS[item.id])}</Text>
                  {item.value ? <Text type="secondary">{item.value}</Text> : null}
                  <ChevronRight size={17} />
                </button>
              ))}
            </Card>
            <button
              type="button"
              className="settings-sign-out"
              data-settings-fixture-logout
              onClick={() => setSettingsSurfaceFixture('settings.logout-confirm')}
            >
              {t('mobile.settings.signOut')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function SettingsFixtureDetail({
  surfaceId,
  background = false,
}: {
  readonly surfaceId: SettingsSurfaceFixtureId;
  readonly background?: boolean;
}) {
  const { t } = useMobileI18n();
  const route = settingsSurfaceFixtureRoute(surfaceId);
  const settingId = route.settingId ?? 'account-info';
  const productSurface = background ? undefined : surfaceId;

  const back = () => {
    if (surfaceId === 'settings.detail-dirty') {
      setSettingsSurfaceFixture('settings.unsaved-exit');
      return;
    }
    applyMobileNavigationIntent({ kind: 'detail.pop' });
    setSettingsSurfaceFixture('settings.summary');
  };

  return (
    <div
      className="page-container settings-page mobile-detail-page settings-acceptance-fixture"
      data-product-surface={productSurface}
      aria-hidden={background || undefined}
    >
      <header className="page-header">
        <button
          type="button"
          className="header-action"
          data-settings-fixture-back
          aria-label={t('common.action.back')}
          onClick={back}
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="header-title compact">{t(SETTING_LABELS[settingId])}</h1>
      </header>
      <div className="settings-detail-body settings-fixture-detail">
        <SettingsFixtureState surfaceId={surfaceId} />
        <SettingsFixtureContent settingId={settingId} surfaceId={surfaceId} />
      </div>
    </div>
  );
}

function SettingsFixtureState({
  surfaceId,
}: {
  readonly surfaceId: SettingsSurfaceFixtureId;
}) {
  const { t } = useMobileI18n();
  if (surfaceId === 'settings.detail-dirty') {
    return (
      <section className="settings-dirty-bar">
        <Text>{t('mobile.settings.dirty.unsavedChanges')}</Text>
        <div className="settings-dirty-buttons">
          <Button>{t('mobile.settings.dirty.discardChanges')}</Button>
          <Button
            type="primary"
            data-settings-fixture-save
            onClick={() => setSettingsSurfaceFixture('settings.detail-saving')}
          >
            {t('mobile.settings.dirty.saveChanges')}
          </Button>
        </div>
      </section>
    );
  }
  if (surfaceId === 'settings.detail-saving') {
    return (
      <MobileNotice tone="info">
        <Spin size="small" />
        {t('mobile.settings.dirty.saving')}
      </MobileNotice>
    );
  }
  if (surfaceId === 'settings.detail-saved') {
    return (
      <MobileNotice tone="success">
        <Check size={16} />
        {t('mobile.settings.dirty.saved')}
      </MobileNotice>
    );
  }
  if (surfaceId === 'settings.detail-conflict') {
    return (
      <MobileNotice>
        {t('mobile.settings.dirty.conflict')}
        <Button data-settings-fixture-reload>{t('mobile.settings.dirty.reload')}</Button>
      </MobileNotice>
    );
  }
  if (surfaceId === 'settings.detail-unavailable') {
    return (
      <MobileNotice>
        {t('mobile.launch.unavailable')}
        <Button data-settings-fixture-retry>{t('common.action.retry')}</Button>
      </MobileNotice>
    );
  }
  if (surfaceId === 'settings.permission-loading') {
    return (
      <MobileNotice tone="info">
        <Spin size="small" />
        {t('mobile.settings.storage.calculating')}
      </MobileNotice>
    );
  }
  if (surfaceId === 'settings.permission-denied') {
    return (
      <MobileNotice>
        {t('mobile.settings.permissions.status.denied')}
        <Button data-settings-fixture-permission>
          {t('common.action.enable')}
        </Button>
      </MobileNotice>
    );
  }
  if (surfaceId === 'settings.detail-failed') {
    return (
      <MobileNotice>
        {t('mobile.settings.dirty.saveFailed')}
        <Button data-settings-fixture-retry>{t('common.action.retry')}</Button>
      </MobileNotice>
    );
  }
  return null;
}

function SettingsFixtureContent({
  settingId,
  surfaceId,
}: {
  readonly settingId: MobileSettingDetailId;
  readonly surfaceId: SettingsSurfaceFixtureId;
}) {
  const { t } = useMobileI18n();
  if (settingId === 'account-info') {
    return (
      <Card className="settings-section" variant="borderless">
        <div className="settings-section-header">
          <User size={16} />
          <Text strong>{t('mobile.settings.section.profile')}</Text>
        </div>
        <label className="settings-profile-field">
          <Text type="secondary">{t('mobile.settings.profile.displayName')}</Text>
          <Input
            aria-label={t('mobile.settings.profile.displayName')}
            value="Alice Chen"
            readOnly
          />
        </label>
        <label className="settings-profile-field">
          <Text type="secondary">{t('mobile.settings.profile.bio')}</Text>
          <Input.TextArea
            aria-label={t('mobile.settings.profile.bio')}
            value="Design systems and launch readiness."
            autoSize={{ minRows: 2, maxRows: 3 }}
            readOnly
          />
        </label>
        <Button
          data-settings-fixture-change
          onClick={() => setSettingsSurfaceFixture('settings.detail-dirty')}
        >
          {t('mobile.settings.profile.editProfile')}
        </Button>
      </Card>
    );
  }
  if (settingId === 'notifications') {
    return (
      <Card className="settings-section" variant="borderless">
        <div className="settings-section-header">
          <Bell size={16} />
          <Text strong>{t('mobile.settings.section.notifications')}</Text>
        </div>
        {[
          'mobile.settings.notifications.enabled',
          'mobile.settings.notifications.push',
          'mobile.settings.notifications.sound',
        ].map((label, index) => (
          <div className="settings-row" key={label}>
            <Text>{t(label)}</Text>
            <Switch
              aria-label={t(label)}
              checked={index !== 2}
            />
          </div>
        ))}
      </Card>
    );
  }
  if (settingId === 'privacy-security') {
    return (
      <>
        <Card className="settings-section" variant="borderless">
          <div className="settings-section-header">
            <Shield size={16} />
            <Text strong>{t('mobile.settings.section.privacy')}</Text>
          </div>
          <div className="settings-row">
            <Text>{t('mobile.settings.privacy.defaultVisibility')}</Text>
            <select
              className="settings-fixture-select"
              aria-label={t('mobile.settings.privacy.defaultVisibility')}
              value="followers"
              onChange={() => undefined}
            >
              <option value="followers">
                {t('mobile.settings.privacy.visibility.followers')}
              </option>
            </select>
          </div>
          <div className="settings-row">
            <Text>{t('mobile.settings.privacy.messagePermission')}</Text>
            <select
              className="settings-fixture-select"
              aria-label={t('mobile.settings.privacy.messagePermission')}
              value="friends"
              onChange={() => undefined}
            >
              <option value="friends">
                {t('mobile.settings.privacy.message.friends')}
              </option>
            </select>
          </div>
        </Card>
        <Card className="settings-section" variant="borderless">
          <div className="settings-section-header">
            <ShieldCheck size={16} />
            <Text strong>{t('mobile.settings.section.permissions')}</Text>
          </div>
          <div className="settings-row">
            <Text>{t('mobile.settings.permissions.camera')}</Text>
            <Tag color={surfaceId === 'settings.permission-denied' ? 'red' : 'green'}>
              {t(surfaceId === 'settings.permission-denied'
                ? 'mobile.settings.permissions.status.denied'
                : 'mobile.settings.permissions.status.granted')}
            </Tag>
          </div>
        </Card>
      </>
    );
  }
  if (settingId === 'blocked-users') {
    return (
      <Card className="settings-section" variant="borderless">
        <div className="settings-section-header">
          <Ban size={16} />
          <Text strong>{t('mobile.settings.section.blocked')}</Text>
        </div>
        {['Morgan Lee', 'Jordan Kim'].map((name) => (
          <div className="settings-row" key={name}>
            <Avatar>{name.slice(0, 1)}</Avatar>
            <span className="settings-fixture-person">
              <Text strong>{name}</Text>
              <Text type="secondary">@{name.split(' ')[0].toLowerCase()}@design.peers</Text>
            </span>
            <Button>{t('mobile.contacts.unblock')}</Button>
          </div>
        ))}
      </Card>
    );
  }
  if (settingId === 'chat-settings') {
    return <SettingsFixtureStorage surfaceId={surfaceId} />;
  }
  if (settingId === 'station-connection') {
    return (
      <Card className="settings-section" variant="borderless">
        <div className="settings-section-header">
          <Server size={16} />
          <Text strong>{t('mobile.settings.section.station')}</Text>
        </div>
        <div className="settings-row">
          <span className="settings-fixture-person">
            <Text strong>Product Station</Text>
            <Text type="secondary">{t('mobile.settings.connected')}</Text>
          </span>
          <Tag color="green">{t('mobile.launch.verified')}</Tag>
        </div>
        <Button
          data-settings-fixture-change-station
          onClick={() => setSettingsSurfaceFixture('settings.station-change')}
        >
          {t('mobile.settings.station.changeStation')}
        </Button>
      </Card>
    );
  }
  if (settingId === 'language') {
    return (
      <Card className="settings-section" variant="borderless">
        <div className="settings-section-header">
          <Globe size={16} />
          <Text strong>{t('mobile.settings.section.language')}</Text>
        </div>
        <select
          className="settings-fixture-select"
          aria-label={t('mobile.settings.section.language')}
          value="en"
          onChange={() => undefined}
        >
          <option value="en">English</option>
          <option value="zh-CN">简体中文</option>
        </select>
      </Card>
    );
  }
  if (settingId === 'safety-number' || settingId === 'chat-background') {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={t('mobile.launch.unavailable')}
      />
    );
  }
  return (
    <Card className="settings-section" variant="borderless">
      <div className="settings-section-header">
        <ShieldCheck size={16} />
        <Text strong>{t(SETTING_LABELS[settingId])}</Text>
      </div>
      <div className="settings-row">
        <Text>{t(SETTING_LABELS[settingId])}</Text>
        <Text type="secondary">
          {settingId === 'about' ? '1.0.0' : t('mobile.launch.unavailable')}
        </Text>
      </div>
    </Card>
  );
}

function SettingsFixtureStorage({
  surfaceId,
}: {
  readonly surfaceId: SettingsSurfaceFixtureId;
}) {
  const { t } = useMobileI18n();
  const managing = surfaceId === 'settings.storage-manage'
    || surfaceId === 'settings.storage-confirm'
    || surfaceId === 'settings.storage-progress'
    || surfaceId === 'settings.storage-partial-failure';
  const confirming = surfaceId === 'settings.storage-confirm';
  const progress = surfaceId === 'settings.storage-progress';
  const partial = surfaceId === 'settings.storage-partial-failure';
  const clearConfirm = surfaceId === 'settings.storage-clear-confirm';
  const clearFailed = surfaceId === 'settings.storage-clear-failed';

  return (
    <>
      <Card className="settings-section" variant="borderless">
        <div className="settings-section-header">
          <Palette size={16} />
          <Text strong>{t('mobile.settings.section.devicePrefs')}</Text>
        </div>
        <div className="settings-row">
          <Text>{t('mobile.settings.device.theme')}</Text>
          <select
            className="settings-fixture-select"
            aria-label={t('mobile.settings.device.theme')}
            value="system"
            onChange={() => undefined}
          >
            <option value="system">{t('mobile.settings.device.theme.system')}</option>
          </select>
        </div>
        <div className="settings-row">
          <Text>{t('mobile.settings.device.fontSize')}</Text>
          <select
            className="settings-fixture-select"
            aria-label={t('mobile.settings.device.fontSize')}
            value="medium"
            onChange={() => undefined}
          >
            <option value="medium">{t('mobile.settings.device.fontSize.medium')}</option>
          </select>
        </div>
      </Card>
      <Card className="settings-section" variant="borderless">
        <div className="settings-section-header">
          <HardDrive size={16} />
          <Text strong>{t('mobile.settings.section.storage')}</Text>
          <Button
            data-settings-fixture-storage-manage
            onClick={() => setSettingsSurfaceFixture('settings.storage-manage')}
          >
            {t(managing
              ? 'mobile.settings.storage.batchDone'
              : 'mobile.settings.storage.batchManage')}
          </Button>
        </div>
        <div className="settings-row">
          {managing ? (
            <Checkbox
              aria-label={t('mobile.settings.storage.batchSelectConversation', {
                name: 'Launch Readiness',
              })}
              checked
            />
          ) : null}
          <span className="settings-fixture-person">
            <Text strong>Launch Readiness</Text>
            <Text type="secondary">48 MB</Text>
          </span>
          {managing && !confirming && !progress ? (
            <Button
              danger
              data-settings-fixture-storage-select
              onClick={() => setSettingsSurfaceFixture('settings.storage-confirm')}
            >
              {t('mobile.settings.storage.batchClearSelected')}
            </Button>
          ) : null}
        </div>
        {confirming ? (
          <MobileNotice tone="info">
            {t('mobile.settings.storage.batchConfirm', { bytes: '48 MB', count: 1 })}
            <Button
              danger
              data-settings-fixture-storage-confirm
              onClick={() => setSettingsSurfaceFixture('settings.storage-progress')}
            >
              {t('mobile.settings.storage.batchConfirmAction')}
            </Button>
          </MobileNotice>
        ) : null}
        {progress ? (
          <div className="settings-row" role="status">
            <Spin size="small" />
            <Text>{t('mobile.settings.storage.batchProgress', {
              completedCount: 1,
              totalCount: 2,
            })}</Text>
          </div>
        ) : null}
        {partial ? (
          <MobileNotice>
            {t('mobile.settings.storage.batchPartial', {
              bytes: '24 MB',
              failed: 1,
              succeeded: 1,
              total: 2,
            })}
            <Button data-settings-fixture-storage-retry>
              {t('mobile.settings.storage.batchRetry')}
            </Button>
          </MobileNotice>
        ) : null}
        <div className="settings-row">
          <Text>{t('mobile.settings.storage.retentionTitle')}</Text>
          <Button
            data-settings-fixture-retention
            onClick={() => setSettingsSurfaceFixture('settings.storage-retention')}
          >
            {t('mobile.settings.storage.retention90Days')}
          </Button>
        </div>
        {surfaceId === 'settings.storage-retention' ? (
          <MobileNotice tone="success">
            {t('mobile.settings.storage.retentionSaved')}
          </MobileNotice>
        ) : null}
        {!clearConfirm ? (
          <Button
            data-settings-fixture-clear-cache
            icon={<Trash2 size={15} />}
            onClick={() => setSettingsSurfaceFixture('settings.storage-clear-confirm')}
          >
            {t('mobile.settings.storage.clearChatCacheAction')}
          </Button>
        ) : (
          <MobileNotice tone="info">
            {t('mobile.settings.storage.clearChatCacheConfirm')}
            <Button danger>{t('mobile.settings.storage.clearChatCacheConfirmAction')}</Button>
          </MobileNotice>
        )}
        {clearFailed ? (
          <MobileNotice>
            {t('mobile.settings.storage.clearChatCacheFailed')}
            <Button data-settings-fixture-clear-retry>{t('common.action.retry')}</Button>
          </MobileNotice>
        ) : null}
      </Card>
    </>
  );
}

function SettingsFixtureOverlay({
  surfaceId,
}: {
  readonly surfaceId: SettingsSurfaceFixtureId;
}) {
  const { t } = useMobileI18n();
  const stationChange = surfaceId === 'settings.station-change';
  const unsaved = surfaceId === 'settings.unsaved-exit';

  return (
    <>
      {surfaceId === 'settings.logout-confirm' ? (
        <SettingsFixtureSummary background />
      ) : (
        <SettingsFixtureDetail
          background
          surfaceId={unsaved ? 'settings.detail-dirty' : 'settings.station-connection'}
        />
      )}
      <div className="settings-fixture-backdrop">
        <section
          className="settings-fixture-sheet"
          data-product-surface={surfaceId}
          data-acceptance-id={unsaved ? 'settings-unsaved-exit' : undefined}
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-fixture-dialog-title"
        >
          <h2 id="settings-fixture-dialog-title">
            {t(stationChange
              ? 'mobile.settings.station.changeStation'
              : unsaved
                ? 'mobile.settings.exit.title'
                : 'mobile.settings.station.logoutConfirmTitle')}
          </h2>
          <Text>
            {t(stationChange
              ? 'mobile.settings.connected'
              : unsaved
                ? 'mobile.settings.exit.body'
                : 'mobile.settings.station.logoutConfirmBody')}
          </Text>
          {stationChange ? (
            <div className="settings-fixture-station-choice">
              <Server size={18} />
              <span className="settings-fixture-person">
                <Text strong>Product Station</Text>
                <Text type="secondary">{t('mobile.launch.verified')}</Text>
              </span>
              <Check size={18} />
            </div>
          ) : null}
          <div className="settings-fixture-sheet-actions">
            <Button>{t(unsaved ? 'mobile.settings.exit.stay' : 'common.action.cancel')}</Button>
            {unsaved ? (
              <>
                <Button danger>{t('mobile.settings.exit.discard')}</Button>
                <Button type="primary">{t('mobile.settings.exit.save')}</Button>
              </>
            ) : (
              <Button danger type="primary">
                {t(stationChange
                  ? 'mobile.settings.station.changeStation'
                  : 'mobile.settings.logout')}
              </Button>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function FixtureState({ children }: { readonly children: ReactNode }) {
  return (
    <section className="settings-fixture-state" role="status">
      {children}
    </section>
  );
}
