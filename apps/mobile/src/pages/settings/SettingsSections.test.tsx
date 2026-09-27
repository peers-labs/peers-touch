import { create } from '@bufbuild/protobuf';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  NotificationCategory,
  NotificationPreferenceSchema,
} from '../../gen/proto/domain/notification/notification_pb';

const i18nMocks = vi.hoisted(() => ({
  setLanguage: vi.fn(async () => true),
  retryLanguage: vi.fn(async () => true),
}));

vi.mock('../../app/mobileI18n', () => ({
  useMobileI18n: () => ({
    t: (key: string) => key,
    language: 'en',
    languages: [
      { code: 'en', nativeName: 'English', shortName: 'EN' },
      { code: 'zh-CN', nativeName: '简体中文', shortName: '中文' },
    ],
    languageStatus: 'failed',
    languageError: 'mobile.settings.language.saveFailed',
    setLanguage: i18nMocks.setLanguage,
    retryLanguage: i18nMocks.retryLanguage,
  }),
}));

import {
  BlockedUsersSection,
  DevicePrefsSection,
  LanguageSection,
  NotificationPreferenceControls,
  NotificationsSection,
  PermissionsSection,
  PrivacySection,
  StationSection,
  StorageSection,
} from './SettingsSections';

const source = readFileSync(new URL('./SettingsSections.tsx', import.meta.url), 'utf8');

