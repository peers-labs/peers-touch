import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert as PtAlert,
  Button as PtButton,
  Dialog,
  Empty as PtEmpty,
  Spin as PtSpin,
  Tag as PtTag,
  TextField as PtTextField,
  Toggle as PtToggle,
  Tooltip as PtTooltip,
} from '@peers-touch/ui';
import { Search, ShieldCheck, Globe, Server } from 'lucide-react';
import { api } from '../../services/desktop_api';
import {
  useActiveChatFederationSlice,
  useActiveSocialChatSlice,
  useActiveSocialChatStore,
} from './useActiveSocialChatStore';
import {
  isSameStationActor,
  localFederationFallback,
  singleFederationId,
} from '../../store/friendshipProjection';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { actorDisplayName } from '../../store/socialProfileProjection';
import { FederatedHandle } from '../FederatedHandle';
import {
  catalogEntryToSearchResult,
  findPeopleScopePresentation,
  friendRequestFederationId,
  localActorToSearchResult,
  mergeActorSearchResults,
  orderFederationOptions,
  readRecentFederationId,
  resolvedProfileToSearchResult,
  writeRecentFederationId,
  type ActorSearchResult,
} from './findPeopleIdentity';
import { notifySuccess } from '../../ui/feedback';

interface Props {
  open: boolean;
  onClose: () => void;
}

type SearchScope = 'all' | 'federation';

/** Federation chips shown on the single collapsed row (after the All chip). */
const COLLAPSED_FEDERATION_VISIBLE = 3;

const FEDERATED_HANDLE_RE = /^@?([a-zA-Z0-9._-]+)(?:@([a-zA-Z0-9.-]+(?::\d+)?))?$/;

interface ParsedHandle {
  isFederated: boolean;
  hasHost: boolean;
  canonical: string;
  localPart: string;
}

function parseHandleInput(raw: string): ParsedHandle {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { isFederated: false, hasHost: false, canonical: '', localPart: '' };
  }
  const match = trimmed.startsWith('@')
    ? FEDERATED_HANDLE_RE.exec(trimmed)
    : null;
  if (!match) {
    return { isFederated: false, hasHost: false, canonical: '', localPart: '' };
  }
  const [, local, host] = match;
  if (!local) {
    return { isFederated: false, hasHost: false, canonical: '', localPart: '' };
  }
  if (host) {
    return {
      isFederated: true,
      hasHost: true,
      canonical: `@${local.toLowerCase()}@${host.toLowerCase()}`,
      localPart: local,
    };
  }
  return {
    isFederated: true,
    hasHost: false,
    canonical: '',
    localPart: local,
  };
}

