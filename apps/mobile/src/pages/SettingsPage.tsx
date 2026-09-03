/**
 * SettingsPage.tsx — Pure renderer for the Settings / "Me" tab.
 *
 * Visual hierarchy aligned with the prototype ProfilePage:
 * - Header: "Me" title + Settings gear button
 * - Profile header card: Avatar 64px + name + PTID + chevron,
 *   stats row (Friends / Groups / Moments)
 * - Setting groups: Account, Chat, Network, About
 *   Each row: colored icon in tinted bg + label + optional value + chevron
 * - Sign Out button at bottom
 *
 * This page is a pure renderer. All data comes from:
 *   - useSettingsController (dirty/save/discard/conflict lifecycle)
 *   - profile projection (W5, via controller)
 *   - social store (blocked users)
 *   - station registry (station card)
 *
 * The page never fetches or persists data directly.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Avatar, Card, Modal, Spin, Typography } from 'antd';
import type { LucideIcon } from 'lucide-react';
import {
  Ban,
  Bell,
  ChevronRight,
  Fingerprint,
  Globe,
  Image as ImageIcon,
  MessageCircle,
  Server,
  Settings as SettingsIcon,
  Shield,
  ShieldCheck,
  User,
} from 'lucide-react';

import { useMobileI18n } from '../app/mobileI18n';
import type { MobileAuthSession } from '../features/auth/authSession';
import { useSocialStore } from '../features/social/socialStore';
import {
  activeStationEntry,
  type StoredStationRegistry,
} from '../features/station/stationRegistry';
import { createProfileGateway } from '../services/gateways/profileGateway';
import { createProfileProjection } from '../runtimes/profileProjectionDescriptor';
import { useSettingsController } from './settings/useSettingsController';
import { DirtyBar } from './settings/SettingsSections';

const { Text } = Typography;

// ---------------------------------------------------------------------------
// Setting group types (prototype-aligned)
// ---------------------------------------------------------------------------

interface SettingEntry {
  labelKey: string;
  icon: LucideIcon;
  tint: string;
  valueKey?: string | undefined;
  valueOverride?: string | undefined;
}

interface SettingGroup {
  titleKey: string;
  items: SettingEntry[];
}

// ---------------------------------------------------------------------------
// Page props — the shell passes only what the page cannot own
// ---------------------------------------------------------------------------

interface SettingsPageProps {
  readonly stationRegistry: StoredStationRegistry;
  readonly authSession: MobileAuthSession | null;
  readonly onChangeStation: () => void;
  readonly onLogout: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// SettingsPage — pure renderer (prototype ProfilePage layout)
// ---------------------------------------------------------------------------

export function SettingsPage({
  stationRegistry,
  authSession,
  onChangeStation,
  onLogout,
}: SettingsPageProps) {
  const { t, language } = useMobileI18n();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  const activeStation = activeStationEntry(stationRegistry);
  const displayName = authSession?.actorRef.acct;

  // Blocked users from the social store
  const blockedUsers = useSocialStore((state) => state.blockedUsers);
  const refreshBlockedUsers = useSocialStore((state) => state.refreshBlockedUsers);

  // Derive stats counts from available store data (best-effort; shows 0 when unavailable)
  const friendCount = useSocialStore((state) => {
    // Count non-blocked friendships as an approximation
    const statuses = state.friendshipStatus ?? {};
    return Object.values(statuses).filter((f) => !f.blocked).length;
  });
  const groupCount = 0; // Group count not available in social store projection
  const momentsCount = 0; // Moments count not available in social store projection

  useEffect(() => {
    if (authSession) void refreshBlockedUsers().catch(() => undefined);
  }, [authSession, refreshBlockedUsers]);

  // Gateway + projection: created only when session exists
  const profileGateway = useMemo(
    () => (authSession ? createProfileGateway(authSession) : null),
    [authSession],
  );

  const profileProjection = useMemo(() => {
    if (!authSession) return null;
    const stubIngress = {
      ingestDataEvent: () => true,
      ingestControlEvent: () => true,
      state: () => ({
        cursors: {} as Record<string, unknown>,
        staleness: {} as Record<string, unknown>,
        writeAdmission: { open: true } as const,
        dataQueueDepth: 0,
        controlQueueDepth: 0,
        consecutiveControlLosses: 0,
      }),
      repairCursor: () => {},
      reopenAdmission: () => {},
      teardown: () => {},
    } as unknown as Parameters<typeof createProfileProjection>[0];
    return createProfileProjection(stubIngress);
  }, [authSession]);

  // Settings controller — owns dirty/save/discard/conflict lifecycle
  const controller = useSettingsController(authSession, profileGateway, profileProjection);

  // --- Setting groups (prototype-aligned) ---
  const settingGroups: SettingGroup[] = useMemo(() => [
    {
      titleKey: 'mobile.settings.group.account',
      items: [
        { labelKey: 'mobile.settings.accountInfo', icon: User, tint: '#6366f1' },
        { labelKey: 'mobile.settings.section.notifications', valueKey: 'mobile.settings.notifications.enabled', icon: Bell, tint: '#f59e0b' },
        { labelKey: 'mobile.settings.privacySecurity', icon: Shield, tint: '#22c55e' },
        { labelKey: 'mobile.settings.safetyNumber', icon: Fingerprint, tint: '#0ea5e9' },
        { labelKey: 'mobile.settings.blockedUsers', valueOverride: String(blockedUsers.length), icon: Ban, tint: '#ef4444' },
      ],
    },
    {
      titleKey: 'mobile.settings.group.chat',
      items: [
        { labelKey: 'mobile.settings.chatSettings', icon: MessageCircle, tint: '#6366f1' },
        { labelKey: 'mobile.settings.chatBackground', icon: ImageIcon, tint: '#ec4899' },
      ],
    },
    {
      titleKey: 'mobile.settings.group.network',
      items: [
        { labelKey: 'mobile.settings.stationConnection', valueOverride: activeStation?.label || t('mobile.settings.stationNotSelected'), icon: Server, tint: '#22c55e' },
        { labelKey: 'mobile.settings.encryption', valueKey: 'mobile.settings.encryptionActive', icon: ShieldCheck, tint: '#6366f1' },
        { labelKey: 'mobile.settings.section.language', valueOverride: language === 'zh-CN' ? '简体中文' : 'English', icon: Globe, tint: '#0ea5e9' },
      ],
    },
    {
      titleKey: 'mobile.settings.group.about',
      items: [
        { labelKey: 'mobile.settings.aboutApp', valueKey: 'mobile.settings.appVersion', icon: ShieldCheck, tint: '#f59e0b' },
      ],
    },
  ], [blockedUsers.length, activeStation, language, t]);

  // --- PTID display ---
  const ptidDisplay = authSession?.actorRef.ptid
    ? `ptid:${String(authSession.actorRef.ptid).slice(0, 24)}...`
    : '';

  // --- Logout flow ---
  const handleLogoutConfirm = useCallback(async () => {
    setLogoutConfirmOpen(false);
    setLoggingOut(true);
    try {
      await onLogout();
    } finally {
      setLoggingOut(false);
    }
  }, [onLogout]);

  // --- Render ---
  if (controller.loading) {
    return (
      <div className="page-container settings-loading">
        <Spin />
      </div>
    );
  }

  return (
    <div className="page-container settings-page">
      {/* Header: "Me" + Settings gear */}
      <header className="page-header">
        <h1 className="header-title">{t('mobile.settings.title')}</h1>
        <button
          type="button"
          className="header-action"
          aria-label={t('mobile.settings.section.station')}
          onClick={onChangeStation}
        >
          <SettingsIcon size={20} />
        </button>
      </header>

      <div className="settings-body">
        {/* Profile header card — Avatar 64px + name + PTID + chevron + stats */}
        <Card className="settings-profile-header-card" variant="borderless">
          <div className="settings-profile-header">
            <Avatar
              size={64}
              style={{
                background: 'linear-gradient(135deg, #667eea, #764ba2)',
                borderRadius: 16,
              }}
            >
              {displayName ? displayName.slice(0, 2).toUpperCase() : '?'}
            </Avatar>
            <div className="settings-profile-info">
              <Text strong className="settings-profile-name">
                {displayName || t('mobile.settings.notLoggedIn')}
              </Text>
              {ptidDisplay && (
                <Text type="secondary" className="settings-profile-ptid">
                  {ptidDisplay}
                </Text>
              )}
            </div>
            <ChevronRight size={20} color="#9ca0ab" />
          </div>
          <div className="settings-profile-stats">
            <div className="settings-stat">
              <Text strong className="settings-stat-value">{friendCount}</Text>
              <Text type="secondary" className="settings-stat-label">
                {t('mobile.settings.stats.friends')}
              </Text>
            </div>
            <div className="settings-stat-divider" />
            <div className="settings-stat">
              <Text strong className="settings-stat-value">{groupCount}</Text>
              <Text type="secondary" className="settings-stat-label">
                {t('mobile.settings.stats.groups')}
              </Text>
            </div>
            <div className="settings-stat-divider" />
            <div className="settings-stat">
              <Text strong className="settings-stat-value">{momentsCount}</Text>
              <Text type="secondary" className="settings-stat-label">
                {t('mobile.settings.stats.moments')}
              </Text>
            </div>
          </div>
        </Card>

        {/* Dirty bar — save/discard/conflict */}
        <DirtyBar
          dirty={controller.dirty}
          conflict={controller.conflict}
          saveStatus={controller.saveStatus}
          saveError={controller.saveError}
          onSave={() => void controller.save()}
          onDiscard={controller.discard}
          onReload={() => void controller.reload()}
        />

        {/* Setting groups (prototype-aligned) */}
        {settingGroups.map((group) => (
          <div key={group.titleKey} className="settings-group-block">
            <div className="settings-group-block-title">{t(group.titleKey)}</div>
            <Card className="settings-group-card" variant="borderless">
              {group.items.map((item, idx) => {
                const Icon = item.icon;
                const displayValue = item.valueOverride ?? (item.valueKey ? t(item.valueKey) : undefined);
                return (
                  <div
                    key={item.labelKey}
                    className={`setting-row ${idx > 0 ? 'setting-row--border' : ''}`}
                  >
                    <span
                      className="setting-row-icon"
                      style={{
                        backgroundColor: `${item.tint}14`,
                        color: item.tint,
                      }}
                    >
                      <Icon size={17} />
                    </span>
                    <Text className="setting-row-label">{t(item.labelKey)}</Text>
                    {displayValue && (
                      <Text type="secondary" className="setting-row-value">
                        {displayValue}
                      </Text>
                    )}
                    <ChevronRight size={17} color="#c1c4cc" />
                  </div>
                );
              })}
            </Card>
          </div>
        ))}

        {/* Sign Out button */}
        <button
          type="button"
          className="settings-sign-out"
          onClick={() => setLogoutConfirmOpen(true)}
          disabled={loggingOut}
        >
          {loggingOut ? t('mobile.settings.station.loggingOut') : t('mobile.settings.signOut')}
        </button>
      </div>

      {/* Logout confirmation modal */}
      <Modal
        title={t('mobile.settings.station.logoutConfirmTitle')}
        open={logoutConfirmOpen}
        okText={t('mobile.settings.logout')}
        okButtonProps={{ danger: true }}
        cancelText={t('common.action.cancel')}
        onOk={() => void handleLogoutConfirm()}
        onCancel={() => setLogoutConfirmOpen(false)}
        destroyOnClose
      >
        {t('mobile.settings.station.logoutConfirmBody')}
      </Modal>
    </div>
  );
}
