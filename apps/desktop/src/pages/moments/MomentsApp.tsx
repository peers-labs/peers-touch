import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Tag, theme } from 'antd';
import {
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
import {
  SocialContentRail,
  SocialScopeBar,
  SocialSection,
} from '../../components/moments/surfaces';

// MomentsApp — the single page registered in the module registry.
//
// UI Identity refactor notes:
//   - The page header (title + tabs + primary CTA) is rendered
//     through SocialScopeBar. They share one group — no more
//     "tabs and button look like different component systems".
//   - The main column is SocialContentRail. It owns width, padding,
//     vertical rhythm. Child pages render their content directly
//     inside it.
//   - Context sidebar (ShieldCheck block) and Circles panel keep
//     using antd Card but with token-aligned styling — the visual
//     surface is a separate concern from the content rail.

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

  const tabs = useMemo(
    () => [
      { value: 'feed', label: t('moments.tab.feed') },
      { value: 'explore', label: t('moments.tab.explore') },
      { value: 'search', label: t('moments.tab.search') },
      { value: 'circles', label: t('moments.tab.circle') },
    ],
    [t],
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
      styles={{
        body: { padding: isCompact ? 12 : 14 },
      }}
      style={{
        borderRadius: 14,
        borderColor: token.colorBorderSecondary,
        boxShadow: 'none',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ShieldCheck size={16} color={token.colorPrimary} />
          <span style={{ fontWeight: 600, fontSize: 13 }}>{activeContext.title}</span>
        </div>
        <span style={{ fontSize: 12.5, lineHeight: 1.6, color: token.colorTextSecondary }}>
          {activeContext.description}
        </span>
        {!isCompact && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <Tag
              color={activeTab === 'feed' ? 'blue' : 'default'}
              style={{ margin: 0, borderRadius: 999 }}
            >
              {t('moments.filter.following')}
            </Tag>
            <Tag
              color={activeTab === 'circles' ? 'blue' : 'default'}
              style={{ margin: 0, borderRadius: 999 }}
            >
              {t('moments.filter.circles')}
            </Tag>
            <Tag
              color={activeTab === 'explore' ? 'blue' : 'default'}
              style={{ margin: 0, borderRadius: 999 }}
            >
              {t('moments.filter.remotePublic')}
            </Tag>
          </div>
        )}
      </div>
    </Card>
  );

  const circlesPanel = (
    <Card
      styles={{ body: { padding: 14 } }}
      style={{ borderRadius: 14, borderColor: token.colorBorderSecondary, boxShadow: 'none' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{t('moments.sidebar.circlesTitle')}</span>
          <Button type="link" size="small" onClick={() => goTab('circles')}>
            {t('moments.action.manageCircles')}
          </Button>
        </div>
        {circles.length === 0 ? (
          <span style={{ fontSize: 12.5, color: token.colorTextSecondary }}>
            {t('moments.placeholder.circleEmpty')}
          </span>
        ) : (
          circles.slice(0, 4).map((circle) => (
            <div
              key={String(circle.id)}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 180,
                }}
              >
                {circle.name}
              </span>
              <span style={{ fontSize: 12, color: token.colorTextSecondary }}>
                {t('moments.circle.memberCount', {
                  count: circleMembers[String(circle.id)]?.length ?? 0,
                })}
              </span>
            </div>
          ))
        )}
      </div>
    </Card>
  );

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
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
          <SocialScopeBar
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={(v) => goTab(v as MainTab)}
            primaryAction={{
              label: t('moments.action.compose'),
              onClick: openComposer,
            }}
            compact={isCompact}
          />

          {isNarrow && (
            <SocialSection tone="soft">{contextPanel}</SocialSection>
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
            <main
              style={{
                minWidth: 0,
                maxWidth: isNarrow ? 700 : undefined,
                width: '100%',
                margin: isNarrow ? '0 auto' : undefined,
              }}
            >
              <SocialContentRail narrow={isNarrow} compact={isCompact}>
                {content}
              </SocialContentRail>
            </main>
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
    </div>
  );
}
