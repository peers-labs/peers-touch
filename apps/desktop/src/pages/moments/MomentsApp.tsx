import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Tag } from '@lobehub/ui';
import { Card, Segmented, Space, Typography, theme } from 'antd';
import { Flexbox } from 'react-layout-kit';
import {
  Plus,
  ShieldCheck,
} from 'lucide-react';
import { MomentsFeedView } from './MomentsFeedPage';
import { MomentsExploreView } from './MomentsExplorePage';
import { MomentDetailView } from './MomentDetailPage';
import { MomentsUserView } from './MomentsUserPage';
import { UserSearchView } from './UserSearchPage';
import { CircleManageView } from './CircleManagePage';
import { useDiscoveryStore } from '../../store/discovery';
import {
  ensureMomentDetailProjection,
  ensureUserMomentsProjection,
} from '../../runtimes/momentsRuntime';
import { useMomentsStore } from '../../store/moments';

const { Text, Title } = Typography;

// MomentsApp — the single page registered in the module registry.
//
// Why an internal tab bar (vs. distinct top-level routes):
//   - The host router uses a flat `Page` enum. Adding nested
//     Moments routes would mean teaching the router about
//     hierarchical paths — out of scope for P2.
//   - Tab-style navigation matches Twitter / Mastodon UX where
//     "Home / Explore / Search / Profile / Circles" all live in
//     the same shell with shared header chrome.
//
// Internal navigation contract:
//   - Feed / Explore / Search / Circles are the four main "tabs".
//   - Detail and User are pushed views: clicking on a post / author
//     anywhere in the app sets `view = { kind: 'detail', postId }`
//     or `{ kind: 'user', actorId }` and renders that sub-page in
//     place of the tab content. A back button returns to the
//     previously-active tab.

type MainTab = 'feed' | 'explore' | 'search' | 'circles';

type MomentsView =
  | { kind: 'tab'; tab: MainTab }
  | { kind: 'detail'; postId: string; from: MainTab }
  | { kind: 'user'; actorId: string; from: MainTab };

