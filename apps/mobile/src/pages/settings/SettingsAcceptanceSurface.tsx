import type { ReactNode } from 'react';
import {
  Button,
  Checkbox,
  Empty,
  Icon,
  type IconId,
  Spin,
  Switch,
  Tag,
  Text,
  TextArea,
  TextField,
} from '@peers-touch/ui';

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
import { MobileAvatar } from '../../components/MobileAvatar';
import { MobileNotice } from '../../components/MobileNotice';

const FIXTURE_ACCOUNT_INITIALS = 'AC';
const FIXTURE_ACCOUNT_NAME = 'Alice Chen';
const FIXTURE_CONVERSATION_NAME = 'Launch Readiness';
const FIXTURE_LANGUAGE_NAMES = {
  en: 'English',
  'zh-CN': '简体中文',
} as const;
const FIXTURE_STATION_NAME = 'Product Station';

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
  readonly iconId: IconId;
  readonly value?: string;
}> = [
  { id: 'account-info', iconId: 'user' },
  { id: 'notifications', iconId: 'bell' },
  { id: 'privacy-security', iconId: 'shield' },
  { id: 'safety-number', iconId: 'identity-fingerprint' },
  { id: 'blocked-users', iconId: 'ban', value: '2' },
  { id: 'chat-settings', iconId: 'message-circle' },
  { id: 'chat-background', iconId: 'image' },
  { id: 'station-connection', iconId: 'server', value: FIXTURE_STATION_NAME },
  { id: 'encryption', iconId: 'shield-check' },
  { id: 'language', iconId: 'globe', value: FIXTURE_LANGUAGE_NAMES.en },
  { id: 'about', iconId: 'shield-check', value: '1.0.0' },
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
          <Icon iconId="user" size={20} />
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
              <Button
                actionId="settings.fixture.retry-summary"
                leading={<Icon iconId="rotate-ccw" size={15} />}
              >
                {t('common.action.retry')}
              </Button>
            </MobileNotice>
          </FixtureState>
        ) : (
          <>
            <div className="settings-profile-header-card">
              <div className="settings-profile-header">
                <MobileAvatar className="settings-fixture-avatar" size={64} name={FIXTURE_ACCOUNT_NAME}>
                  {FIXTURE_ACCOUNT_INITIALS}
                </MobileAvatar>
                <div className="settings-profile-info">
                  <Text strong className="settings-profile-name">
                    {FIXTURE_ACCOUNT_NAME}
                  </Text>
                  <Text tone="secondary" className="settings-profile-subtitle">
                    {t('mobile.settings.connected')}
                  </Text>
                </div>
                <Icon iconId="chevron-right" size={20} />
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
                      <Text tone="secondary" className="settings-stat-label">
                        {t(label)}
                      </Text>
                    </span>
                  </span>
                ))}
              </div>
            </div>
            <div className="settings-group-card">
              {SUMMARY_DETAILS.map((item, index) => (
                <button
                  type="button"
                  className={`setting-row ${index > 0 ? 'setting-row--border' : ''}`}
                  data-settings-fixture-open={item.id}
                  key={item.id}
                  onClick={() => openSetting(item.id)}
                >
                  <span className="setting-row-icon"><Icon iconId={item.iconId} size={17} /></span>
                  <Text className="setting-row-label">{t(SETTING_LABELS[item.id])}</Text>
                  {item.value ? <Text tone="secondary">{item.value}</Text> : null}
                  <Icon iconId="chevron-right" size={17} />
                </button>
              ))}
            </div>
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
          <Icon iconId="arrow-left" size={20} />
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
          <Button actionId="settings.fixture.discard-changes">
            {t('mobile.settings.dirty.discardChanges')}
          </Button>
          <Button
            actionId="settings.fixture.save"
            emphasis="primary"
            data-settings-fixture-save
            onActivate={() => setSettingsSurfaceFixture('settings.detail-saving')}
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
        <Icon iconId="check" size={16} />
        {t('mobile.settings.dirty.saved')}
      </MobileNotice>
    );
  }
  if (surfaceId === 'settings.detail-conflict') {
    return (
      <MobileNotice>
        {t('mobile.settings.dirty.conflict')}
        <Button actionId="settings.fixture.reload" data-settings-fixture-reload>
          {t('mobile.settings.dirty.reload')}
        </Button>
      </MobileNotice>
    );
  }
  if (surfaceId === 'settings.detail-unavailable') {
    return (
      <MobileNotice>
        {t('mobile.launch.unavailable')}
        <Button actionId="settings.fixture.retry-detail" data-settings-fixture-retry>
          {t('common.action.retry')}
        </Button>
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
        <Button actionId="settings.fixture.enable-permission" data-settings-fixture-permission>
          {t('common.action.enable')}
        </Button>
      </MobileNotice>
    );
  }
  if (surfaceId === 'settings.detail-failed') {
    return (
      <MobileNotice>
        {t('mobile.settings.dirty.saveFailed')}
        <Button actionId="settings.fixture.retry-save" data-settings-fixture-retry>
          {t('common.action.retry')}
        </Button>
      </MobileNotice>
    );
  }
  return null;
}

