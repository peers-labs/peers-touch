import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Input } from '@lobehub/ui';
import { Alert, Spin, Tag, theme, Modal, Typography, message } from 'antd';
import { Search, ShieldCheck, Globe, Server } from 'lucide-react';
import {
  api,
  type MemberStationView,
} from '../../services/desktop_api';
import {
  useActiveChatFederationSlice,
  useActiveSocialChatSlice,
  useActiveSocialChatStore,
} from './useActiveSocialChatStore';
import {
  selectFederationReady,
} from '../../store/federation';
import { singleFederationId } from '../../store/friendshipProjection';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { FederatedHandle } from '../FederatedHandle';
import {
  catalogEntryToSearchResult,
  resolvedProfileToSearchResult,
  type ActorSearchResult,
} from './findPeopleIdentity';

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
}

type SearchScope = 'all' | 'federation' | 'station';

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
  const { token } = theme.useToken();
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
  const federationReady = useActiveChatFederationSlice(selectFederationReady);
  const { federations, listMemberStations } = useActiveChatFederationSlice((s) => ({
    federations: s.federations,
    listMemberStations: s.listMemberStations,
  }));
  const federationOptions = useMemo(
    () => federations.map((f) => ({ federationId: f.federationId, federationName: f.name })),
    [federations],
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
  const [memberStations, setMemberStations] = useState<MemberStationView[]>([]);
  const [selectedStationId, setSelectedStationId] = useState('');
  const [stationsLoading, setStationsLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [requestErrors, setRequestErrors] = useState<Record<string, string>>({});

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
  const blockedByGate = parsed.isFederated && parsed.hasHost && !federationReady;

  const activeFederationId = useMemo(() => {
    if (searchScope === 'all') return '';
    if (selectedFederationId) return selectedFederationId;
    return defaultFederationId;
  }, [defaultFederationId, searchScope, selectedFederationId]);

  const handleSearch = async () => {
    const trimmed = searchText.trim();
    if (!trimmed) return;
    setSearchError('');
    setSearching(true);
    try {
      if (parsed.isFederated && parsed.hasHost && searchScope === 'all') {
        if (!federationReady) {
          setSearchError(t('chat.social.findPeople.resolveNotReady'));
          return;
        }
        const view = await api.federationResolve(parsed.canonical);
        const item = resolvedProfileToSearchResult(view);
        setResults(item ? [item] : []);
        return;
      }

      if ((searchScope === 'federation' || searchScope === 'station') && activeFederationId) {
        // #region debug-point A-E:station-scoped-search-request
        void fetch('http://127.0.0.1:7780/event', {
          method: 'POST',
          body: JSON.stringify({
            sessionId: 'station-scoped-search',
            runId: 'post-fix',
            hypothesisId: 'A-E',
            location: 'FindPeopleModal.tsx:handleSearch:request',
            msg: '[DEBUG] Station-scoped search request',
            data: {
              searchScope,
              activeFederationId,
              selectedFederationId,
              selectedStationId,
              prefix: parsed.localPart || trimmed.replace(/^@/, ''),
            },
          }),
        }).catch(() => {});
        // #endregion
        const resp = await api.federationCatalogSearch({
          federation_id: activeFederationId,
          prefix: parsed.localPart || trimmed.replace(/^@/, ''),
          station_id: searchScope === 'station' ? selectedStationId : undefined,
          page_size: 20,
        });
        // #region debug-point A-E:station-scoped-search-response
        void fetch('http://127.0.0.1:7780/event', {
          method: 'POST',
          body: JSON.stringify({
            sessionId: 'station-scoped-search',
            runId: 'post-fix',
            hypothesisId: 'A-E',
            location: 'FindPeopleModal.tsx:handleSearch:response',
            msg: '[DEBUG] Station-scoped search response',
            data: {
              searchScope,
              activeFederationId,
              selectedStationId,
              entries: (resp.entries || []).map((entry) => ({
                actorPtid: entry.actorPtid,
                homeStationPeerId: entry.homeStationPeerId,
                visibility: entry.visibility,
              })),
            },
          }),
        }).catch(() => {});
        // #endregion
        setResults((resp.entries || []).map(catalogEntryToSearchResult));
        return;
      }

      const query = parsed.localPart || trimmed;
      const resp = await api.actorSearchActors(query);
      setResults(
        resp.items.map((a) => ({
          id: String(a.actorPtid ?? ''),
          username: String(a.username ?? ''),
          displayName: String(a.displayName ?? ''),
          avatar: String(a.avatar ?? ''),
          homeStationPeerId: String(a.homeStationPeerId ?? ''),
        })),
      );
    } catch (e: unknown) {
      // #region debug-point E:station-scoped-search-error
      void fetch('http://127.0.0.1:7780/event', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'station-scoped-search',
          runId: 'post-fix',
          hypothesisId: 'E',
          location: 'FindPeopleModal.tsx:handleSearch:error',
          msg: '[DEBUG] Find People search failed',
          data: {
            searchScope,
            activeFederationId,
            selectedStationId,
            error: e instanceof Error ? e.message : String(e),
          },
        }),
      }).catch(() => {});
      // #endregion
      const fallback = parsed.isFederated && parsed.hasHost
        ? t('chat.social.findPeople.resolveFailed', { handle: parsed.canonical })
        : t('chat.social.findPeople.searchFailed');
      setSearchError((e as { message?: string })?.message || fallback);
    } finally {
      setSearching(false);
    }
  };

  const handleSendRequest = async (target: ActorSearchResult) => {
    // #region debug-point B-D:friend-request-retry-handler-entry
    void fetch('http://127.0.0.1:7781/event', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 'friend-request-retry',
        runId: 'pre-fix',
        hypothesisId: 'B-D',
        location: 'FindPeopleModal.tsx:handleSendRequest:entry',
        msg: '[DEBUG] Friend request handler entered',
        data: {
          addingId,
          currentUserPtid,
          receiverPtid: target.id,
          receiverHomeStationPeerId: target.homeStationPeerId,
          activeFederationId,
          defaultFederationId,
          matchingRequests: friendRequests
            .filter((request) => (
              request.senderPtid === target.id
              || request.receiverPtid === target.id
            ))
            .map((request) => ({
              id: request.id,
              senderPtid: request.senderPtid,
              receiverPtid: request.receiverPtid,
              status: request.status,
            })),
        },
      }),
    }).catch(() => {});
    // #endregion
    if (addingId) return;
    const receiverPtid = target.id.trim();
    if (!receiverPtid) {
      setSearchError(t('chat.social.findPeople.requestIdentityUnavailable'));
      return;
    }
    if (receiverPtid === currentUserPtid) return;
    const federationId =
      activeFederationId || defaultFederationId;
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
      // #region debug-point B-D:friend-request-retry-dispatch
      void fetch('http://127.0.0.1:7781/event', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'friend-request-retry',
          runId: 'pre-fix',
          hypothesisId: 'B-D',
          location: 'FindPeopleModal.tsx:handleSendRequest:dispatch',
          msg: '[DEBUG] Dispatching friend request retry',
          data: {
            currentUserPtid,
            receiverPtid,
            receiverHomeStationPeerId: target.homeStationPeerId,
            federationId,
          },
        }),
      }).catch(() => {});
      // #endregion
      await sendFriendRequest(
        receiverPtid,
        target.homeStationPeerId,
        federationId,
        '',
      );
      // #region debug-point B-E:friend-request-retry-handler-success
      void fetch('http://127.0.0.1:7781/event', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'friend-request-retry',
          runId: 'pre-fix',
          hypothesisId: 'B-E',
          location: 'FindPeopleModal.tsx:handleSendRequest:success',
          msg: '[DEBUG] Friend request retry handler succeeded',
          data: { currentUserPtid, receiverPtid },
        }),
      }).catch(() => {});
      // #endregion
      message.success(t('chat.social.findPeople.requestSent'));
    } catch (e: unknown) {
      // #region debug-point A-B:friend-request-retry-handler-error
      void fetch('http://127.0.0.1:7781/event', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'friend-request-retry',
          runId: 'pre-fix',
          hypothesisId: 'A-B',
          location: 'FindPeopleModal.tsx:handleSendRequest:error',
          msg: '[DEBUG] Friend request retry handler failed',
          data: {
            currentUserPtid,
            receiverPtid,
            error: e instanceof Error ? e.message : String(e),
          },
        }),
      }).catch(() => {});
      // #endregion
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
    setMemberStations([]);
    setSelectedStationId('');
    setSearchError('');
    setRequestErrors({});
    onClose();
  };

  const handleScopeChange = async (
    scope: SearchScope,
    federationId?: string,
    stationId?: string,
  ) => {
    // #region debug-point B-C:station-scope-selection
    void fetch('http://127.0.0.1:7780/event', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 'station-scoped-search',
        runId: 'post-fix',
        hypothesisId: 'B-C',
        location: 'FindPeopleModal.tsx:handleScopeChange',
        msg: '[DEBUG] Find People scope selected',
        data: {
          nextScope: scope,
          federationId: federationId ?? '',
          stationId: stationId ?? '',
          previousFederationId: selectedFederationId,
          previousStationId: selectedStationId,
        },
      }),
    }).catch(() => {});
    // #endregion
    setSearchScope(scope);
    setSelectedStationId(stationId ?? '');
    setSearchError('');
    if (federationId) {
      setSelectedFederationId(federationId);
      if (federationId !== selectedFederationId || memberStations.length === 0) {
        setStationsLoading(true);
        try {
          setMemberStations(await listMemberStations(federationId));
        } catch (error) {
          setMemberStations([]);
          setSearchError(
            (error as { message?: string })?.message
              || t('chat.social.findPeople.stationListFailed'),
          );
        } finally {
          setStationsLoading(false);
        }
      }
    } else if (scope === 'all') {
      setSelectedFederationId('');
      setMemberStations([]);
    }
    setResults([]);
  };

  return (
    <Modal
      title={t('chat.social.findPeople.title')}
      open={open}
      onCancel={handleClose}
      footer={null}
      width={420}
      destroyOnHidden
    >
      <Flexbox
        gap={12}
        data-chat-find-people
        data-chat-friendship-state={
          friendRequestsError ? 'error' : friendshipReady ? 'ready' : 'loading'
        }
      >
        {!federationReady && (
          <Alert
            type="info"
            showIcon
            message={t('chat.social.findPeople.federationJoining')}
          />
        )}
        {friendRequestsError && (
          <Alert
            type="error"
            showIcon
            message={t('chat.social.findPeople.friendshipUnavailable')}
          />
        )}

        <Input
          data-chat-find-people-input
          prefix={<Search size={14} style={{ color: token.colorTextQuaternary }} />}
          placeholder={t('chat.social.findPeople.searchPlaceholderFederated')}
          value={searchText}
          onChange={(e) => {
            setSearchText(e.target.value);
            if (!e.target.value.trim()) setResults([]);
          }}
          onPressEnter={handleSearch}
          allowClear
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          suffix={
            <Button
              data-chat-find-people-search
              type="link"
              size="small"
              loading={searching}
              onClick={handleSearch}
              disabled={!searchText.trim() || blockedByGate}
              style={{ padding: 0 }}
            >
              {t('chat.social.findPeople.search')}
            </Button>
          }
        />

        {/* Scope chips */}
        <Flexbox horizontal gap={6} style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <Tag.CheckableTag
            data-chat-find-people-scope="all"
            checked={searchScope === 'all'}
            onChange={() => void handleScopeChange('all')}
            style={searchScope === 'all' ? {
              background: token.colorPrimaryBg,
              color: token.colorPrimary,
              borderColor: token.colorPrimary,
            } : {
              background: 'transparent',
              color: token.colorTextSecondary,
              borderColor: token.colorBorder,
            }}
          >
            {t('chat.social.findPeople.scopeAll')}
          </Tag.CheckableTag>

          {federationOptions.map((fed) => {
            const isActive = searchScope === 'federation' && selectedFederationId === fed.federationId;
            return (
              <Tag.CheckableTag
                data-chat-find-people-scope="federation"
                data-chat-find-people-federation-id={fed.federationId}
                key={fed.federationId}
                checked={isActive}
                onChange={(checked) => {
                  if (checked) void handleScopeChange('federation', fed.federationId);
                  else void handleScopeChange('all');
                }}
                style={isActive ? {
                  background: token.colorPrimaryBg,
                  color: token.colorPrimary,
                  borderColor: token.colorPrimary,
                } : {
                  background: 'transparent',
                  color: token.colorTextSecondary,
                  borderColor: token.colorBorder,
                }}
              >
                <Globe size={10} style={{ marginRight: 3, verticalAlign: -1 }} />
                {fed.federationName || fed.federationId.slice(0, 8)}
              </Tag.CheckableTag>
            );
          })}

          {stationsLoading ? <Spin size="small" /> : null}
          {selectedFederationId && memberStations.map((station) => {
            const isActive = searchScope === 'station'
              && selectedStationId === station.stationPeerId;
            return (
              <Tag.CheckableTag
                data-chat-find-people-scope="station"
                data-chat-find-people-station-id={station.stationPeerId}
                key={station.stationPeerId}
                checked={isActive}
                onChange={(checked) => {
                  if (checked) {
                    void handleScopeChange(
                      'station',
                      selectedFederationId,
                      station.stationPeerId,
                    );
                  } else {
                    void handleScopeChange('federation', selectedFederationId);
                  }
                }}
                style={isActive ? {
                  background: token.colorPrimaryBg,
                  color: token.colorPrimary,
                  borderColor: token.colorPrimary,
                } : {
                  background: 'transparent',
                  color: token.colorTextSecondary,
                  borderColor: token.colorBorder,
                }}
              >
                <Server size={10} style={{ marginRight: 3, verticalAlign: -1 }} />
                {station.stationName || station.stationPeerId.slice(0, 8)}
              </Tag.CheckableTag>
            );
          })}

          {federationOptions.length === 0 && federationReady && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {t('chat.social.findPeople.catalogNoFederation')}
            </Text>
          )}

          {federationOptions.length === 0 && !federationReady && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {t('chat.social.findPeople.joinFederation', { defaultValue: 'Join a federation to enable catalog search' })}
            </Text>
          )}
        </Flexbox>

        {searchError ? (
          <Alert
            data-chat-find-people-error
            type="error"
            showIcon
            message={searchError}
          />
        ) : null}

        <Flexbox
          gap={2}
          style={{
            maxHeight: 320,
            overflow: 'auto',
          }}
        >
          {searching ? (
            <Flexbox align="center" gap={8} style={{ padding: 24 }}>
              <Spin size="small" />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {searchScope !== 'all'
                  ? t('chat.social.findPeople.catalogSearching')
                  : parsed.isFederated && parsed.hasHost
                    ? t('chat.social.findPeople.resolving')
                    : undefined}
              </Text>
            </Flexbox>
          ) : results.length === 0 ? (
            <Text type="secondary" style={{ textAlign: 'center', padding: 24, fontSize: 13 }}>
              {searchText ? t('chat.social.findPeople.noResults') : t('chat.social.findPeople.hint')}
            </Text>
          ) : (
            results.map((r) => {
              const receiverPtid = r.id;
              const isPending = pendingReceiverIds.has(receiverPtid);
              const isSelf = !!currentUserPtid && receiverPtid === currentUserPtid;
              const isFriend = friendPtidSet.has(receiverPtid);
              const homeStation = r.federation?.homeStationDomain
                || r.homeStationName
                || r.homeStationPeerId;
              return (
                <Flexbox
                  key={receiverPtid || r.id}
                  data-chat-find-people-result={receiverPtid}
                  data-chat-find-people-handle={r.federation?.handle ?? ''}
                  data-chat-find-people-home-station={homeStation}
                  data-chat-find-people-home-station-peer-id={r.homeStationPeerId}
                  data-chat-find-people-home-station-domain={
                    r.federation?.homeStationDomain ?? ''
                  }
                  data-chat-friend-state={isFriend ? 'friend' : isPending ? 'pending' : 'none'}
                  horizontal
                  align="center"
                  gap={10}
                  style={{
                    padding: '10px',
                    borderRadius: 8,
                  }}
                >
                  <UserSquareAvatar
                    remoteUrl={r.avatar}
                    name={r.displayName || r.username}
                    size={36}
                  />
                  <Flexbox flex={1} style={{ minWidth: 0 }}>
                    <Flexbox horizontal align="center" gap={6}>
                      <Text ellipsis style={{ fontSize: 13 }}>
                        {r.displayName || r.username}
                      </Text>
                      {r.federation && (
                        <Tag
                          color="success"
                          icon={<ShieldCheck size={11} />}
                          style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 5px' }}
                        >
                          {t('chat.social.findPeople.tagVerified')}
                        </Tag>
                      )}
                      {r.federation?.fromCache && (
                        <Tag
                          style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 5px' }}
                        >
                          {t('chat.social.findPeople.tagFromCache')}
                        </Tag>
                      )}
                      {r.federation?.isLocal && (
                        <Tag
                          color="processing"
                          style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 5px' }}
                        >
                          {t('chat.social.findPeople.tagLocal')}
                        </Tag>
                      )}
                      {r.homeStationName && (
                        <Tag
                          icon={<Server size={10} />}
                          style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 5px' }}
                        >
                          {r.homeStationName}
                        </Tag>
                      )}
                    </Flexbox>
                    <FederatedHandle
                      localPart={r.username}
                      home={r.federation?.homeStationDomain}
                      fontSize={11}
                    />
                    <Text
                      data-chat-find-people-ptid
                      type="secondary"
                      ellipsis={{ tooltip: receiverPtid }}
                      style={{ fontSize: 10 }}
                    >
                      {receiverPtid}
                    </Text>
                    {homeStation && !r.federation?.homeStationDomain ? (
                      <Text
                        data-chat-find-people-station
                        type="secondary"
                        ellipsis={{ tooltip: homeStation }}
                        style={{ fontSize: 10 }}
                      >
                        {t('chat.social.identity.station', { station: homeStation })}
                      </Text>
                    ) : null}
                    {requestErrors[receiverPtid] ? (
                      <Alert
                        data-chat-find-people-request-error={receiverPtid}
                        type="error"
                        showIcon
                        message={requestErrors[receiverPtid]}
                      />
                    ) : null}
                  </Flexbox>
                  <Button
                    data-chat-find-people-action={receiverPtid}
                    data-chat-find-people-action-state={
                      isFriend ? 'friend' : isPending ? 'pending' : 'available'
                    }
                    type={isPending || isFriend ? 'default' : 'primary'}
                    size="small"
                    loading={
                      addingId === receiverPtid
                      || (!friendshipReady && friendRequestsLoading)
                    }
                    disabled={
                      isPending
                      || isSelf
                      || isFriend
                      || !friendshipReady
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      // #region debug-point B:friend-request-retry-click
                      void fetch('http://127.0.0.1:7781/event', {
                        method: 'POST',
                        body: JSON.stringify({
                          sessionId: 'friend-request-retry',
                          runId: 'pre-fix',
                          hypothesisId: 'B',
                          location: 'FindPeopleModal.tsx:findPeopleAction:onClick',
                          msg: '[DEBUG] Friend request action clicked',
                          data: {
                            currentUserPtid,
                            receiverPtid,
                            isPending,
                            isFriend,
                            isSelf,
                            friendshipReady,
                            addingId,
                          },
                        }),
                      }).catch(() => {});
                      // #endregion
                      void handleSendRequest(r);
                    }}
                    style={isPending || isFriend
                      ? { color: token.colorSuccess, borderColor: token.colorSuccess }
                      : undefined}
                  >
                    {isSelf
                      ? t('chat.social.findPeople.self')
                      : isFriend
                        ? t('chat.social.findPeople.alreadyFriend')
                      : !friendshipReady
                        ? t('chat.social.findPeople.checkingFriendship')
                      : isPending
                        ? t('chat.social.findPeople.awaitingApproval')
                        : t('chat.social.findPeople.sendRequest')}
                  </Button>
                </Flexbox>
              );
            })
          )}
        </Flexbox>
      </Flexbox>
    </Modal>
  );
}
