import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@lobehub/ui';
import { Empty, List, Spin, Typography, theme } from 'antd';
import { Search } from 'lucide-react';
import type { DiscoveryUser } from '../../store/discovery';
import { UserProfileHeader } from '../../components/moments/UserProfileHeader';
import { useActiveDiscoverySlice } from '../../components/moments/useActiveMomentsStore';
import { SocialEmptyState } from '../../components/moments/surfaces';
import type { PostAuthor } from '../../gen/proto/domain/social/post_pb';

const { Text } = Typography;

// UserSearchView — type-ahead actor search.
//
// Debounce: 280ms — short enough that typing-and-pause feels
// instantaneous, long enough that holding a key doesn't fire 20
// requests. The `searchUsers` action drops late results via its
// own monotonic token so even a flaky network won't show stale
// matches under a fast typist.

interface UserSearchViewProps {
  viewerActorPtid?: string;
  onOpenUser: (actorPtid: string) => void;
}

function asPostAuthor(u: DiscoveryUser): PostAuthor {
  // The search hit's shape is JSON-from-StubPayload; UserProfileHeader
  // accepts the union of PostAuthor / Follower / Following so we
  // narrow down to the fields it actually reads.
  return {
    $typeName: 'peers_touch.model.social.v1.PostAuthor',
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatarUrl: u.avatar ?? '',
    isFollowing: false,
    homeStationDomain: u.homeStationDomain ?? '',
  } as PostAuthor;
}

export function UserSearchView({ viewerActorPtid, onOpenUser }: UserSearchViewProps) {
  const { t } = useTranslation('moments');
  const { token } = theme.useToken();
  const [text, setText] = useState('');
  const { query, results, searching, searchError, searchUsers } = useActiveDiscoverySlice((s) => ({
    query: s.query,
    results: s.results,
    searching: s.searching,
    searchError: s.searchError,
    searchUsers: s.searchUsers,
  }));
  const normalizedText = text.trim();
  const visibleResults = query === normalizedText ? results : [];

  useEffect(() => {
    const handle = setTimeout(() => {
      searchUsers(text);
    }, 280);
    return () => clearTimeout(handle);
  }, [text, searchUsers]);

  return (
    <div>
      <Input
        size="large"
        prefix={<Search size={16} />}
        placeholder={t('moments.search.placeholder')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        allowClear
        autoFocus
      />

      <div style={{ marginTop: 16 }}>
        {searching && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
            <Spin size="small" />
          </div>
        )}

        {!searching && !normalizedText && (
          <Empty description={<Text>{t('moments.placeholder.searchEmpty')}</Text>} />
        )}

        {!searching && normalizedText && searchError && query === normalizedText && (
          <SocialEmptyState
            compact
            kind="degraded"
            primaryAction={{
              label: t('moments.empty.try-again'),
              onClick: () => void searchUsers(normalizedText),
            }}
          />
        )}

        {!searching && normalizedText && !searchError && visibleResults.length === 0 && query === normalizedText && (
          <Empty description={<Text>{t('moments.placeholder.noResults')}</Text>} />
        )}

        {!searching && !searchError && visibleResults.length > 0 && (
          <List
            dataSource={visibleResults}
            renderItem={(u) => (
              <List.Item
                key={u.id}
                data-moments-search-result
                style={{ cursor: 'default' }}
              >
                <div style={{ width: '100%' }}>
                  <UserProfileHeader
                    actor={asPostAuthor(u)}
                    viewerActorPtid={viewerActorPtid}
                    inline
                    onAvatarClick={() => onOpenUser(u.id)}
                    avatarActionLabel={t('moments.search.openUserPosts', {
                      name: u.displayName || u.username,
                    })}
                  />
                  <Text
                    type="secondary"
                    style={{
                      display: 'block',
                      marginTop: 4,
                      marginLeft: 56,
                      fontSize: 12,
                      color: token.colorTextTertiary,
                    }}
                  >
                    {t('moments.search.avatarHint')}
                  </Text>
                </div>
              </List.Item>
            )}
          />
        )}
      </div>
    </div>
  );
}
