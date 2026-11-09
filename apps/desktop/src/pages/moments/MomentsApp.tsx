import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MomentsFeedView } from './MomentsFeedPage';
import { MomentsExploreView } from './MomentsExplorePage';
import { MomentDetailView } from './MomentDetailPage';
import { MomentsUserView } from './MomentsUserPage';
import { UserSearchView } from './UserSearchPage';
import { CircleManageView } from './CircleManagePage';
import {
  ensureCircleMemberProfiles,
  ensureMomentDetailProjection,
  ensureUserMomentsProjection,
} from '../../runtimes/momentsRuntime';
import { SocialContentRail, SocialScopeBar } from '../../components/moments/surfaces';
import { useActiveDiscoverySlice } from '../../components/moments/useActiveMomentsStore';
import { useMomentsNavigationStore, type MomentsTab } from '../../store/momentsNavigation';
import './moments-app.css';

// MomentsApp — the single page registered in the module registry.
//
// Layout follows the confirmed mobile-social-parity prototype:
//   one centered content rail with a thin header (Home/Explore segment,
//   quiet Search/Audiences entries, one compose action). There is no
//   explanatory side card and no second column — the feed is the product.

type MainTab = MomentsTab;

export function MomentsApp() {
  const { t } = useTranslation('moments');
  const view = useMomentsNavigationStore(state => state.view);
  const setView = useMomentsNavigationStore(state => state.setView);
  const [composerOpen, setComposerOpen] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const me = useActiveDiscoverySlice((s) => s.me);

  const activeTab: MainTab =
    view.kind === 'tab' ? view.tab : view.from;

  const goTab = useCallback((tab: MainTab) => {
    setView({ kind: 'tab', tab });
  }, [setView]);

  const goDetail = useCallback(
    (postId: string) => {
      void ensureMomentDetailProjection(postId);
      setView((prev) => ({
        kind: 'detail',
        postId,
        from: prev.kind === 'tab' ? prev.tab : prev.from,
      }));
    },
    [setView],
  );

  const goUser = useCallback(
    (actorPtid: string) => {
      void ensureUserMomentsProjection(actorPtid);
      setView((prev) => ({
        kind: 'user',
        actorPtid,
        from: prev.kind === 'tab' ? prev.tab : prev.from,
      }));
    },
    [setView],
  );

  const goBack = useCallback(() => {
    setView((prev) =>
      prev.kind === 'tab' ? prev : { kind: 'tab', tab: prev.from },
    );
  }, [setView]);

  const scrollFeedTop = useCallback(() => {
    scrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const openComposer = useCallback(() => {
    setComposerOpen(true);
    if (activeTab !== 'feed') {
      setView({ kind: 'tab', tab: 'feed' });
      window.requestAnimationFrame(scrollFeedTop);
      return;
    }
    scrollFeedTop();
  }, [activeTab, scrollFeedTop, setView]);

  const closeComposer = useCallback(() => {
    setComposerOpen(false);
  }, []);

  const goCircles = useCallback(() => {
    void ensureCircleMemberProfiles();
    setView({ kind: 'tab', tab: 'circles' });
  }, [setView]);

  const scopeTabs = [
    { value: 'feed', label: t('moments.tab.feed') },
    { value: 'explore', label: t('moments.tab.explore') },
  ];

  const scopeEntries = [
    {
      value: 'search',
      iconId: 'search' as const,
      label: t('moments.tab.search'),
      onActivate: () => goTab('search'),
    },
    {
      value: 'circles',
      iconId: 'users-round' as const,
      label: t('moments.tab.circle'),
      onActivate: () => goCircles(),
    },
  ];

  const content = (() => {
    if (view.kind === 'detail') {
      return (
        <MomentDetailView
          key={view.postId}
          postId={view.postId}
          commentId={view.commentId}
          viewerActorPtid={me?.id}
          onBack={goBack}
          onAuthorClick={goUser}
        />
      );
    }
    if (view.kind === 'user') {
      return (
        <MomentsUserView
          actorPtid={view.actorPtid}
          viewerActorPtid={me?.id}
          onBack={goBack}
          onOpenPost={goDetail}
        />
      );
    }
    switch (view.tab) {
      case 'feed':
        return (
          <MomentsFeedView
            viewerActorPtid={me?.id}
            onOpenPost={goDetail}
            onAuthorClick={goUser}
            composerOpen={composerOpen}
            onCloseComposer={closeComposer}
            onComposerPublished={() => {
              setComposerOpen(false);
              scrollFeedTop();
            }}
          />
        );
      case 'explore':
        return (
          <MomentsExploreView
            viewerActorPtid={me?.id}
            onOpenPost={goDetail}
            onAuthorClick={goUser}
          />
        );
      case 'search':
        return (
          <UserSearchView
            viewerActorPtid={me?.id}
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
    <div className="pt-social">
      <div ref={scrollerRef} className="pt-social__scroll">
        <div className="pt-social__inner">
          <SocialScopeBar
            tabs={scopeTabs}
            activeTab={activeTab}
            onTabChange={(v) => goTab(v as MainTab)}
            entries={scopeEntries}
            primaryAction={{
              label: t('moments.action.compose'),
              iconId: 'plus',
              onClick: openComposer,
            }}
          />
          <SocialContentRail>
            {content}
          </SocialContentRail>
        </div>
      </div>
    </div>
  );
}
