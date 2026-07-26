import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Input, toast } from '@lobehub/ui';
import { Alert, Spin, Tag, theme, Modal, Typography } from 'antd';
import { Search, ShieldCheck, Globe, Server } from 'lucide-react';
import { api, type FederationResolveView, type FederationCatalogEntry } from '../../services/desktop_api';
import {
  useActiveChatFederationSlice,
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
  actorId: string;
  username: string;
  displayName: string;
  avatar: string;
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
    actorId: id,
    username,
    displayName,
    avatar,
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
    id: entry.actorId,
    actorId: entry.actorId,
    username: localPart,
    displayName: entry.displayName || localPart,
    avatar: entry.avatarUrl || '',
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
  const { sendFriendRequest } = useActiveSocialChatSlice((s) => ({
    sendFriendRequest: s.sendFriendRequest,
  }));
  const currentUserDid = useActiveSocialChatStore((s) => s.currentUserDid);
  const federationReady = useActiveChatFederationSlice(selectFederationReady);
  const federationSelf = useActiveChatFederationSlice((s) => s.self);
  const joinedFederations = federationSelf?.joinedFederations ?? [];

  const [searchText, setSearchText] = useState('');
  const [results, setResults] = useState<ActorSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<Set<string>>(() => new Set());
  const [searchScope, setSearchScope] = useState<SearchScope>('all');
  const [selectedFederationId, setSelectedFederationId] = useState<string>('');

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
          toast.error(t('chat.social.findPeople.resolveNotReady'));
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
          id: String(a.id ?? ''),
          actorId: String(a.actorId ?? a.actor_id ?? a.id ?? ''),
          username: String(a.username ?? ''),
          displayName: String(a.displayName ?? a.display_name ?? ''),
          avatar: String(a.avatar ?? ''),
        })),
      );
    } catch (e: unknown) {
      const fallback = parsed.isFederated && parsed.hasHost
        ? t('chat.social.findPeople.resolveFailed', { handle: parsed.canonical })
        : t('chat.social.findPeople.searchFailed');
      toast.error((e as { message?: string })?.message || fallback);
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleSendRequest = async (target: ActorSearchResult) => {
    if (addingId) return;
    const receiverDid = target.actorId || target.id;
    if (!receiverDid || receiverDid === currentUserDid) return;
    setAddingId(receiverDid);
    try {
      await sendFriendRequest(receiverDid, '');
      setSentIds((prev) => new Set(prev).add(receiverDid));
      toast.success(t('chat.social.findPeople.requestSent'));
    } catch (e: unknown) {
      toast.error(
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
      <Flexbox gap={12}>
        {!federationReady && (
          <Alert
            type="info"
            showIcon
            message={t('chat.social.findPeople.federationJoining')}
          />
        )}

        <Input
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
        <Flexbox horizontal gap={6} style={{ flexWrap: 'wrap' }}>
          <Tag.CheckableTag
            checked={searchScope === 'all'}
            onChange={() => handleScopeChange('all')}
          >
            {t('chat.social.findPeople.scopeAll')}
          </Tag.CheckableTag>

          {joinedFederations.map((fed) => (
            <Tag.CheckableTag
              key={fed.federationId}
              checked={searchScope === 'federation' && selectedFederationId === fed.federationId}
              onChange={(checked) => {
                if (checked) handleScopeChange('federation', fed.federationId);
                else handleScopeChange('all');
              }}
            >
              <Globe size={10} style={{ marginRight: 3, verticalAlign: -1 }} />
              {fed.federationName || fed.federationId.slice(0, 8)}
            </Tag.CheckableTag>
          ))}

          {joinedFederations.length === 0 && federationReady && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {t('chat.social.findPeople.catalogNoFederation')}
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
              const receiverDid = r.actorId || r.id;
              const alreadySent = sentIds.has(receiverDid);
              const isSelf = !!currentUserDid && receiverDid === currentUserDid;
              return (
                <Flexbox
                  key={receiverDid || r.id}
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
                    type="primary"
                    size="small"
                    loading={addingId === receiverDid}
                    disabled={alreadySent || isSelf}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleSendRequest(r);
                    }}
                  >
                    {isSelf
                      ? t('chat.social.findPeople.self')
                      : alreadySent
                        ? t('chat.social.findPeople.sent')
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
