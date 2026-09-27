import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(
  new URL('../SettingsPage.tsx', import.meta.url),
  'utf8',
);
const sectionsSource = readFileSync(
  new URL('./SettingsSections.tsx', import.meta.url),
  'utf8',
);
const controllerSource = readFileSync(
  new URL('./useSettingsController.ts', import.meta.url),
  'utf8',
);
const devicePreferencesSource = readFileSync(
  new URL('./devicePreferences.ts', import.meta.url),
  'utf8',
);
const i18nSource = readFileSync(
  new URL('../../app/mobileI18n.tsx', import.meta.url),
  'utf8',
);

describe('Settings functional surface contract', () => {
  it('uses canonical Group and Moments counts without treating friendship cache as a total', () => {
    expect(pageSource).toContain(
      'useGroupStore((state) => state.groups.length)',
    );
    expect(pageSource).toContain(
      'const momentsCount = visibleProfile?.statusesCount ?? unavailableLabel',
    );
    expect(pageSource).toContain(
      'const visibleProfile = controller.profileAvailable ? currentUserProfile : null',
    );
    expect(pageSource).toContain('const friendCount = unavailableLabel');
    expect(pageSource).not.toContain('state.friendshipStatus');
    expect(pageSource).not.toContain('const groupCount = 0');
    expect(pageSource).not.toContain('const momentsCount = 0');
  });

  it('fences stale Profile data and consumes the canonical Social blocked-user owner', () => {
    expect(pageSource).toContain('controller.profileAvailable ? (');
    expect(pageSource).toContain('<ProfileUnavailable');
    expect(pageSource).toContain('onRetry={controller.retryProfile}');
    expect(pageSource).toContain('function BlockedUsersDetail()');
    expect(pageSource).toContain('useBlockedUsersController()');
    expect(pageSource).toContain('state.blockedUsers.length');
    expect(pageSource).toContain('state.socialGateway !== null');
    expect(controllerSource).toContain('requestSocialBlockedUsers()');
    expect(controllerSource).toContain('unblockSocialUser(targetPtid)');
    expect(controllerSource).not.toContain('state.refreshBlockedUsers');
    expect(controllerSource).not.toContain('state.unblockUser');
    expect(sectionsSource).toContain('onUnblock');
    expect(sectionsSource).toContain('data-blocked-user={item.targetPtid}');
  });

  it('does not invent a separate account-preference owner or placeholder section', () => {
    expect(pageSource).not.toContain('AccountPreferencesUnavailableSection');
    expect(sectionsSource).not.toContain('AccountPreferencesUnavailableSection');
    expect(sectionsSource).not.toContain(
      "t('mobile.settings.section.accountPrefs')",
    );
    expect(controllerSource).not.toContain('getAccountPreferences');
    expect(controllerSource).not.toContain('updateAccountPreferences');
  });

  it('uses native build truth and marks ownerless encryption unavailable', () => {
    expect(pageSource).toContain('controller.appVersion ?? unavailableLabel');
    expect(controllerSource).toContain('loadAppVersion()');
    expect(pageSource).not.toContain('mobile.settings.encryptionActive');
    expect(pageSource).not.toContain('mobile.settings.appVersion');
  });

  it('projects verified Station identity and native notification permission truth', () => {
    expect(pageSource).toContain(
      "permission.kind === 'notifications'",
    );
    expect(pageSource).toContain(
      "onRequestPermission={() => controller.requestPermission('notifications')}",
    );
    expect(pageSource).toContain(
      'identityVerified={activeStation?.identityVerified === true}',
    );
    expect(sectionsSource).toContain(
      'data-notification-permission-required={permission.status}',
    );
    expect(sectionsSource).toContain(
      "data-station-trust={identityVerified ? 'verified' : 'unverified'}",
    );
  });

  it('keeps local cache clearing without inventing storage policy, server preferences, or a system-settings action', () => {
    expect(pageSource).toContain('<StorageSection');
    expect(pageSource).toContain('<PermissionsSection');
    expect(pageSource).toContain('loading={controller.devicePreferencesLoading}');
    expect(pageSource).toContain('unavailable={controller.devicePreferencesUnavailable}');
    expect(pageSource).toContain('onRetry={controller.retryDevicePreferences}');
    expect(pageSource).toContain('onRequest={controller.requestPermission}');
    expect(sectionsSource).toContain('onClearCache');
    expect(devicePreferencesSource).toContain('CLEARABLE_CACHE_DOMAINS');
    expect(sectionsSource).not.toContain('openSystemSettings');
  });

  it('wires editable Station profile fields without inventing media upload', () => {
    expect(pageSource).not.toContain("t('mobile.auth.comingSoon')");
    expect(pageSource).toContain('updateCurrentUserProfile');
    expect(pageSource).toContain('profile={controller.draftProfile}');
    expect(sectionsSource).toContain("onPatch({ displayName: event.target.value })");
    expect(sectionsSource).toContain("onPatch({ note: event.target.value })");
    expect(sectionsSource).toContain("onPatch({ avatar: event.target.value })");
    expect(sectionsSource).toContain("onPatch({ header: event.target.value })");
    expect(sectionsSource).toContain("onPatch({ region: event.target.value })");
    expect(sectionsSource).toContain("onPatch({ timezone: event.target.value })");
    expect(controllerSource).toContain(
      'defaultVisibility: profile.defaultVisibility',
    );
    expect(controllerSource).toContain(
      'manuallyApprovesFollowers: profile.manuallyApprovesFollowers',
    );
    expect(controllerSource).toContain(
      'messagePermission: profile.messagePermission',
    );
    expect(controllerSource).toContain(
      'autoExpireDays: profile.autoExpireDays',
    );
    expect(sectionsSource).not.toContain('Upload');
  });

  it('renders Station-owned privacy fields instead of an unavailable placeholder', () => {
    expect(pageSource).toContain('profile={controller.draftProfile}');
    expect(pageSource).toContain('onPatch={controller.patchProfile}');
    expect(pageSource).not.toContain(
      "{ id: 'privacy-security', labelKey: 'mobile.settings.privacySecurity', valueOverride: unavailableLabel",
    );
    expect(sectionsSource).toContain(
      'data-privacy-setting="defaultVisibility"',
    );
    expect(sectionsSource).toContain(
      'data-privacy-setting="manuallyApprovesFollowers"',
    );
    expect(sectionsSource).toContain(
      'data-privacy-setting="messagePermission"',
    );
    expect(sectionsSource).toContain(
      'data-privacy-setting="autoExpireDays"',
    );
  });

  it('routes every user-requested Settings exit through save, discard, or stay', () => {
    expect(pageSource).toContain('registerSettingsExitGuard(requestExit)');
    expect(pageSource).toContain(
      'const settingsDirty = selectedOwner?.dirty ?? false',
    );
    expect(pageSource).toContain('save: controller.saveProfile');
    expect(pageSource).toContain('save: controller.saveDevicePreferences');
    expect(pageSource).toContain("case 'notifications':");
    expect(pageSource).toContain(
      'const saved = selectedOwner ? await selectedOwner.save() : true',
    );
    expect(pageSource).not.toContain('saveAllSettings');
    expect(pageSource).not.toContain('aggregateSaveStatus');
    expect(pageSource).toContain('data-acceptance-id="settings-unsaved-exit"');
    expect(pageSource).toContain("t('mobile.settings.exit.save')");
    expect(pageSource).toContain("t('mobile.settings.exit.discard')");
    expect(pageSource).toContain("t('mobile.settings.exit.stay')");
    expect(pageSource).toContain('onClick={() => requestExit(onBack)}');
    expect(pageSource).toContain('onChangeStation={async () => requestExit(onChangeStation)}');
    expect(pageSource).toContain('onClick={requestLogout}');
  });

  it('commits language storage before changing the visible canonical selection', () => {
    const persistenceIndex = i18nSource.indexOf(
      'await persistMobileLanguage(nextLanguage)',
    );
    const projectionIndex = i18nSource.indexOf(
      'setLanguageState(nextLanguage)',
    );

    expect(persistenceIndex).toBeGreaterThan(-1);
    expect(projectionIndex).toBeGreaterThan(persistenceIndex);
    expect(i18nSource).toContain(
      "setLanguageError('mobile.settings.language.saveFailed')",
    );
  });
});
