import { useMemo, useState, type ReactNode } from 'react';
import { Button, Dialog, Empty, Icon, IconButton, Spin, Text, TextArea, TextField } from '@peers-touch/ui';

import { useMobileI18n } from '../../app/mobileI18n';
import type { MobileDetailRoute } from '../../app/navigation';
import { BoundedList } from '../../components/BoundedList';
import { MobileNotice } from '../../components/MobileNotice';
import { useSocialCirclesStore } from '../../features/social/socialCircles';
import { useSocialStore } from '../../features/social/socialStore';
import type { Circle } from '../../gen/proto/domain/social/circle_pb';

const circleKey = (circle: Circle) => circle.id.toString();

interface SocialCirclesContentProps {
  readonly query: string;
  readonly header: (openCreate: () => void) => ReactNode;
  readonly onOpenCircle: (route: Extract<MobileDetailRoute, { routeId: 'detail:social-circle' }>) => void;
}

/** Circles remain runtime-owned while their primary pane is unmounted. */
export function SocialCirclesContent({ query, header, onOpenCircle }: SocialCirclesContentProps) {
  const { t } = useMobileI18n();
  const circles = useSocialCirclesStore(state => state.circles);
  const members = useSocialCirclesStore(state => state.membersByCircle);
  const profiles = useSocialStore(state => state.peerProfiles);
  const loading = useSocialCirclesStore(state => state.loading);
  const error = useSocialCirclesStore(state => state.error);
  const hasMore = useSocialCirclesStore(state => state.hasMore);
  const refresh = useSocialCirclesStore(state => state.refreshCircles);
  const loadMore = useSocialCirclesStore(state => state.loadMoreCircles);
  const create = useSocialCirclesStore(state => state.createCircle);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [createError, setCreateError] = useState('');
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return circles;
    return circles.filter(circle => [
      circle.name, circle.description,
      ...(members[circleKey(circle)] ?? []).map(member => profiles[member.actorPtid]?.displayName ?? ''),
    ].join(' ').toLocaleLowerCase().includes(q));
  }, [circles, members, profiles, query]);

  const submit = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    setCreateError('');
    try {
      const circleId = await create(name, description);
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

  return <div className="page-container moments-page" data-acceptance-id="social-circles-page"
    data-product-surface="moments.circles" data-moments-pane="circles">
    {header(() => { setCreateError(''); setCreateOpen(true); })}
    <div className="circle-page-body">
      <Text tone="secondary">{t('mobile.social.circles.privateHint')}</Text>
      {error ? <MobileNotice tone="error">
        {t(error)}
        <Button actionId="circles.retry" density="comfortable" onActivate={() => void refresh()}>
          {t('common.action.retry')}
        </Button>
      </MobileNotice> : null}
      <Spin active={loading && !circles.length}>
        <BoundedList items={visible} itemKey={circleKey} surfaceKey={`moments:circles:${query}`} size={80}>
          {rows => <div className="circle-list">{rows.map(circle => (
            <Button key={circleKey(circle)} actionId={`circle.manage.${circleKey(circle)}`}
              fullWidth emphasis="quiet" density="comfortable"
              data-acceptance-id="social-circle-row" data-circle-id={circleKey(circle)}
              data-scroll-anchor-id={circleKey(circle)}
              onActivate={() => onOpenCircle({ routeId: 'detail:social-circle', circleId: circleKey(circle) })}>
              <span className="circle-row-copy">
                <Text strong truncate>{circle.name}</Text>
                {circle.description ? <Text tone="secondary" truncate>{circle.description}</Text> : null}
                <Text tone="secondary">{t('mobile.social.circles.memberCount', {
                  count: circle.memberCount.toString(),
                })}</Text>
              </span>
              <Icon iconId="chevron-right" size={18} />
            </Button>
          ))}</div>}
        </BoundedList>
        {!loading && !visible.length ? <Empty description={t(query.trim()
          ? 'mobile.social.circles.searchEmpty' : 'mobile.social.circles.empty', { query: query.trim() })} /> : null}
      </Spin>
      {hasMore ? <Button actionId="social-circles-load-more" fullWidth density="comfortable"
        execution={loading ? 'pending' : 'idle'} onActivate={() => void loadMore()}>
        {t('common.action.loadMore')}
      </Button> : null}
    </div>
    <Dialog open={createOpen} title={t('mobile.social.circles.create')}
      closeLabel={t('common.action.cancel')} onDismiss={() => { if (!creating) setCreateOpen(false); }}
      footer={<div className="circle-form-footer">
        <Button actionId="social-circle-create-cancel" emphasis="quiet" density="comfortable"
          availability={creating ? { kind: 'disabled', reason: t('mobile.social.circles.creating') } : undefined}
          onActivate={() => setCreateOpen(false)}>{t('common.action.cancel')}</Button>
        <Button actionId="social-circle-create-submit" emphasis="primary" density="comfortable"
          data-acceptance-id="social-circle-create-submit" execution={creating ? 'pending' : 'idle'}
          availability={!name.trim() ? { kind: 'disabled', reason: t('mobile.social.circles.name') } : undefined}
          onActivate={() => void submit()}>{t('common.action.create')}</Button>
      </div>}>
      <div className="circle-form">
        <TextField value={name} density="comfortable" data-acceptance-id="social-circle-create-name"
          aria-label={t('mobile.social.circles.name')} maxLength={120}
          placeholder={t('mobile.social.circles.name')} onValueChange={setName} />
        <TextArea value={description} density="comfortable" data-acceptance-id="social-circle-create-description"
          aria-label={t('mobile.social.circles.description')} maxLength={500} minimumRows={3} maximumRows={6}
          placeholder={t('mobile.social.circles.description')} onValueChange={setDescription} />
        {createError ? <MobileNotice tone="error">{t(createError)}</MobileNotice> : null}
      </div>
    </Dialog>
  </div>;
}

export function CirclesDetailHeader({ onBack, onCreate }: { onBack: () => void; onCreate: () => void }) {
  const { t } = useMobileI18n();
  return <header className="page-header">
    <IconButton actionId="circles.back" iconId="arrow-left" density="comfortable" emphasis="quiet"
      label={t('common.action.back')} onActivate={onBack} />
    <h1 className="header-title compact">{t('mobile.social.circles.title')}</h1>
    <IconButton actionId="circles.create" iconId="plus" density="comfortable" emphasis="quiet"
      label={t('mobile.social.circles.create')} data-acceptance-id="social-circle-create-open"
      onActivate={onCreate} />
  </header>;
}
