import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Input } from '@lobehub/ui';
import { Alert, Spin, Tag, theme, Modal, Typography, message } from 'antd';
import { Search, ShieldCheck, Globe, Server } from 'lucide-react';
import { api, type FederationResolveView, type FederationCatalogEntry } from '../../services/desktop_api';
import {
  useActiveChatFederationSlice,
  useActiveChatRelationshipsSlice,
  useActiveSocialChatSlice,
  useActiveSocialChatStore,
} from './useActiveSocialChatStore';
import {
  selectFederationReady,
} from '../../store/federation';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { FederatedHandle } from '../FederatedHandle';

const { Text } = Typography;

interface ActorSearchResult {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  homeStationPeerId: string;
  federation?: {
    handle: string;
    homeStationDomain: string;
    fromCache: boolean;
    isLocal: boolean;
    locatorSeq: number;
  };
  homeStationName?: string;
}

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

function profileToResult(view: FederationResolveView): ActorSearchResult | null {
  const profile = view.profile;
  if (!profile) return null;
  const id = String(profile.id ?? '');
  const username = String(profile.username ?? '');
  const displayName = String(
    (profile as { displayName?: string }).displayName ??
      (profile as { display_name?: string }).display_name ??
      '',
  );
  const avatar = String(profile.avatar ?? '');
  return {
    id,
    username,
    displayName,
    avatar,
    homeStationPeerId: view.homeStationPeerId,
    federation: {
      handle: view.federatedHandle,
      homeStationDomain: view.homeStationDomain,
      fromCache: view.fromCache,
      isLocal: view.isLocal,
      locatorSeq: Number(view.locatorSeq ?? 0n),
    },
  };
}

function catalogEntryToResult(entry: FederationCatalogEntry): ActorSearchResult {
  const handle = entry.federatedHandle || '';
  const parts = handle.replace(/^@/, '').split('@');
  const localPart = parts[0] || '';
  const host = parts[1] || '';

  return {
    id: entry.actorPtid,
    username: localPart,
    displayName: entry.displayName || localPart,
    avatar: entry.avatarUrl || '',
    homeStationPeerId: entry.homeStationPeerId,
    federation: {
      handle,
      homeStationDomain: host,
      fromCache: false,
      isLocal: false,
      locatorSeq: 0,
    },
    homeStationName: entry.homeStationName,
  };
}

