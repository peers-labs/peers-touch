import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Empty,
  Icon,
  IconButton,
  Spin,
  Text,
  TextArea,
  TextField,
} from '@peers-touch/ui';

import { confirmDestructive } from '../../app/feedback/mobileFeedback';
import { useMobileI18n } from '../../app/mobileI18n';
import type { MobileDetailRoute } from '../../app/navigation';
import { MobileNotice } from '../../components/MobileNotice';
import { SocialActorAvatar } from '../../features/social/SocialActorAvatar';
import { actorDisplayName } from '../../features/social/socialProjection';
import { useSocialCirclesStore } from '../../features/social/socialCircles';
import { useSocialStore } from '../../features/social/socialStore';
import { requestSocialPeerProfile } from '../../features/social/socialRuntime';
import type { CircleMember } from '../../gen/proto/domain/social/circle_pb';

const EMPTY_CIRCLE_MEMBERS: readonly CircleMember[] = [];

interface SocialCircleDetailPageProps {
  readonly circleId: string;
  readonly onBack: () => void;
  readonly onOpenMembers: (route: Extract<
    MobileDetailRoute,
    { readonly routeId: 'detail:social-circle-members' }
  >) => void;
}

export function SocialCircleDetailPage({
  circleId,
  onBack,
  onOpenMembers,
}: SocialCircleDetailPageProps) {
  const { t } = useMobileI18n();
  const circles = useSocialCirclesStore((state) => state.circles);
  const members = useSocialCirclesStore(
    (state) => state.membersByCircle[circleId] ?? EMPTY_CIRCLE_MEMBERS,
  );
  const loadingMembers = useSocialCirclesStore(
    (state) => Boolean(state.loadingMembers[circleId]),
  );
  const pending = useSocialCirclesStore(
    (state) => Boolean(state.pendingCircleIds[circleId]),
  );
  const error = useSocialCirclesStore((state) => state.error);
  const refreshCircles = useSocialCirclesStore((state) => state.refreshCircles);
  const refreshMembers = useSocialCirclesStore((state) => state.refreshMembers);
  const updateCircle = useSocialCirclesStore((state) => state.updateCircle);
  const deleteCircle = useSocialCirclesStore((state) => state.deleteCircle);
  const removeMembers = useSocialCirclesStore((state) => state.removeMembers);
  const peerProfiles = useSocialStore((state) => state.peerProfiles);
  const circle = useMemo(
    () => circles.find((item) => item.id.toString() === circleId),
    [circleId, circles],
  );
  const [name, setName] = useState(circle?.name ?? '');
  const [description, setDescription] = useState(circle?.description ?? '');
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    if (!circle) void refreshCircles();
    void refreshMembers(circleId);
    // Route activation owns one authoritative read; later mutations update this projection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circleId, refreshCircles, refreshMembers]);

  useEffect(() => {
    if (!circle) return;
    setName(circle.name);
    setDescription(circle.description);
  }, [circle]);

  useEffect(() => {
    members.forEach((member) => {
      void requestSocialPeerProfile(member.actorPtid).catch(() => undefined);
    });
  }, [members]);

  const save = async () => {
    setActionError('');
    try {
      await updateCircle(circleId, name, description);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'mobile.social.circles.failed');
    }
  };

  const requestDelete = async () => {
    const confirmed = await confirmDestructive({
      title: t('mobile.social.circles.deleteTitle'),
      description: t('mobile.social.circles.deleteBody'),
      confirmLabel: t('common.action.delete'),
      cancelLabel: t('common.action.cancel'),
      onConfirm: async () => {
        await deleteCircle(circleId);
        onBack();
      },
    });
    if (!confirmed) return;
  };

  return (
    <div
      className="page-container mobile-detail-page social-detail-page"
      data-acceptance-id="social-circle-detail"
      data-circle-id={circleId}
    >
      <header className="page-header">
        <button
          type="button"
          className="header-action"
          aria-label={t('common.action.back')}
          onClick={onBack}
        >
          <Icon iconId="arrow-left" size={20} />
        </button>
        <h1 className="header-title compact">
          {circle?.name || t('mobile.social.circles.detail')}
        </h1>
      </header>

      <div className="mobile-detail-body circle-page-body">
        <section className="circle-editor-section">
          <label>
            <Text tone="secondary">{t('mobile.social.circles.nameLabel')}</Text>
            <TextField
              value={name}
              data-acceptance-id="social-circle-name"
              maxLength={120}
              disabled={pending}
              onValueChange={setName}
            />
          </label>
          <label>
            <Text tone="secondary">{t('mobile.social.circles.descriptionLabel')}</Text>
            <TextArea
              value={description}
              data-acceptance-id="social-circle-description"
              maxLength={500}
              disabled={pending}
              minimumRows={3}
              maximumRows={6}
              onValueChange={setDescription}
            />
          </label>
          <Button
            actionId="social-circle-save"
            emphasis="primary"
            fullWidth
            data-acceptance-id="social-circle-save"
            availability={pending || !name.trim()
              ? { kind: 'disabled', reason: t('mobile.social.circles.nameLabel') }
              : undefined}
            execution={pending ? 'pending' : 'idle'}
            onActivate={() => void save()}
          >
            {t('common.action.save')}
          </Button>
        </section>

        {error || actionError ? (
          <MobileNotice tone="error">{t(actionError || error || '')}</MobileNotice>
        ) : null}

        <section className="circle-members-section">
          <div className="circle-section-heading">
            <span>
              <Text strong>{t('mobile.social.circles.members')}</Text>
              <Text tone="secondary">
                {t('mobile.social.circles.memberCount', { count: members.length })}
              </Text>
            </span>
            <Button
              actionId="social-circle-add-members"
              emphasis="secondary"
              density="compact"
              leading={<Icon iconId="user-plus" size={15} />}
              data-acceptance-id="social-circle-add-members"
              availability={pending
                ? { kind: 'disabled', reason: t('common.action.add') }
                : undefined}
              onActivate={() => onOpenMembers({
                routeId: 'detail:social-circle-members',
                circleId,
              })}
            >
              {t('common.action.add')}
            </Button>
          </div>
          <Spin active={loadingMembers}>
            <div className="circle-member-list">
              {members.map((member) => {
                const profile = peerProfiles[member.actorPtid];
                return (
                  <div
                    className="circle-member-row"
                    key={member.actorPtid}
                    data-acceptance-id="social-circle-member"
                    data-actor-ptid={member.actorPtid}
                  >
                    <SocialActorAvatar
                      actorPtid={member.actorPtid}
                      avatar={profile?.avatar}
                      displayName={profile?.displayName}
                      username={profile?.username}
                      size={40}
                    />
                    <span className="circle-row-copy">
                      <Text strong truncate>
                        {actorDisplayName(profile?.displayName || profile?.username, member.actorPtid)
                          || t('mobile.contacts.unknownUser')}
                      </Text>
                      <Text tone="secondary" truncate>{member.actorPtid}</Text>
                    </span>
                    <IconButton
                      actionId="social-circle-remove-member"
                      iconId="close"
                      iconSize={16}
                      label={t('mobile.social.circles.removeMember')}
                      emphasis="quiet"
                      tone="danger"
                      availability={pending
                        ? { kind: 'disabled', reason: t('mobile.social.circles.removeMember') }
                        : undefined}
                      onActivate={() => {
                        void removeMembers(circleId, [member.actorPtid])
                          .catch(() => undefined);
                      }}
                    />
                  </div>
                );
              })}
            </div>
            {!loadingMembers && members.length === 0 ? (
              <Empty description={t('mobile.social.circles.noMembers')} />
            ) : null}
          </Spin>
        </section>

        <section className="circle-danger-section">
          <Text strong tone="danger">{t('mobile.social.circles.danger')}</Text>
          <Button
            actionId="social-circle-delete"
            tone="danger"
            fullWidth
            leading={<Icon iconId="delete" size={16} />}
            data-acceptance-id="social-circle-delete"
            execution={pending ? 'pending' : 'idle'}
            onActivate={() => void requestDelete()}
          >
            {t('mobile.social.circles.delete')}
          </Button>
        </section>
      </div>
    </div>
  );
}
