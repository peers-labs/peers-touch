import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Input } from '@lobehub/ui';
import { Alert, Spin, Tag, theme, Modal, Tooltip, Typography, message } from 'antd';
import { Search, ShieldCheck, Globe, Server } from 'lucide-react';
import { api } from '../../services/desktop_api';
import {
  useActiveChatFederationSlice,
  useActiveSocialChatSlice,
  useActiveSocialChatStore,
} from './useActiveSocialChatStore';
import { singleFederationId } from '../../store/friendshipProjection';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { FederatedHandle } from '../FederatedHandle';
import {
  catalogEntryToSearchResult,
  findPeopleScopePresentation,
  friendRequestFederationId,
  localActorToSearchResult,
  mergeActorSearchResults,
  resolvedProfileToSearchResult,
  type ActorSearchResult,
} from './findPeopleIdentity';

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
}

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
  const { federations, rememberCatalogEntries } = useActiveChatFederationSlice((s) => ({
    federations: s.federations,
    rememberCatalogEntries: s.rememberCatalogEntries,
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
  const [selectedFederationId, setSelectedFederationId] = useState<string>('');
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
  const activeFederationId = selectedFederationId || defaultFederationId;
  const blockedByGate = parsed.isFederated && parsed.hasHost && !activeFederationId;

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
      const [localSearch, catalogSearch] = await Promise.all([
        api.actorSearchActors(query).catch((error: unknown) => {
          localSearchError = error;
          return null;
        }),
        activeFederationId
          ? api.federationCatalogSearch({
              federation_id: activeFederationId,
              prefix: query,
              page_size: 20,
            }).catch((error: unknown) => {
              catalogSearchError = error;
              return null;
            })
          : Promise.resolve(null),
      ]);

      if (!localSearch && !catalogSearch) {
        throw localSearchError || catalogSearchError || new Error('Search unavailable');
      }

      const localResults = (localSearch?.items ?? [])
        .map(localActorToSearchResult)
        .filter((item): item is ActorSearchResult => item !== null);
      const catalogEntries = catalogSearch?.entries ?? [];
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
    const federationId =
      activeFederationId
      || previousRequestFederationId
      || defaultFederationId;
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
      message.success(t('chat.social.findPeople.requestSent'));
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
    setSelectedFederationId('');
    setSearchError('');
    setRequestErrors({});
    onClose();
  };

  const handleScopeChange = (federationId: string) => {
    setSelectedFederationId(federationId);
    setSearchError('');
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
          {federationOptions.map((fed) => {
            const isActive = activeFederationId === fed.federationId;
            const presentation = findPeopleScopePresentation(
              'federation',
              fed.federationName,
              fed.federationId,
            );
            return (
              <Tooltip
                key={fed.federationId}
                title={t(presentation.tooltipKey, { name: presentation.name })}
              >
                <Tag.CheckableTag
                  aria-label={t(presentation.tooltipKey, { name: presentation.name })}
                  data-chat-find-people-scope="federation"
                  data-chat-find-people-federation-id={fed.federationId}
                  checked={isActive}
                  onChange={(checked) => {
                    if (checked) handleScopeChange(fed.federationId);
                    else handleScopeChange('');
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
                  {t(presentation.labelKey, { name: presentation.name })}
                </Tag.CheckableTag>
              </Tooltip>
            );
          })}

          {federationOptions.length === 0 && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {t('chat.social.findPeople.catalogNoFederation')}
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
                {parsed.isFederated && parsed.hasHost
                  ? t('chat.social.findPeople.resolving')
                  : t('chat.social.findPeople.catalogSearching')}
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