export function FindPeopleModal({ open, onClose }: Props) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const { sendFriendRequest, friendRequests } = useActiveSocialChatSlice((s) => ({
    sendFriendRequest: s.sendFriendRequest,
    friendRequests: s.friendRequests,
  }));
  const currentUserPtid = useActiveSocialChatStore((s) => s.currentUserPtid);
  const {
    mutualFriends,
    mutualFriendsActorPtid,
    mutualFriendsLoading,
    mutualFriendsLoadedAt,
    mutualFriendsError,
  } = useActiveChatRelationshipsSlice((s) => ({
    mutualFriends: s.mutualFriends,
    mutualFriendsActorPtid: s.mutualFriendsActorPtid,
    mutualFriendsLoading: s.mutualFriendsLoading,
    mutualFriendsLoadedAt: s.mutualFriendsLoadedAt,
    mutualFriendsError: s.mutualFriendsError,
  }));
  const federationReady = useActiveChatFederationSlice(selectFederationReady);
  const federations = useActiveChatFederationSlice((s) => s.federations);
  const joinedFederations = useMemo(
    () => federations.map((f) => ({ federationId: f.federationId, federationName: f.name })),
    [federations],
  );

  const [searchText, setSearchText] = useState('');
  const [results, setResults] = useState<ActorSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<Set<string>>(() => new Set());
  const sentTimestamps = useRef<Map<string, number>>(new Map());
  const [searchScope, setSearchScope] = useState<SearchScope>('all');
  const [selectedFederationId, setSelectedFederationId] = useState<string>('');

  const RESEND_COOLDOWN_MS = 5 * 60 * 1000;

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
    () => new Set(mutualFriends.map((friend) => friend.actorPtid)),
    [mutualFriends],
  );
  const friendshipReady = Boolean(
    currentUserPtid
    && mutualFriendsActorPtid === currentUserPtid
    && mutualFriendsLoadedAt,
  );

  const parsed = useMemo(() => parseHandleInput(searchText), [searchText]);
  const blockedByGate = parsed.isFederated && parsed.hasHost && !federationReady;

  const activeFederationId = useMemo(() => {
    if (searchScope === 'all') return '';
    if (selectedFederationId) return selectedFederationId;
    return joinedFederations[0]?.federationId ?? '';
  }, [searchScope, selectedFederationId, joinedFederations]);

  const handleSearch = async () => {
    const trimmed = searchText.trim();
    if (!trimmed) return;
    setSearching(true);
    try {
      if (parsed.isFederated && parsed.hasHost && searchScope === 'all') {
        if (!federationReady) {
          message.error(t('chat.social.findPeople.resolveNotReady'));
          setResults([]);
          return;
        }
        const view = await api.federationResolve(parsed.canonical);
        const item = profileToResult(view);
        setResults(item ? [item] : []);
        return;
      }

      if ((searchScope === 'federation' || searchScope === 'station') && activeFederationId) {
        const resp = await api.federationCatalogSearch({
          federation_id: activeFederationId,
          prefix: parsed.localPart || trimmed.replace(/^@/, ''),
          station_id: searchScope === 'station' ? undefined : undefined,
          page_size: 20,
        });
        setResults((resp.entries || []).map(catalogEntryToResult));
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
      const fallback = parsed.isFederated && parsed.hasHost
        ? t('chat.social.findPeople.resolveFailed', { handle: parsed.canonical })
        : t('chat.social.findPeople.searchFailed');
      message.error((e as { message?: string })?.message || fallback);
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleSendRequest = async (target: ActorSearchResult) => {
    if (addingId) return;
    const receiverPtid = target.id;
    if (!receiverPtid || receiverPtid === currentUserPtid) return;
    const federationId =
      activeFederationId || joinedFederations[0]?.federationId || '';
    if (!federationId || !target.homeStationPeerId) {
      message.error(t('chat.social.findPeople.catalogNoFederation'));
      return;
    }
    setAddingId(receiverPtid);
    try {
      await sendFriendRequest(
        receiverPtid,
        target.homeStationPeerId,
        federationId,
        '',
      );
      setSentIds((prev) => new Set(prev).add(receiverPtid));
      sentTimestamps.current.set(receiverPtid, Date.now());
      message.success(t('chat.social.findPeople.requestSent'));
    } catch (e: unknown) {
      message.error(
        (e as { message?: string })?.message ||
          t('chat.social.findPeople.addFailed'),
      );
    } finally {
      setAddingId(null);
    }
  };

  const handleClose = () => {
    setSearchText('');
    setResults([]);
    setSentIds(new Set());
    setSearchScope('all');
    setSelectedFederationId('');
    onClose();
  };

  const handleScopeChange = (scope: SearchScope, federationId?: string) => {
    setSearchScope(scope);
    if (federationId) setSelectedFederationId(federationId);
    else if (scope === 'all') setSelectedFederationId('');
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
          mutualFriendsError ? 'error' : friendshipReady ? 'ready' : 'loading'
        }
      >
        {!federationReady && (
          <Alert
            type="info"
            showIcon
            message={t('chat.social.findPeople.federationJoining')}
          />
        )}
        {mutualFriendsError && (
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
            checked={searchScope === 'all'}
            onChange={() => handleScopeChange('all')}
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

          {joinedFederations.map((fed) => {
            const isActive = searchScope === 'federation' && selectedFederationId === fed.federationId;
            return (
              <Tag.CheckableTag
                key={fed.federationId}
                checked={isActive}
                onChange={(checked) => {
                  if (checked) handleScopeChange('federation', fed.federationId);
                  else handleScopeChange('all');
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

          {joinedFederations.length === 0 && federationReady && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {t('chat.social.findPeople.catalogNoFederation')}
            </Text>
          )}

          {joinedFederations.length === 0 && !federationReady && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {t('chat.social.findPeople.joinFederation', { defaultValue: 'Join a federation to enable catalog search' })}
            </Text>
          )}
        </Flexbox>

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
              const isPending = pendingReceiverIds.has(receiverPtid) || sentIds.has(receiverPtid);
              const sentAt = sentTimestamps.current.get(receiverPtid);
              const cooldownActive = isPending && (!sentAt || Date.now() - sentAt < RESEND_COOLDOWN_MS);
              const isSelf = !!currentUserPtid && receiverPtid === currentUserPtid;
              const isFriend = friendPtidSet.has(receiverPtid);
              return (
                <Flexbox
                  key={receiverPtid || r.id}
                  data-chat-find-people-result={receiverPtid}
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
                  </Flexbox>
                  <Button
                    data-chat-find-people-action={receiverPtid}
                    type={cooldownActive || isFriend ? 'default' : 'primary'}
                    size="small"
                    loading={
                      addingId === receiverPtid
                      || (!friendshipReady && mutualFriendsLoading)
                    }
                    disabled={
                      cooldownActive
                      || isSelf
                      || isFriend
                      || !friendshipReady
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleSendRequest(r);
                    }}
                    style={cooldownActive || isFriend
                      ? { color: token.colorSuccess, borderColor: token.colorSuccess }
                      : undefined}
                  >
                    {isSelf
                      ? t('chat.social.findPeople.self')
                      : isFriend
                        ? t('chat.social.findPeople.alreadyFriend')
                      : !friendshipReady
                        ? t('chat.social.findPeople.checkingFriendship')
                      : cooldownActive
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