function SettingsSection({
  iconId,
  title,
  children,
}: {
  readonly iconId: IconId;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="settings-section">
      <div className="settings-section-body">
        <div className="settings-section-header">
          <Icon iconId={iconId} size={16} />
          <Text strong>{title}</Text>
        </div>
        {children}
      </div>
    </section>
  );
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
      <SettingsSection iconId="user" title={t('mobile.settings.section.profile')}>
        <label className="settings-profile-field">
          <Text tone="secondary">{t('mobile.settings.profile.displayName')}</Text>
          <TextField
            aria-label={t('mobile.settings.profile.displayName')}
            value="Alice Chen"
            readOnly
          />
        </label>
        <label className="settings-profile-field">
          <Text tone="secondary">{t('mobile.settings.profile.bio')}</Text>
          <TextArea
            aria-label={t('mobile.settings.profile.bio')}
            value="Design systems and launch readiness."
            minimumRows={2}
            maximumRows={3}
            readOnly
          />
        </label>
        <Button
          actionId="settings.fixture.edit-profile"
          data-settings-fixture-change
          onActivate={() => setSettingsSurfaceFixture('settings.detail-dirty')}
        >
          {t('mobile.settings.profile.editProfile')}
        </Button>
      </SettingsSection>
    );
  }
  if (settingId === 'notifications') {
    return (
      <SettingsSection iconId="bell" title={t('mobile.settings.section.notifications')}>
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
      </SettingsSection>
    );
  }
  if (settingId === 'privacy-security') {
    return (
      <>
        <SettingsSection iconId="shield" title={t('mobile.settings.section.privacy')}>
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
        </SettingsSection>
        <SettingsSection iconId="shield-check" title={t('mobile.settings.section.permissions')}>
          <div className="settings-row">
            <Text>{t('mobile.settings.permissions.camera')}</Text>
            <Tag tone={surfaceId === 'settings.permission-denied' ? 'danger' : 'success'}>
              {t(surfaceId === 'settings.permission-denied'
                ? 'mobile.settings.permissions.status.denied'
                : 'mobile.settings.permissions.status.granted')}
            </Tag>
          </div>
        </SettingsSection>
      </>
    );
  }
  if (settingId === 'blocked-users') {
    return (
      <SettingsSection iconId="ban" title={t('mobile.settings.section.blocked')}>
        {['Morgan Lee', 'Jordan Kim'].map((name) => (
          <div className="settings-row" key={name}>
            <MobileAvatar name={name}>{name.slice(0, 1)}</MobileAvatar>
            <span className="settings-fixture-person">
              <Text strong>{name}</Text>
              <Text tone="secondary">@{name.split(' ')[0].toLowerCase()}@design.peers</Text>
            </span>
            <Button actionId={`settings.fixture.unblock.${name.split(' ')[0].toLowerCase()}`}>
              {t('mobile.contacts.unblock')}
            </Button>
          </div>
        ))}
      </SettingsSection>
    );
  }
  if (settingId === 'chat-settings') {
    return <SettingsFixtureStorage surfaceId={surfaceId} />;
  }
  if (settingId === 'station-connection') {
    return (
      <SettingsSection iconId="server" title={t('mobile.settings.section.station')}>
        <div className="settings-row">
          <span className="settings-fixture-person">
            <Text strong>{FIXTURE_STATION_NAME}</Text>
            <Text tone="secondary">{t('mobile.settings.connected')}</Text>
          </span>
          <Tag tone="success">{t('mobile.launch.verified')}</Tag>
        </div>
        <Button
          actionId="settings.fixture.change-station"
          data-settings-fixture-change-station
          onActivate={() => setSettingsSurfaceFixture('settings.station-change')}
        >
          {t('mobile.settings.station.changeStation')}
        </Button>
      </SettingsSection>
    );
  }
  if (settingId === 'language') {
    return (
      <SettingsSection iconId="globe" title={t('mobile.settings.section.language')}>
        <select
          className="settings-fixture-select"
          aria-label={t('mobile.settings.section.language')}
          value="en"
          onChange={() => undefined}
        >
          <option value="en">{FIXTURE_LANGUAGE_NAMES.en}</option>
          <option value="zh-CN">{FIXTURE_LANGUAGE_NAMES['zh-CN']}</option>
        </select>
      </SettingsSection>
    );
  }
  if (settingId === 'safety-number' || settingId === 'chat-background') {
    return (
      <Empty description={t('mobile.launch.unavailable')} />
    );
  }
  return (
    <SettingsSection iconId="shield-check" title={t(SETTING_LABELS[settingId])}>
      <div className="settings-row">
        <Text>{t(SETTING_LABELS[settingId])}</Text>
        <Text tone="secondary">
          {settingId === 'about' ? '1.0.0' : t('mobile.launch.unavailable')}
        </Text>
      </div>
    </SettingsSection>
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
      <SettingsSection iconId="palette" title={t('mobile.settings.section.devicePrefs')}>
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
      </SettingsSection>
      <SettingsSection iconId="hard-drive" title={t('mobile.settings.section.storage')}>
        <div className="settings-section-header">
          <Button
            actionId="settings.fixture.storage-manage"
            data-settings-fixture-storage-manage
            onActivate={() => setSettingsSurfaceFixture('settings.storage-manage')}
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
                name: FIXTURE_CONVERSATION_NAME,
              })}
              checked
            />
          ) : null}
          <span className="settings-fixture-person">
            <Text strong>{FIXTURE_CONVERSATION_NAME}</Text>
            <Text tone="secondary">48 MB</Text>
          </span>
          {managing && !confirming && !progress ? (
            <Button
              tone="danger"
              actionId="settings.fixture.storage-select"
              data-settings-fixture-storage-select
              onActivate={() => setSettingsSurfaceFixture('settings.storage-confirm')}
            >
              {t('mobile.settings.storage.batchClearSelected')}
            </Button>
          ) : null}
        </div>
        {confirming ? (
          <MobileNotice tone="info">
            {t('mobile.settings.storage.batchConfirm', { bytes: '48 MB', count: 1 })}
            <Button
              tone="danger"
              actionId="settings.fixture.storage-confirm"
              data-settings-fixture-storage-confirm
              onActivate={() => setSettingsSurfaceFixture('settings.storage-progress')}
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
            <Button actionId="settings.fixture.storage-retry" data-settings-fixture-storage-retry>
              {t('mobile.settings.storage.batchRetry')}
            </Button>
          </MobileNotice>
        ) : null}
        <div className="settings-row">
          <Text>{t('mobile.settings.storage.retentionTitle')}</Text>
          <Button
            actionId="settings.fixture.retention"
            data-settings-fixture-retention
            onActivate={() => setSettingsSurfaceFixture('settings.storage-retention')}
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
            actionId="settings.fixture.clear-cache"
            data-settings-fixture-clear-cache
            leading={<Icon iconId="delete" size={15} />}
            onActivate={() => setSettingsSurfaceFixture('settings.storage-clear-confirm')}
          >
            {t('mobile.settings.storage.clearChatCacheAction')}
          </Button>
        ) : (
          <MobileNotice tone="info">
            {t('mobile.settings.storage.clearChatCacheConfirm')}
            <Button tone="danger" actionId="settings.fixture.clear-cache-confirm">
              {t('mobile.settings.storage.clearChatCacheConfirmAction')}
            </Button>
          </MobileNotice>
        )}
        {clearFailed ? (
          <MobileNotice>
            {t('mobile.settings.storage.clearChatCacheFailed')}
            <Button actionId="settings.fixture.clear-retry" data-settings-fixture-clear-retry>
              {t('common.action.retry')}
            </Button>
          </MobileNotice>
        ) : null}
      </SettingsSection>
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
              <Icon iconId="server" size={18} />
              <span className="settings-fixture-person">
                <Text strong>{FIXTURE_STATION_NAME}</Text>
                <Text tone="secondary">{t('mobile.launch.verified')}</Text>
              </span>
              <Icon iconId="check" size={18} />
            </div>
          ) : null}
          <div className="settings-fixture-sheet-actions">
            <Button actionId="settings.fixture.dialog-cancel" fullWidth>
              {t(unsaved ? 'mobile.settings.exit.stay' : 'common.action.cancel')}
            </Button>
            {unsaved ? (
              <>
                <Button tone="danger" actionId="settings.fixture.exit-discard" fullWidth>
                  {t('mobile.settings.exit.discard')}
                </Button>
                <Button emphasis="primary" actionId="settings.fixture.exit-save" fullWidth>
                  {t('mobile.settings.exit.save')}
                </Button>
              </>
            ) : (
              <Button emphasis="primary" tone="danger" actionId="settings.fixture.dialog-confirm" fullWidth>
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