export function FindPeopleModal({ open, onClose }: Props) {
  const { t } = useTranslation('chat');
  const {
    sendFriendRequest,
    friendRequests,
    friendRequestsLoading,
    friendRequestsLoadedAt,
    friendRequestsError,
  } = useActiveSocialChatSlice((s) => ({
    sendFriendRequest: s.sendFriendRequest,
    friendRequests: s.friendRequests,
    friendRequestsLoading: s.friendRequestsLoading,
    friendRequestsLoadedAt: s.friendRequestsLoadedAt,
    friendRequestsError: s.friendRequestsError,
  }));
  const currentUserPtid = useActiveSocialChatStore((s) => s.currentUserPtid);
  const { federations, rememberCatalogEntries, refreshFederationContexts, self } =
    useActiveChatFederationSlice((s) => ({
      federations: s.federations,
      rememberCatalogEntries: s.rememberCatalogEntries,
      refreshFederationContexts: s.refreshFederationContexts,
      self: s.self,
    }));

  // Federation contexts are session-scoped and fetched at bootstrap. The
  // Station can materialize its default social federation after this session
  // started, so reconcile on open instead of forcing a re-login to see it.
  useEffect(() => {
    if (!open) return;
    void refreshFederationContexts();
  }, [open, refreshFederationContexts]);

  // Single-row scope chips: collapse the long Federation list behind a More
  // toggle instead of wrapping into a tall column that pushes results around.
  const [scopesExpanded, setScopesExpanded] = useState(false);
  // Most-recently-used Federation scope, persisted across modal sessions and
  // used to pin that context to the front of the chip row.
  const [recentFederationId, setRecentFederationId] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    setRecentFederationId(readRecentFederationId());
  }, [open]);

  const federationOptions = useMemo(
    () => orderFederationOptions(
      federations.map((f) => ({ federationId: f.federationId, federationName: f.name })),
      recentFederationId,
    ),
    [federations, recentFederationId],
  );
  const defaultFederationId = useMemo(
    () => singleFederationId(federations),
    [federations],
  );

  const [searchText, setSearchText] = useState('');
  const [results, setResults] = useState<ActorSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [searchScope, setSearchScope] = useState<SearchScope>('all');
  const [selectedFederationId, setSelectedFederationId] = useState<string>('');
  const [searchError, setSearchError] = useState('');
  const [requestErrors, setRequestErrors] = useState<Record<string, string>>({});

  const hiddenFederationCount = Math.max(
    0,
    federationOptions.length - COLLAPSED_FEDERATION_VISIBLE,
  );
  const visibleFederationOptions = scopesExpanded || hiddenFederationCount === 0
    ? federationOptions
    : federationOptions.slice(0, COLLAPSED_FEDERATION_VISIBLE);

  const pendingReceiverIds = useMemo(() => {
    const ids = new Set<string>();
    for (const req of friendRequests) {
      if ((req.status === 0 || req.status === 1) && req.senderPtid === currentUserPtid) {
        ids.add(req.receiverPtid);
      }
    }
    return ids;
  }, [friendRequests, currentUserPtid]);
  const friendPtidSet = useMemo(
    () => new Set(friendRequests
      .filter((request) => request.status === 2)
      .map((request) => (
        request.senderPtid === currentUserPtid
          ? request.receiverPtid
          : request.receiverPtid === currentUserPtid
            ? request.senderPtid
            : ''
      ))
      .filter(Boolean)),
    [currentUserPtid, friendRequests],
  );
  const friendshipReady = Boolean(
    currentUserPtid
    && friendRequestsLoadedAt,
  );

  const parsed = useMemo(() => parseHandleInput(searchText), [searchText]);
  const activeFederationId = selectedFederationId || defaultFederationId;
  const blockedByGate = parsed.isFederated
    && parsed.hasHost
    && !activeFederationId;

  const handleSearch = async () => {
    const trimmed = searchText.trim();
    if (!trimmed) return;
    setSearchError('');
    setSearching(true);
    try {
      if (parsed.isFederated && parsed.hasHost) {
        if (!activeFederationId) {
          setSearchError(t('chat.social.findPeople.catalogNoFederation'));
          return;
        }
        const view = await api.federationResolve(activeFederationId, parsed.canonical);
        const item = resolvedProfileToSearchResult(view);
        setResults(item ? [item] : []);
        return;
      }
      const query = parsed.localPart || trimmed.replace(/^@/, '');
      let localSearchError: unknown;
      let catalogSearchError: unknown;
      // "all" must search BOTH the local Station actors and every Federation
      // catalog. A specific Federation scope searches only that catalog.
      // Fanning the catalog out across all contexts is what lets "all" reach
      // the local/self actors that the actor-only search misses; each request
      // degrades independently so one unreachable federation never blanks the
      // whole result set.
      const wantLocal = searchScope === 'all';
      const catalogFederationIds = searchScope === 'federation'
        ? (activeFederationId ? [activeFederationId] : [])
        : federationOptions.map((option) => option.federationId);
      if (!wantLocal && catalogFederationIds.length === 0) {
        setSearchError(t('chat.social.findPeople.catalogNoFederation'));
        return;
      }

      const [localSearch, catalogResponses] = await Promise.all([
        wantLocal
          ? api.actorSearchActors(query).catch((error: unknown) => {
            localSearchError = error;
            return null;
          })
          : Promise.resolve(null),
        Promise.all(catalogFederationIds.map((federationId) =>
          api.federationCatalogSearch({
            federation_id: federationId,
            prefix: query,
            page_size: 20,
          }).catch((error: unknown) => {
            catalogSearchError ??= error;
            return null;
          }),
        )),
      ]);

      const anyCatalogResponse = catalogResponses.some((response) => response !== null);
      if (!localSearch && !anyCatalogResponse) {
        throw localSearchError || catalogSearchError || new Error('Search unavailable');
      }

      const localResults = (localSearch?.items ?? [])
        .map(localActorToSearchResult)
        .filter((item): item is ActorSearchResult => item !== null);
      const catalogEntries = catalogResponses.flatMap((response) => response?.entries ?? []);
      rememberCatalogEntries(catalogEntries);
      setResults(mergeActorSearchResults(
        localResults,
        catalogEntries.map(catalogEntryToSearchResult),
      ));
    } catch (e: unknown) {
      const fallback = parsed.isFederated && parsed.hasHost
        ? t('chat.social.findPeople.resolveFailed', { handle: parsed.canonical })
        : t('chat.social.findPeople.searchFailed');
      setSearchError((e as { message?: string })?.message || fallback);
    } finally {
      setSearching(false);
    }
  };

  const handleSendRequest = async (target: ActorSearchResult) => {
    const receiverPtid = target.id.trim();
    const previousRequestFederationId = friendRequestFederationId(
      friendRequests,
      currentUserPtid,
      receiverPtid,
    );
    if (addingId) return;
    if (!receiverPtid) {
      setSearchError(t('chat.social.findPeople.requestIdentityUnavailable'));
      return;
    }
    if (receiverPtid === currentUserPtid) return;
    // With multiple federations there is no single default. A same-Station
    // actor only needs a valid local federation context, so fall back to the
    // first active context; federated targets keep requiring an explicit
    // Federation scope and stay guarded below.
    const sameStation = isSameStationActor({
      selfHomeStationPeerId: self?.home_station_peer_id,
      targetHomeStationPeerId: target.homeStationPeerId,
    });
    const federationId =
      activeFederationId
      || previousRequestFederationId
      || defaultFederationId
      || (sameStation ? localFederationFallback(federations) : '');
    if (!federationId || !target.homeStationPeerId) {
      setRequestErrors((current) => ({
        ...current,
        [receiverPtid]: t('chat.social.findPeople.requestIdentityUnavailable'),
      }));
      return;
    }
    setAddingId(receiverPtid);
    setRequestErrors((current) => {
      if (!(receiverPtid in current)) return current;
      const next = { ...current };
      delete next[receiverPtid];
      return next;
    });
    try {
      await sendFriendRequest(
        receiverPtid,
        target.homeStationPeerId,
        federationId,
        '',
      );
      notifySuccess(t('chat.social.findPeople.requestSent'));
    } catch (e: unknown) {
      setRequestErrors((current) => ({
        ...current,
        [receiverPtid]: (e as { message?: string })?.message
          || t('chat.social.findPeople.addFailed'),
      }));
    } finally {
      setAddingId(null);
    }
  };

  const handleClose = () => {
    setSearchText('');
    setResults([]);
    setSearchScope('all');
    setSelectedFederationId('');
    setSearchError('');
    setRequestErrors({});
    setScopesExpanded(false);
    onClose();
  };

  const handleScopeChange = (
    scope: SearchScope,
    federationId = '',
  ) => {
    setSearchScope(scope);
    setSelectedFederationId(scope === 'federation' ? federationId : '');
    if (scope === 'federation' && federationId) {
      writeRecentFederationId(federationId);
      setRecentFederationId(federationId);
    }
    setSearchError('');
    setResults([]);
  };

  const searchDisabledReason = blockedByGate
    ? t('chat.social.findPeople.catalogNoFederation')
    : !searchText.trim()
      ? t('chat.social.findPeople.searchPlaceholderFederated')
      : '';

  return (
    <Dialog
      open={open}
      onDismiss={handleClose}
      title={t('chat.social.findPeople.title')}
      width={420}
      closeLabel={t('chat.social.messageArea.cancel')}
    >
      <div
        className="sc-find"
        data-chat-find-people
        data-chat-friendship-state={
          friendRequestsError ? 'error' : friendshipReady ? 'ready' : 'loading'
        }
      >
        {friendRequestsError && (
          <PtAlert tone="danger" title={t('chat.social.findPeople.friendshipUnavailable')} />
        )}

        <PtTextField
          data-chat-find-people-input
          leading={<Search size={14} />}
          trailing={
            <PtButton
              actionId="find-people-search"
              data-chat-find-people-search
              emphasis="quiet"
              density="compact"
              execution={searching ? 'pending' : 'idle'}
              onActivate={() => void handleSearch()}
              availability={searchDisabledReason
                ? { kind: 'disabled', reason: searchDisabledReason }
                : undefined}
            >
              {t('chat.social.findPeople.search')}
            </PtButton>
          }
          placeholder={t('chat.social.findPeople.searchPlaceholderFederated')}
          value={searchText}
          onValueChange={(value) => {
            setSearchText(value);
            if (!value.trim()) setResults([]);
          }}
          onEnter={() => void handleSearch()}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label={t('chat.social.findPeople.title')}
        />

        {/* Scope chips — one row; long Federation lists collapse behind More. */}
        <div
          className="sc-find__scopes"
          data-chat-find-people-scopes-expanded={scopesExpanded ? 'true' : 'false'}
        >
          <PtToggle
            actionId="find-people-scope-all"
            className="sc-scope-chip"
            selected={searchScope === 'all'}
            onSelectedChange={() => void handleScopeChange('all')}
            data-chat-find-people-scope="all"
          >
            {t('chat.social.findPeople.scopeAll')}
          </PtToggle>

          {visibleFederationOptions.map((fed) => {
            const isActive = searchScope === 'federation'
              && selectedFederationId === fed.federationId;
            const presentation = findPeopleScopePresentation(
              fed.federationName,
              fed.federationId,
            );
            return (
              <PtTooltip
                key={fed.federationId}
                label={t(presentation.tooltipKey, { name: presentation.name })}
              >
                <PtToggle
                  actionId={`find-people-scope-federation-${fed.federationId}`}
                  className="sc-scope-chip"
                  selected={isActive}
                  onSelectedChange={() => {
                    if (isActive) {
                      void handleScopeChange('all');
                    } else {
                      void handleScopeChange('federation', fed.federationId);
                    }
                  }}
                  aria-label={t(presentation.tooltipKey, { name: presentation.name })}
                  data-chat-find-people-scope="federation"
                  data-chat-find-people-federation-id={fed.federationId}
                >
                  <Globe size={10} />
                  {t(presentation.labelKey, { name: presentation.name })}
                </PtToggle>
              </PtTooltip>
            );
          })}

          {hiddenFederationCount > 0 ? (
            <PtToggle
              actionId="find-people-scope-more"
              className="sc-scope-chip sc-scope-chip--more"
              selected={false}
              onSelectedChange={() => setScopesExpanded((value) => !value)}
              data-chat-find-people-scope-more
              aria-expanded={scopesExpanded}
            >
              {scopesExpanded
                ? t('chat.social.findPeople.scopeLess')
                : t('chat.social.findPeople.scopeMore', { count: hiddenFederationCount })}
            </PtToggle>
          ) : null}

          {federationOptions.length === 0 && (
            <span className="sc-find__no-federation">
              {t('chat.social.findPeople.catalogNoFederation')}
            </span>
          )}
        </div>

        {searchError ? (
          <PtAlert data-chat-find-people-error tone="danger" title={searchError} />
        ) : null}

        <div className="sc-find__list">
          {searching ? (
            <div className="sc-find__status">
              <PtSpin size="small" />
              <span>
                {parsed.isFederated && parsed.hasHost
                  ? t('chat.social.findPeople.resolving')
                  : t('chat.social.findPeople.catalogSearching')}
              </span>
            </div>
          ) : results.length === 0 ? (
            <PtEmpty
              className="sc-find__empty"
              description={searchText ? t('chat.social.findPeople.noResults') : t('chat.social.findPeople.hint')}
            />
          ) : (
            results.map((r) => {
              const receiverPtid = r.id;
              const isPending = pendingReceiverIds.has(receiverPtid);
              const isSelf = !!currentUserPtid && receiverPtid === currentUserPtid;
              const isFriend = friendPtidSet.has(receiverPtid);
              const homeStation = r.federation?.homeStationDomain
                || r.homeStationName
                || r.homeStationPeerId;
              const actionLabel = isSelf
                ? t('chat.social.findPeople.self')
                : isFriend
                  ? t('chat.social.findPeople.alreadyFriend')
                  : !friendshipReady
                    ? t('chat.social.findPeople.checkingFriendship')
                    : isPending
                      ? t('chat.social.findPeople.awaitingApproval')
                      : t('chat.social.findPeople.sendRequest');
              return (
                <div
                  key={receiverPtid || r.id}
                  className="sc-find__result"
                  data-chat-find-people-result={receiverPtid}
                  data-chat-find-people-handle={r.federation?.handle ?? ''}
                  data-chat-find-people-home-station={homeStation}
                  data-chat-find-people-home-station-peer-id={r.homeStationPeerId}
                  data-chat-find-people-home-station-domain={
                    r.federation?.homeStationDomain ?? ''
                  }
                  data-chat-friend-state={isFriend ? 'friend' : isPending ? 'pending' : 'none'}
                >
                  <UserSquareAvatar
                    remoteUrl={r.avatar}
                    name={actorDisplayName(r.displayName)
                      || actorDisplayName(r.username, t('chat.social.detail.unknownMember'))}
                    size={36}
                  />
                  <div className="sc-find__result-body">
                    <div className="sc-find__result-line">
                      <strong className="sc-find__result-name">
                        {actorDisplayName(r.displayName)
                          || actorDisplayName(r.username, t('chat.social.detail.unknownMember'))}
                      </strong>
                      {r.federation && (
                        <PtTag tone="success" leading={<ShieldCheck size={11} />}>
                          {t('chat.social.findPeople.tagVerified')}
                        </PtTag>
                      )}
                      {r.federation?.fromCache && (
                        <PtTag>{t('chat.social.findPeople.tagFromCache')}</PtTag>
                      )}
                      {r.federation?.isLocal && (
                        <PtTag tone="info">{t('chat.social.findPeople.tagLocal')}</PtTag>
                      )}
                      {r.homeStationName && (
                        <PtTag leading={<Server size={10} />}>{r.homeStationName}</PtTag>
                      )}
                    </div>
                    <FederatedHandle
                      localPart={r.username}
                      home={r.federation?.homeStationDomain}
                      fontSize={11}
                    />
                    <span className="sc-find__ptid" title={receiverPtid} data-chat-find-people-ptid>
                      {receiverPtid}
                    </span>
                    {homeStation && !r.federation?.homeStationDomain ? (
                      <span className="sc-find__ptid" title={homeStation} data-chat-find-people-station>
                        {t('chat.social.identity.station', { station: homeStation })}
                      </span>
                    ) : null}
                    {requestErrors[receiverPtid] ? (
                      <PtAlert
                        data-chat-find-people-request-error={receiverPtid}
                        tone="danger"
                        title={requestErrors[receiverPtid]}
                      />
                    ) : null}
                  </div>
                  <PtButton
                    actionId={`find-people-action-${receiverPtid}`}
                    className={isPending || isFriend ? 'sc-find__action--done' : undefined}
                    data-chat-find-people-action={receiverPtid}
                    data-chat-find-people-action-state={
                      isFriend ? 'friend' : isPending ? 'pending' : 'available'
                    }
                    density="compact"
                    emphasis={isPending || isFriend ? 'secondary' : 'primary'}
                    execution={
                      addingId === receiverPtid
                      || (!friendshipReady && friendRequestsLoading)
                        ? 'pending'
                        : 'idle'
                    }
                    onActivate={(event) => {
                      event.stopPropagation();
                      void handleSendRequest(r);
                    }}
                    availability={
                      isPending || isSelf || isFriend || !friendshipReady
                        ? { kind: 'disabled', reason: actionLabel }
                        : undefined
                    }
                  >
                    {actionLabel}
                  </PtButton>
                </div>
              );
            })
          )}
        </div>
      </div>
    </Dialog>
  );
}
