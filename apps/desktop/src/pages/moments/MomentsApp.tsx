import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Dialog, MomentScopeBar } from '@peers-touch/ui';
import { publicFeedErrorKey } from '../../services/publicFeedNative';
import { MomentsFeedView } from './MomentsFeedPage';
import { MomentDetailView } from './MomentDetailPage';
import { MomentsUserView } from './MomentsUserPage';
import { CircleManageView } from './CircleManagePage';
import { MomentComposer } from '../../components/moments/MomentComposer';
import { ensureCircleMemberProfiles, ensureMomentDetailProjection, ensureUserMomentsProjection } from '../../runtimes/momentsRuntime';
import { useActiveDiscoverySlice, useActiveMomentsSlice } from '../../components/moments/useActiveMomentsStore';
import { useMomentsNavigationStore, type MomentsTab } from '../../store/momentsNavigation';
import { useSessionStore } from '../../store/session';
import './moments-layout.css';
import './moments-glass.css';

/** Page owns navigation and transient dialogs; original Runtime owns all reads. */
export function MomentsApp() {
  const scope = useSessionStore(state => `${state.currentUser?.actorPtid ?? ''}:${state.sessionEpoch}:${state.stationPeerId ?? ''}`);
  return <MomentsSessionView key={scope} />;
}

function MomentsSessionView() {
  const { t } = useTranslation('moments');
  const view = useMomentsNavigationStore(state => state.view);
  const setView = useMomentsNavigationStore(state => state.setView);
  const [composerOpen, setComposerOpen] = useState(false);
  const [circleCreateOpen, setCircleCreateOpen] = useState(false);
  const [query, setQuery] = useState('');
  const scrollerRef = useRef<HTMLDivElement>(null);
  const me = useActiveDiscoverySlice(state => state.me);
  const { readError, recoveryError } = useActiveMomentsSlice(state => ({
    readError: state.publicFeedReadError, recoveryError: state.publicFeedRecoveryError,
  }));
  const activeTab = view.kind === 'tab' ? view.tab : view.from;
  const goTab = useCallback((tab: MomentsTab) => {
    setQuery(''); setView({ kind: 'tab', tab });
    if (tab === 'circles') void ensureCircleMemberProfiles();
  }, [setView]);
  const goDetail = useCallback((postId: string) => {
    void ensureMomentDetailProjection(postId);
    setView(previous => ({ kind: 'detail', postId, from: previous.kind === 'tab' ? previous.tab : previous.from }));
  }, [setView]);
  const goUser = useCallback((actorPtid: string) => {
    void ensureUserMomentsProjection(actorPtid);
    setView(previous => ({ kind: 'user', actorPtid, from: previous.kind === 'tab' ? previous.tab : previous.from }));
  }, [setView]);
  const goBack = useCallback(() => setView(previous => previous.kind === 'tab' ? previous
    : { kind: 'tab', tab: previous.from }), [setView]);
  const closeCreate = useCallback(() => setCircleCreateOpen(false), []);
  // Portaled dialogs/menus/popovers render in the app-level overlay host,
  // outside .moments-app. Mark that host only while Social is mounted so the
  // glass skin tokens reach overlays without leaking into other modules.
  useEffect(() => {
    const host = document.querySelector('.pt-overlay-host');
    host?.setAttribute('data-social-glass', '');
    return () => host?.removeAttribute('data-social-glass');
  }, []);
  return <div className="moments-app" data-social-glass="" data-social-scope={activeTab}>
    {view.kind === 'tab' && <MomentScopeBar value={activeTab}
      options={[{ value: 'feed', label: t('moments.tab.feed') }, { value: 'circles', label: t('moments.tab.circle') }]}
      onChange={goTab} query={query} onQueryChange={setQuery}
      copy={{ scope: t('moments.scope.label'), search: t('moments.scope.search'),
        action: t(activeTab === 'feed' ? 'moments.action.compose' : 'moments.circle.create') }}
      actionId={activeTab === 'feed' ? 'moments.compose' : 'circle.open-create'}
      actionClassName={activeTab === 'feed' ? 'pt-mom-compose-open' : 'pt-mom-circle-open'}
      actionAcceptanceId={activeTab === 'feed' ? 'social-composer-open' : 'social-circle-create-open'}
      onAction={() => activeTab === 'feed' ? setComposerOpen(true) : setCircleCreateOpen(true)} />}
    <div className="moments-scroll" ref={scrollerRef} data-moments-scroller>
      {(readError || recoveryError) && <Alert data-acceptance-id="social-public-feed-error"
        variant="inline" tone="warning" description={t(publicFeedErrorKey(readError ?? recoveryError))} />}
      {view.kind === 'detail' ? <MomentDetailView key={view.postId} postId={view.postId} commentId={view.commentId}
        viewerActorPtid={me?.id} onBack={goBack} onAuthorClick={goUser} />
        : view.kind === 'user' ? <MomentsUserView actorPtid={view.actorPtid} viewerActorPtid={me?.id}
          onBack={goBack} onOpenPost={goDetail} onAuthorClick={goUser} />
          : view.tab === 'circles' ? <CircleManageView query={query} createOpen={circleCreateOpen} onCloseCreate={closeCreate} />
            : <MomentsFeedView viewerActorPtid={me?.id} onOpenPost={goDetail} onAuthorClick={goUser}
              query={query} scrollRef={scrollerRef} />}
    </div>
    <Dialog open={composerOpen} onDismiss={() => setComposerOpen(false)} title={t('moments.compose.title')}
      closeLabel={t('moments.compose.close')} width={480}>
      {composerOpen && <MomentComposer onDismiss={() => setComposerOpen(false)} onPublished={() => {
        setComposerOpen(false); goTab('feed'); scrollerRef.current?.scrollTo({ top: 0 });
      }} />}
    </Dialog>
  </div>;
}
