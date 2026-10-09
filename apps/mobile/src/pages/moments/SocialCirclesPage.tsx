import { useEffect, useState } from 'react';
import { Button, Empty, Input, Modal, Spin, Typography } from 'antd';
import { ArrowLeft, ChevronRight, Plus, Users } from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import type { MobileDetailRoute } from '../../app/navigation';
import { MobileNotice } from '../../components/MobileNotice';
import { useSocialCirclesStore } from '../../features/social/socialCircles';

const { Text } = Typography;

interface SocialCirclesPageProps {
  readonly onBack: () => void;
  readonly onOpenCircle: (route: Extract<
    MobileDetailRoute,
    { readonly routeId: 'detail:social-circle' }
  >) => void;
}

export function SocialCirclesPage({
  onBack,
  onOpenCircle,
}: SocialCirclesPageProps) {
  const { t } = useMobileI18n();
  const circles = useSocialCirclesStore((state) => state.circles);
  const loading = useSocialCirclesStore((state) => state.loading);
  const error = useSocialCirclesStore((state) => state.error);
  const hasMore = useSocialCirclesStore((state) => state.hasMore);
  const refreshCircles = useSocialCirclesStore((state) => state.refreshCircles);
  const loadMoreCircles = useSocialCirclesStore((state) => state.loadMoreCircles);
  const createCircle = useSocialCirclesStore((state) => state.createCircle);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [createError, setCreateError] = useState('');

  useEffect(() => {
    void refreshCircles();
  }, [refreshCircles]);

  const submitCreate = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    setCreateError('');
    try {
      const circleId = await createCircle(name, description);
      setName('');
      setDescription('');
      setCreateOpen(false);
      onOpenCircle({ routeId: 'detail:social-circle', circleId });
    } catch (caught) {
      setCreateError(caught instanceof Error ? caught.message : 'mobile.social.circles.failed');
    } finally {
      setCreating(false);
    }
  };

  const openCreate = () => {
    setCreateError('');
    setCreateOpen(true);
  };

  return (
    <div
      className="page-container mobile-detail-page social-detail-page"
      data-acceptance-id="social-circles-page"
    >
      <header className="page-header">
        <button
          type="button"
          className="header-action"
          aria-label={t('common.action.back')}
          onClick={onBack}
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="header-title compact">{t('mobile.social.circles.title')}</h1>
        <button
          type="button"
          className="header-action"
          data-acceptance-id="social-circle-create-open"
          aria-label={t('mobile.social.circles.create')}
          onClick={openCreate}
        >
          <Plus size={20} />
        </button>
      </header>

      <div className="mobile-detail-body circle-page-body">
        <Text type="secondary">{t('mobile.social.circles.privateHint')}</Text>
        {error ? <MobileNotice tone="error">{t(error)}</MobileNotice> : null}
        <Spin spinning={loading && circles.length === 0}>
          <div className="circle-list">
            {circles.map((circle) => (
              <button
                type="button"
                className="circle-row"
                key={circle.id.toString()}
                data-acceptance-id="social-circle-row"
                data-circle-id={circle.id.toString()}
                onClick={() => onOpenCircle({
                  routeId: 'detail:social-circle',
                  circleId: circle.id.toString(),
                })}
              >
                <span className="circle-row-icon"><Users size={18} /></span>
                <span className="circle-row-copy">
                  <Text strong ellipsis>{circle.name}</Text>
                  <Text type="secondary" ellipsis>
                    {circle.description || t('mobile.social.circles.noDescription')}
                  </Text>
                  <Text type="secondary">
                    {t('mobile.social.circles.memberCount', {
                      count: circle.memberCount.toString(),
                    })}
                  </Text>
                </span>
                <ChevronRight size={18} />
              </button>
            ))}
          </div>
          {!loading && circles.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('mobile.social.circles.empty')}
            />
          ) : null}
        </Spin>
        {hasMore ? (
          <Button block loading={loading} onClick={() => void loadMoreCircles()}>
            {t('common.action.loadMore')}
          </Button>
        ) : null}
      </div>
      <Modal
        open={createOpen}
        rootClassName="social-circle-editor-modal"
        title={t('mobile.social.circles.create')}
        okText={t('common.action.create')}
        cancelText={t('common.action.cancel')}
        okButtonProps={{
          loading: creating,
          disabled: !name.trim(),
          'data-acceptance-id': 'social-circle-create-submit',
        }}
        onOk={() => void submitCreate()}
        onCancel={() => {
          if (!creating) setCreateOpen(false);
        }}
      >
        <div className="circle-form">
          <Input
            autoFocus
            value={name}
            data-acceptance-id="social-circle-create-name"
            maxLength={120}
            placeholder={t('mobile.social.circles.name')}
            onChange={(event) => setName(event.target.value)}
          />
          <Input.TextArea
            value={description}
            data-acceptance-id="social-circle-create-description"
            maxLength={500}
            autoSize={{ minRows: 3, maxRows: 6 }}
            placeholder={t('mobile.social.circles.description')}
            onChange={(event) => setDescription(event.target.value)}
          />
          {createError ? <MobileNotice tone="error">{t(createError)}</MobileNotice> : null}
        </div>
      </Modal>
    </div>
  );
}