describe('Settings truthful unavailable and permission states', () => {
  const unavailableNotificationController = {
    preferences: [],
    loading: false,
    unavailable: true,
    dirty: false,
    conflict: false,
    saveStatus: 'idle',
    saveError: null,
    patch: vi.fn(),
    save: vi.fn(async () => true),
    discard: vi.fn(),
    reload: vi.fn(async () => undefined),
  } as const;
  const privacyProfile = {
    displayName: 'Alice',
    note: '',
    avatar: '',
    header: '',
    region: 'CN',
    timezone: 'Asia/Shanghai',
    defaultVisibility: 'followers',
    discoverability: 'by_handle',
    manuallyApprovesFollowers: true,
    messagePermission: 'friends',
    autoExpireDays: 30,
  } as const;

  it('preserves every native permission status and only exposes requestable actions', () => {
    const markup = renderToStaticMarkup(
      <PermissionsSection
        permissions={[
          { kind: 'camera', status: 'not_determined', canRequest: true },
          { kind: 'microphone', status: 'granted', canRequest: false },
          { kind: 'notifications', status: 'denied', canRequest: false },
          { kind: 'storage', status: 'restricted', canRequest: false },
          { kind: 'camera', status: 'unsupported', canRequest: false },
        ]}
        loading={false}
        unavailable={false}
        onRefresh={vi.fn()}
        onRequest={vi.fn()}
      />,
    );

    for (const status of [
      'not_determined',
      'granted',
      'denied',
      'restricted',
      'unsupported',
    ]) {
      expect(markup).toContain(`data-permission-status="${status}"`);
    }
    expect(markup.match(/common\.action\.enable/g)).toHaveLength(1);
    expect(markup).not.toContain('mobile.error.openSettings');
  });

  it('renders ownerless notifications as unavailable and owner-backed privacy controls', () => {
    const markup = renderToStaticMarkup(
      <>
        <NotificationsSection controller={unavailableNotificationController} />
        <PrivacySection
          profile={privacyProfile}
          disabled={false}
          onPatch={vi.fn()}
        />
        <StorageSection onClearCache={vi.fn()} status="idle" />
      </>,
    );

    expect(markup.match(/mobile\.launch\.unavailable/g)).toHaveLength(1);
    expect(markup).toContain('mobile.settings.storage.clearChatCacheAction');
    expect(markup).toContain('mobile.settings.storage.clearDeviceCache');
    expect(markup).toContain('data-chat-storage-refresh');
    expect(markup).toContain('data-chat-storage-clear-cache');
    expect(markup).toContain('data-chat-storage-retention');
    expect(markup).toContain('data-chat-storage-retention-select');
    expect(markup).toContain('data-mobile-device-cache-clear');
    expect(markup).not.toContain('mobile.settings.notifications.enabled');
    expect(markup).toContain('data-privacy-setting="defaultVisibility"');
    expect(markup).toContain('data-privacy-setting="manuallyApprovesFollowers"');
    expect(markup).toContain('data-privacy-setting="messagePermission"');
    expect(markup).toContain('data-privacy-setting="autoExpireDays"');
  });

  it('exposes batch selection, confirmation, progress, result, and retry controls', () => {
    for (const selector of [
      'data-chat-storage-batch-manage',
      'data-chat-storage-batch-select-all',
      'data-chat-storage-conversation-select',
      'data-chat-storage-batch-clear',
      'data-chat-storage-batch-confirm',
      'data-chat-storage-batch-confirm-apply',
      'data-chat-storage-batch-progress',
      'data-chat-storage-batch-result',
      'data-chat-storage-batch-retry',
    ]) {
      expect(source).toContain(selector);
    }
    expect(source).toContain('mobileChatStorageProjectionRuntime.clearConversations(');
  });

  it('distinguishes unavailable, empty, and owner-backed blocked-user states', () => {
    const unavailable = renderToStaticMarkup(
      <BlockedUsersSection
        users={[]}
        status="unavailable"
        errorKey={null}
        unblockingPtid={null}
        onRetry={vi.fn(async () => undefined)}
        onUnblock={vi.fn(async () => undefined)}
      />,
    );
    const empty = renderToStaticMarkup(
      <BlockedUsersSection
        users={[]}
        status="ready"
        errorKey={null}
        unblockingPtid={null}
        onRetry={vi.fn(async () => undefined)}
        onUnblock={vi.fn(async () => undefined)}
      />,
    );
    const populated = renderToStaticMarkup(
      <BlockedUsersSection
        users={[{
          targetPtid: 'ptid:bob',
          displayName: 'Bob',
          avatar: '',
          homeStationPeerId: 'station-b',
        }]}
        status="ready"
        errorKey={null}
        unblockingPtid={null}
        onRetry={vi.fn(async () => undefined)}
        onUnblock={vi.fn(async () => undefined)}
      />,
    );

    expect(unavailable).toContain('mobile.launch.unavailable');
    expect(unavailable).toContain('common.action.retry');
    expect(empty).toContain('mobile.settings.noBlockedUsers');
    expect(empty).not.toContain('mobile.launch.unavailable');
    expect(populated).toContain('data-blocked-user="ptid:bob"');
    expect(populated).toContain('Bob');
    expect(populated).toContain('ptid:bob');
    expect(populated).toContain('station-b');
    expect(populated).toContain('mobile.contacts.unblock');
  });

  it('keeps device controls disabled when persisted preferences are unavailable', () => {
    const markup = renderToStaticMarkup(
      <DevicePrefsSection
        prefs={null}
        loading={false}
        unavailable
        onPatch={vi.fn()}
        onRetry={vi.fn(async () => undefined)}
      />,
    );

    expect(markup).toContain('mobile.settings.device.unavailable');
    expect(markup).toContain('common.action.retry');
    expect(markup).not.toContain('mobile.settings.device.theme.system');
  });

  it('shows failed language persistence without projecting another selection', () => {
    const markup = renderToStaticMarkup(<LanguageSection />);

    expect(markup).toContain('mobile.settings.language.saveFailed');
    expect(markup).toContain('common.action.retry');
    expect(markup).toContain('English');
  });

  it('renders generated Notification preference readback without privacy defaults', () => {
    const markup = renderToStaticMarkup(
      <NotificationPreferenceControls
        controller={{
          preferences: [
            create(NotificationPreferenceSchema, {
              actorPtid: 'ptid:alice',
              category: NotificationCategory.SOCIAL,
              enabled: true,
              pushEnabled: true,
              soundEnabled: false,
            }),
            create(NotificationPreferenceSchema, {
              actorPtid: 'ptid:alice',
              category: NotificationCategory.CHAT,
              enabled: false,
              pushEnabled: true,
              soundEnabled: false,
            }),
          ],
          loading: false,
          unavailable: false,
          dirty: true,
          conflict: false,
          saveStatus: 'idle',
          saveError: null,
          patch: vi.fn(),
          save: vi.fn(async () => true),
          discard: vi.fn(),
          reload: vi.fn(async () => undefined),
        }}
      />,
    );

    expect(markup).toContain('data-notification-setting="enabled"');
    expect(markup).toContain('data-notification-value="mixed"');
    expect(markup).toContain('data-notification-setting="pushEnabled"');
    expect(markup).toContain('data-notification-value="enabled"');
    expect(markup).toContain('data-notification-setting="soundEnabled"');
    expect(markup).toContain('data-notification-value="disabled"');
    expect(markup).not.toContain('mobile.settings.dirty.unsavedChanges');
    expect(markup).not.toContain('mobile.settings.privacy.defaultVisibility');
  });

  it('exposes native notification permission-required state beside preferences', () => {
    const markup = renderToStaticMarkup(
      <NotificationPreferenceControls
        controller={unavailableNotificationController}
        permission={{
          kind: 'notifications',
          status: 'not_determined',
          canRequest: true,
        }}
        permissionLoading={false}
        permissionUnavailable={false}
        onRequestPermission={vi.fn(async () => undefined)}
      />,
    );

    expect(markup).toContain(
      'data-notification-permission-required="not_determined"',
    );
    expect(markup).toContain('mobile.settings.permissions.hint');
    expect(markup).toContain('common.action.enable');
  });

  it('renders Station trust from verified identity, not reachability', () => {
    const markup = renderToStaticMarkup(
      <StationSection
        stationLabel="Station"
        stationUrl="https://station.example"
        identityVerified={false}
        onChangeStation={vi.fn(async () => undefined)}
        onLogout={vi.fn()}
        loggingOut={false}
      />,
    );

    expect(markup).toContain('data-station-trust="unverified"');
    expect(markup).toContain('mobile.launch.unverified');
    expect(markup).not.toContain('mobile.launch.verified');
  });
});
