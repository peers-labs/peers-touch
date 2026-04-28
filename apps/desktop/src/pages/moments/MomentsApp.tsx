import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Segmented, Space, theme } from 'antd';
import { Flexbox } from 'react-layout-kit';
import { Plus, Search, Sparkles, UsersRound } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { MomentComposer } from '../../components/moments/MomentComposer';
import { MomentsFeedView } from './MomentsFeedPage';
import { MomentsExploreView } from './MomentsExplorePage';
import { MomentDetailView } from './MomentDetailPage';
import { MomentsUserView } from './MomentsUserPage';
import { UserSearchView } from './UserSearchPage';
import { CircleManageView } from './CircleManagePage';
import { useDiscoveryStore } from '../../store/discovery';

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
  const [composerOpen, setComposerOpen] = useState(false);

  const me = useDiscoveryStore((s) => s.me);
  const loadMe = useDiscoveryStore((s) => s.loadMe);

  // Cheap-cached identity fetch — required by FollowButton self-hide
  // and by user-page "is this me?" checks. Failure is non-fatal.
  useEffect(() => {
    if (!me) loadMe().catch(() => {});
  }, [me, loadMe]);

  const activeTab: MainTab =
    view.kind === 'tab' ? view.tab : view.from;

  const goTab = useCallback((tab: MainTab) => {
    setView({ kind: 'tab', tab });
  }, []);

  const goDetail = useCallback(
    (postId: string) =>
      setView((prev) => ({
        kind: 'detail',
        postId,
        from: prev.kind === 'tab' ? prev.tab : prev.from,
      })),
    [],
  );

  const goUser = useCallback(
    (actorId: string) =>
      setView((prev) => ({
        kind: 'user',
        actorId,
        from: prev.kind === 'tab' ? prev.tab : prev.from,
      })),
    [],
  );

  const goBack = useCallback(() => {
    setView((prev) =>
      prev.kind === 'tab' ? prev : { kind: 'tab', tab: prev.from },
    );
  }, []);

  const headerActions = useMemo(
    () => (
      <Space>
        <Button
          type="primary"
          icon={<Plus size={14} />}
          onClick={() => setComposerOpen(true)}
        >
          {t('moments.action.compose')}
        </Button>
      </Space>
    ),
    [t],
  );

  const tabBar = useMemo(
    () => (
      <Segmented
        value={activeTab}
        onChange={(v) => goTab(v as MainTab)}
        options={[
          { value: 'feed', label: t('moments.tab.feed'), icon: <Sparkles size={14} /> },
          { value: 'explore', label: t('moments.tab.explore') },
          {
            value: 'search',
            label: t('moments.tab.search', { defaultValue: t('moments.action.search') }),
            icon: <Search size={14} />,
          },
          {
            value: 'circles',
            label: t('moments.tab.circle'),
            icon: <UsersRound size={14} />,
          },
        ]}
      />
    ),
    [activeTab, goTab, t],
  );

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

  return (
    <Flexbox flex={1} style={{ background: token.colorBgLayout, minHeight: 0 }}>
      <PageHeader
        title={t('moments.title')}
        subtitle={t('moments.subtitle')}
        icon={<Sparkles size={20} color={token.colorPrimary} />}
        actions={headerActions}
        extra={tabBar}
      />
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 24px',
          minHeight: 0,
        }}
      >
        <div style={{ maxWidth: 720, margin: '0 auto' }}>{content}</div>
      </div>
      <MomentComposer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        onPublished={() => goTab('feed')}
      />
    </Flexbox>
  );
}
