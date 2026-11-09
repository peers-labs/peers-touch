import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  Empty,
  Icon,
  Spin,
  Text,
  TextArea,
  TextField,
} from '@peers-touch/ui';

import { useMobileI18n } from '../../app/mobileI18n';
import type { MobileDetailRoute } from '../../app/navigation';
import { MobileNotice } from '../../components/MobileNotice';
import { useSocialCirclesStore } from '../../features/social/socialCircles';

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
          <Icon iconId="arrow-left" size={20} />
        </button>
        <h1 className="header-title compact">{t('mobile.social.circles.title')}</h1>
        <button
          type="button"
          className="header-action"
          data-acceptance-id="social-circle-create-open"
          aria-label={t('mobile.social.circles.create')}
          onClick={openCreate}
        >
          <Icon iconId="plus" size={20} />
        </button>
      </header>

      <div className="mobile-detail-body circle-page-body">
        <Text tone="secondary">{t('mobile.social.circles.privateHint')}</Text>
        {error ? <MobileNotice tone="error">{t(error)}</MobileNotice> : null}
        <Spin active={loading && circles.length === 0}>
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
                <span className="circle-row-icon"><Icon iconId="users" size={18} /></span>
                <span className="circle-row-copy">
                  <Text strong truncate>{circle.name}</Text>
                  <Text tone="secondary" truncate>
                    {circle.description || t('mobile.social.circles.noDescription')}
                  </Text>
                  <Text tone="secondary">
                    {t('mobile.social.circles.memberCount', {
                      count: circle.memberCount.toString(),
                    })}
                  </Text>
                </span>
                <Icon iconId="chevron-right" size={18} />
              </button>
            ))}
          </div>
          {!loading && circles.length === 0 ? (
            <Empty description={t('mobile.social.circles.empty')} />
          ) : null}
        </Spin>
        {hasMore ? (
          <Button
            actionId="social-circles-load-more"
            fullWidth
            execution={loading ? 'pending' : 'idle'}
            onActivate={() => void loadMoreCircles()}
          >
            {t('common.action.loadMore')}
          </Button>
        ) : null}
      </div>
      <Dialog
        open={createOpen}
        className="social-circle-editor"
        title={t('mobile.social.circles.create')}
        closeLabel={t('common.action.cancel')}
        onDismiss={() => {
          if (!creating) setCreateOpen(false);
        }}
        footer={
          <div className="circle-form-footer">
            <Button
              actionId="social-circle-create-cancel"
              emphasis="quiet"
              availability={creating
                ? { kind: 'disabled', reason: t('common.action.cancel') }
                : undefined}
              onActivate={() => setCreateOpen(false)}
            >
              {t('common.action.cancel')}
            </Button>
            <Button
              actionId="social-circle-create-submit"
              emphasis="primary"
              data-acceptance-id="social-circle-create-submit"
              availability={!name.trim() || creating
                ? { kind: 'disabled', reason: t('mobile.social.circles.name') }
                : undefined}
              execution={creating ? 'pending' : 'idle'}
              onActivate={() => void submitCreate()}
            >
              {t('common.action.create')}
            </Button>
          </div>
        }
      >
        <div className="circle-form">
          <TextField
            autoFocus
            value={name}
            data-acceptance-id="social-circle-create-name"
            maxLength={120}
            placeholder={t('mobile.social.circles.name')}
            onValueChange={setName}
          />
          <TextArea
            value={description}
            data-acceptance-id="social-circle-create-description"
            maxLength={500}
            minimumRows={3}
            maximumRows={6}
            placeholder={t('mobile.social.circles.description')}
            onValueChange={setDescription}
          />
          {createError ? <MobileNotice tone="error">{t(createError)}</MobileNotice> : null}
        </div>
      </Dialog>
    </div>
  );
}
