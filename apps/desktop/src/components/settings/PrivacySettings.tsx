import { Button } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Alert, Avatar, Modal, Radio, Spin, Typography, message, theme } from 'antd';
import { RotateCcw, Shield, Trash2, UserRoundCheck, UsersRound } from 'lucide-react';
import { useSessionStore } from '../../store/session';
import { useSettingsStore } from '../../store/settings';

import {
  useActiveRelationshipsSlice,
  useActiveSocialChatSlice,
} from './useActiveSettingsStores';
import {
  SettingsContainer,
  SettingsSection,
} from './SettingsLayout';

const { Text } = Typography;

export function PrivacySettings() {
  const { t } = useTranslation('settings');
  const { token } = theme.useToken();
  const {
    blockedActors,
    loading,
    error,
    mutatingPtid,
    unblockActor,
  } = useActiveRelationshipsSlice((state) => ({
    blockedActors: state.blockedActors,
    loading: state.blockedActorsLoading,
    error: state.blockedActorsError,
    mutatingPtid: state.blockedActorMutatingPtid,
    unblockActor: state.unblockActor,
  }));
  const peerProfiles = useActiveSocialChatSlice((state) => state.peerProfiles);
  const {
    groupAdmissionPreference,
    rejectedGroups,
    groupAdmissionLoading,
    groupAdmissionError,
    groupAdmissionMutating,
    updateGroupAdmissionMode,
    removeRejectedGroup,
    retryRejectedGroupLeave,
  } = useSettingsStore((state) => ({
    groupAdmissionPreference: state.groupAdmissionPreference,
    rejectedGroups: state.rejectedGroups,
    groupAdmissionLoading: state.groupAdmissionLoading,
    groupAdmissionError: state.groupAdmissionError,
    groupAdmissionMutating: state.groupAdmissionMutating,
    updateGroupAdmissionMode: state.updateGroupAdmissionMode,
    removeRejectedGroup: state.removeRejectedGroup,
    retryRejectedGroupLeave: state.retryRejectedGroupLeave,
  }));

  const confirmUnblock = (actorPtid: string, displayName: string) => {
    const sessionEpoch = useSessionStore.getState().sessionEpoch;
    Modal.confirm({
      title: t('settings.privacy.unblockConfirmTitle', { name: displayName }),
      content: t('settings.privacy.unblockConfirmBody'),
      okText: t('settings.privacy.unblockAction'),
      cancelText: t('settings.network.cancel'),
      onOk: async () => {
        try {
          await unblockActor(actorPtid, sessionEpoch);
          message.success(t('settings.privacy.unblockSuccess'));
        } catch (unblockError) {
          message.error(
            unblockError instanceof Error
              ? t(unblockError.message, { defaultValue: unblockError.message })
              : t('settings.privacy.unblockFailed'),
          );
          throw unblockError;
        }
      },
    });
  };

  return (
    <SettingsContainer>
      <SettingsSection
        icon={<UsersRound size={18} />}
        title={t('settings.privacy.groupInvites.title')}
        subtitle={t('settings.privacy.groupInvites.subtitle')}
      >
        {groupAdmissionError ? (
          <Alert
            type="warning"
            showIcon
            message={t('settings.privacy.groupInvites.loadFailed')}
            description={groupAdmissionError}
          />
        ) : null}
        {groupAdmissionLoading && !groupAdmissionPreference ? (
          <Spin size="small" />
        ) : groupAdmissionPreference ? (
          <Radio.Group
            value={groupAdmissionPreference.mode}
            disabled={groupAdmissionMutating}
            onChange={(event) => {
              void updateGroupAdmissionMode(event.target.value).catch(() => {
                message.error(t('settings.privacy.groupInvites.updateFailed'));
              });
            }}
          >
            <Flexbox gap={8}>
              <Radio value={1}>
                {t('settings.privacy.groupInvites.directAdd')}
              </Radio>
              <Radio value={2}>
                {t('settings.privacy.groupInvites.requireConfirmation')}
              </Radio>
            </Flexbox>
          </Radio.Group>
        ) : null}

        <Flexbox gap={6} style={{ marginTop: 16 }}>
          <Text strong>{t('settings.privacy.groupInvites.rejectedTitle')}</Text>
          {rejectedGroups.length === 0 ? (
            <Text type="secondary">
              {t('settings.privacy.groupInvites.rejectedEmpty')}
            </Text>
          ) : rejectedGroups.map((group, index) => (
            <Flexbox
              key={group.conversationId}
              data-rejected-group={group.conversationId}
              data-leave-reject-operation={group.leaveRejectOperationId || undefined}
              data-leave-reject-state={group.leaveRejectState}
              horizontal
              align="center"
              justify="space-between"
              gap={12}
              style={{
                borderTop: index === 0
                  ? undefined
                  : `1px solid ${token.colorBorderSecondary}`,
                minHeight: 48,
                paddingBlock: 8,
              }}
            >
              <Flexbox gap={1} style={{ minWidth: 0 }}>
                <Text ellipsis>
                  {group.groupNameSnapshot
                    || t('settings.privacy.groupInvites.unknownGroup')}
                </Text>
                <Text type="secondary" ellipsis style={{ fontSize: 12 }}>
                  {group.conversationId}
                </Text>
                {group.leaveRejectState === 5 ? (
                  <Text type="warning" style={{ fontSize: 12 }}>
                    {t('settings.privacy.groupInvites.leaveRetryRequired')}
                  </Text>
                ) : null}
              </Flexbox>
              <Flexbox horizontal gap={8}>
                {group.leaveRejectState === 5 && group.leaveRejectOperationId ? (
                  <Button
                    data-leave-reject-retry={group.leaveRejectOperationId}
                    size="small"
                    type="primary"
                    icon={<RotateCcw size={14} />}
                    loading={groupAdmissionMutating}
                    onClick={() => {
                      void retryRejectedGroupLeave(
                        group.leaveRejectOperationId,
                      ).catch(() => {
                        message.error(
                          t('settings.privacy.groupInvites.leaveRetryFailed'),
                        );
                      });
                    }}
                  >
                    {t('settings.privacy.groupInvites.leaveRetry')}
                  </Button>
                ) : null}
                <Button
                  size="small"
                  icon={<Trash2 size={14} />}
                  disabled={groupAdmissionMutating}
                  onClick={() => {
                    void removeRejectedGroup(group.conversationId).catch(() => {
                      message.error(t('settings.privacy.groupInvites.removeFailed'));
                    });
                  }}
                >
                  {t('settings.privacy.groupInvites.remove')}
                </Button>
              </Flexbox>
            </Flexbox>
          ))}
        </Flexbox>
      </SettingsSection>

      <SettingsSection
        icon={<Shield size={18} />}
        title={t('settings.privacy.title')}
        subtitle={t('settings.privacy.subtitle')}
      >
        {error ? (
          <Alert
            type="warning"
            showIcon
            message={t('settings.privacy.loadFailed')}
            description={t(error, { defaultValue: error })}
          />
        ) : null}

        {loading && blockedActors.length === 0 ? (
          <Flexbox horizontal align="center" gap={8}>
            <Spin size="small" />
            <Text type="secondary">{t('settings.privacy.loading')}</Text>
          </Flexbox>
        ) : blockedActors.length === 0 ? (
          <Text type="secondary">{t('settings.privacy.empty')}</Text>
        ) : (
          <Flexbox gap={0}>
            {blockedActors.map((item, index) => {
              const actorPtid = item.actor?.ptid.trim() ?? '';
              const actorAcct = item.actor?.acct.trim() ?? '';
              const profile = peerProfiles[actorPtid];
              const displayName = profile?.display_name?.trim()
                || profile?.username?.trim()
                || actorAcct
                || t('settings.privacy.blockedAccount');
              const handle = profile?.federated_handle?.trim()
                || profile?.acct?.trim()
                || actorAcct;
              return (
                <Flexbox
                  key={actorPtid}
                  horizontal
                  align="center"
                  justify="space-between"
                  gap={16}
                  data-blocked-actor={actorPtid}
                  style={{
                    borderTop: index === 0
                      ? undefined
                      : `1px solid ${token.colorBorderSecondary}`,
                    minHeight: 56,
                    paddingBlock: 10,
                  }}
                >
                  <Flexbox horizontal align="center" gap={10} style={{ minWidth: 0 }}>
                    <Avatar
                      size={36}
                      src={profile?.avatar || undefined}
                    >
                      {displayName.slice(0, 1).toUpperCase()}
                    </Avatar>
                    <Flexbox gap={1} style={{ minWidth: 0 }}>
                      <Text strong ellipsis>{displayName}</Text>
                      {handle && handle !== displayName ? (
                        <Text type="secondary" ellipsis style={{ fontSize: 12 }}>
                          {handle}
                        </Text>
                      ) : null}
                    </Flexbox>
                  </Flexbox>
                  <Button
                    size="small"
                    icon={<UserRoundCheck size={14} />}
                    loading={mutatingPtid === actorPtid}
                    disabled={!actorPtid}
                    onClick={() => confirmUnblock(actorPtid, displayName)}
                    data-unblock-actor={actorPtid}
                  >
                    {t('settings.privacy.unblockAction')}
                  </Button>
                </Flexbox>
              );
            })}
          </Flexbox>
        )}
      </SettingsSection>
    </SettingsContainer>
  );
}
