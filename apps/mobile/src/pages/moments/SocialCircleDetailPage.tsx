import { useEffect, useMemo, useState } from 'react';
import { Button, Empty, Input, Modal, Spin, Typography } from 'antd';
import { ArrowLeft, Trash2, UserPlus, X } from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import type { MobileDetailRoute } from '../../app/navigation';
import { MobileNotice } from '../../components/MobileNotice';
import { useSocialCirclesStore } from '../../features/social/socialCircles';
import { useSocialStore } from '../../features/social/socialStore';
import { requestSocialPeerProfile } from '../../features/social/socialRuntime';

const { Text } = Typography;

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
  const members = useSocialCirclesStore((state) => state.membersByCircle[circleId] ?? []);
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

  const confirmDelete = () => {
    Modal.confirm({
      title: t('mobile.social.circles.deleteTitle'),
      content: t('mobile.social.circles.deleteBody'),
      okText: t('common.action.delete'),
      cancelText: t('common.action.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteCircle(circleId);
        onBack();
      },
    });
  };

  return (
    <div className="page-container mobile-detail-page">
      <header className="page-header">
        <button
          type="button"
          className="header-action"
          aria-label={t('common.action.back')}
          onClick={onBack}
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="header-title compact">
          {circle?.name || t('mobile.social.circles.detail')}
        </h1>
      </header>

      <div className="mobile-detail-body circle-page-body">
        <section className="circle-editor-section">
          <label>
            <Text type="secondary">{t('mobile.social.circles.nameLabel')}</Text>
            <Input
              value={name}
              maxLength={120}
              disabled={pending}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            <Text type="secondary">{t('mobile.social.circles.descriptionLabel')}</Text>
            <Input.TextArea
              value={description}
              maxLength={500}
              disabled={pending}
              autoSize={{ minRows: 3, maxRows: 6 }}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <Button
            type="primary"
            block
            loading={pending}
            disabled={!name.trim()}
            onClick={() => void save()}
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
              <Text type="secondary">
                {t('mobile.social.circles.memberCount', { count: members.length })}
              </Text>
            </span>
            <Button
              size="small"
              icon={<UserPlus size={15} />}
              disabled={pending}
              onClick={() => onOpenMembers({
                routeId: 'detail:social-circle-members',
                circleId,
              })}
            >
              {t('common.action.add')}
            </Button>
          </div>
          <Spin spinning={loadingMembers}>
            <div className="circle-member-list">
              {members.map((member) => {
                const profile = peerProfiles[member.actorPtid];
                return (
                  <div className="circle-member-row" key={member.actorPtid}>
                    <span className="circle-row-copy">
                      <Text strong ellipsis>
                        {profile?.displayName || member.actorPtid}
                      </Text>
                      <Text type="secondary" ellipsis>{member.actorPtid}</Text>
                    </span>
                    <Button
                      type="text"
                      danger
                      icon={<X size={16} />}
                      aria-label={t('mobile.social.circles.removeMember')}
                      disabled={pending}
                      onClick={() => {
                        void removeMembers(circleId, [member.actorPtid])
                          .catch(() => undefined);
                      }}
                    />
                  </div>
                );
              })}
            </div>
            {!loadingMembers && members.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t('mobile.social.circles.noMembers')}
              />
            ) : null}
          </Spin>
        </section>

        <section className="circle-danger-section">
          <Text strong type="danger">{t('mobile.social.circles.danger')}</Text>
          <Button
            block
            danger
            icon={<Trash2 size={16} />}
            loading={pending}
            onClick={confirmDelete}
          >
            {t('mobile.social.circles.delete')}
          </Button>
        </section>
      </div>
    </div>
  );
}