export function MomentsApp() {
  const { t } = useTranslation('moments');
  const { token } = theme.useToken();
  const [view, setView] = useState<MomentsView>({ kind: 'tab', tab: 'feed' });
  const [layoutWidth, setLayoutWidth] = useState(1080);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const me = useDiscoveryStore((s) => s.me);
  const circles = useMomentsStore((s) => s.circles);
  const circleMembers = useMomentsStore((s) => s.circleMembers);

  const activeTab: MainTab =
    view.kind === 'tab' ? view.tab : view.from;
  const isNarrow = layoutWidth < 960;
  const isCompact = layoutWidth < 700;

  useEffect(() => {
    const target = scrollerRef.current;
    if (!target) return;

    const updateWidth = () => setLayoutWidth(target.clientWidth);
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  const goTab = useCallback((tab: MainTab) => {
    setView({ kind: 'tab', tab });
  }, []);

  const goDetail = useCallback(
    (postId: string) => {
      void ensureMomentDetailProjection(postId);
      setView((prev) => ({
        kind: 'detail',
        postId,
        from: prev.kind === 'tab' ? prev.tab : prev.from,
      }));
    },
    [],
  );

  const goUser = useCallback(
    (actorId: string) => {
      void ensureUserMomentsProjection(actorId);
      setView((prev) => ({
        kind: 'user',
        actorId,
        from: prev.kind === 'tab' ? prev.tab : prev.from,
      }));
    },
    [],
  );

  const goBack = useCallback(() => {
    setView((prev) =>
      prev.kind === 'tab' ? prev : { kind: 'tab', tab: prev.from },
    );
  }, []);

  const scrollFeedTop = useCallback(() => {
    scrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const openComposer = useCallback(() => {
    if (activeTab !== 'feed') {
      setView({ kind: 'tab', tab: 'feed' });
      window.requestAnimationFrame(scrollFeedTop);
      return;
    }
    scrollFeedTop();
  }, [activeTab, scrollFeedTop]);

  const tabBar = useMemo(
    () => (
      <Segmented
        value={activeTab}
        onChange={(v) => goTab(v as MainTab)}
        size={isCompact ? 'small' : 'middle'}
        style={{ maxWidth: '100%', overflowX: 'auto' }}
        options={[
          { value: 'feed', label: t('moments.tab.feed') },
          { value: 'explore', label: t('moments.tab.explore') },
          {
            value: 'search',
            label: t('moments.tab.search'),
          },
          {
            value: 'circles',
            label: t('moments.tab.circle'),
          },
        ]}
      />
    ),
    [activeTab, goTab, isCompact, t],
  );

  const activeContext = useMemo(() => {
    switch (activeTab) {
      case 'explore':
        return {
          title: t('moments.context.federatedTitle'),
          description: t('moments.context.federatedDescription'),
        };
      case 'search':
        return {
          title: t('moments.context.searchTitle'),
          description: t('moments.context.searchDescription'),
        };
      case 'circles':
        return {
          title: t('moments.context.circlesTitle'),
          description: t('moments.context.circlesDescription'),
        };
      case 'feed':
      default:
        return {
          title: t('moments.context.homeTitle'),
          description: t('moments.context.homeDescription'),
        };
    }
  }, [activeTab, t]);

  const content = (() => {
    if (view.kind === 'detail') {
      return (
        <MomentDetailView
          postId={view.postId}
          viewerActorId={me?.id}
          onBack={goBack}
          onAuthorClick={goUser}
        />
      );
    }
    if (view.kind === 'user') {
      return (
        <MomentsUserView
          actorId={view.actorId}
          viewerActorId={me?.id}
          onBack={goBack}
          onOpenPost={goDetail}
        />
      );
    }
    switch (view.tab) {
      case 'feed':
        return (
          <MomentsFeedView
            viewerActorId={me?.id}
            onOpenPost={goDetail}
            onAuthorClick={goUser}
            onComposerPublished={scrollFeedTop}
          />
        );
      case 'explore':
        return (
          <MomentsExploreView
            viewerActorId={me?.id}
            onOpenPost={goDetail}
            onAuthorClick={goUser}
          />
        );
      case 'search':
        return (
          <UserSearchView
            viewerActorId={me?.id}
            onOpenUser={goUser}
          />
        );
      case 'circles':
        return <CircleManageView />;
      default:
        return null;
    }
  })();

  const contextPanel = (
    <Card
      style={{ borderRadius: 16, borderColor: token.colorBorderSecondary, boxShadow: 'none' }}
      bodyStyle={{ padding: isCompact ? 12 : 14 }}
    >
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Space align="center">
          <ShieldCheck size={16} color={token.colorPrimary} />
          <Text strong>{activeContext.title}</Text>
        </Space>
        <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.6 }}>
          {activeContext.description}
        </Text>
        {!isCompact && (
          <Space size={6} wrap>
            <Tag color={activeTab === 'feed' ? 'blue' : 'default'} style={{ margin: 0, borderRadius: 999 }}>
              {t('moments.filter.following')}
            </Tag>
            <Tag color={activeTab === 'circles' ? 'blue' : 'default'} style={{ margin: 0, borderRadius: 999 }}>
              {t('moments.filter.circles')}
            </Tag>
            <Tag color={activeTab === 'explore' ? 'blue' : 'default'} style={{ margin: 0, borderRadius: 999 }}>
              {t('moments.filter.remotePublic')}
            </Tag>
          </Space>
        )}
      </Space>
    </Card>
  );

  const circlesPanel = (
    <Card
      style={{ borderRadius: 16, borderColor: token.colorBorderSecondary, boxShadow: 'none' }}
      bodyStyle={{ padding: 14 }}
    >
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Flexbox horizontal justify="space-between" align="center">
          <Text strong>{t('moments.sidebar.circlesTitle')}</Text>
          <Button type="link" size="small" onClick={() => goTab('circles')}>
            {t('moments.action.manageCircles')}
          </Button>
        </Flexbox>
        {circles.length === 0 ? (
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('moments.placeholder.circleEmpty')}
          </Text>
        ) : (
          circles.slice(0, 4).map((circle) => (
            <Flexbox key={String(circle.id)} horizontal justify="space-between" align="center">
              <Text ellipsis style={{ maxWidth: 180 }}>{circle.name}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('moments.circle.memberCount', {
                  count: circleMembers[String(circle.id)]?.length ?? 0,
                })}
              </Text>
            </Flexbox>
          ))
        )}
      </Space>
    </Card>
  );

  return (
    <Flexbox
      flex={1}
      style={{
        background: token.colorBgLayout,
        minHeight: 0,
      }}
    >
      <div
        ref={scrollerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: isCompact ? '14px 12px 28px' : '18px 24px 32px',
          minHeight: 0,
        }}
      >
        <div style={{ maxWidth: isNarrow ? 720 : 1080, margin: '0 auto' }}>
          <div
            style={{
              marginBottom: isCompact ? 10 : 14,
              padding: '0 2px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: isCompact ? 'flex-start' : 'center',
                justifyContent: 'space-between',
                flexDirection: isCompact ? 'column' : 'row',
                gap: isCompact ? 10 : 18,
              }}
            >
              <div style={{ minWidth: 0, width: isCompact ? '100%' : undefined }}>
                <Flexbox gap={2} style={{ minWidth: 0 }}>
                  <Title level={3} style={{ margin: 0, fontSize: isCompact ? 22 : 24 }}>
                    {t('moments.title')}
                  </Title>
                  <Text type="secondary" ellipsis style={{ maxWidth: isCompact ? '100%' : 520 }}>
                    {t('moments.subtitle')}
                  </Text>
                </Flexbox>
              </div>
              <Space
                size={10}
                wrap
                style={{
                  justifyContent: isCompact ? 'flex-start' : 'flex-end',
                  width: isCompact ? '100%' : undefined,
                }}
              >
                {tabBar}
                <Button type="primary" icon={<Plus size={14} />} onClick={openComposer}>
                  {t('moments.action.compose')}
                </Button>
              </Space>
            </div>
          </div>

          {isNarrow && (
            <div style={{ marginBottom: 10 }}>
              {contextPanel}
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isNarrow
                ? 'minmax(0, 1fr)'
                : 'minmax(0, 700px) minmax(240px, 280px)',
              alignItems: 'start',
              gap: 16,
            }}
          >
            <main style={{ minWidth: 0, maxWidth: isNarrow ? 700 : undefined, width: '100%', margin: isNarrow ? '0 auto' : undefined }}>{content}</main>
            <aside
              style={{
                position: 'sticky',
                top: 18,
                display: isNarrow ? 'none' : 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              {contextPanel}
              {circlesPanel}
            </aside>
          </div>
        </div>
      </div>
    </Flexbox>
  );
}
