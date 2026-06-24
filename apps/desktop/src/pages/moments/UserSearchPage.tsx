import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@lobehub/ui';
import { Empty, List, Spin, Typography } from 'antd';
import { Search } from 'lucide-react';
import { useDiscoveryStore, type DiscoveryUser } from '../../store/discovery';
import { UserProfileHeader } from '../../components/moments/UserProfileHeader';
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
  viewerActorId?: string;
  onOpenUser: (actorId: string) => void;
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

export function UserSearchView({ viewerActorId, onOpenUser }: UserSearchViewProps) {
  const { t } = useTranslation('moments');
  const [text, setText] = useState('');
  const query = useDiscoveryStore((s) => s.query);
  const results = useDiscoveryStore((s) => s.results);
  const searching = useDiscoveryStore((s) => s.searching);
  const searchUsers = useDiscoveryStore((s) => s.searchUsers);

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
            <Spin />
          </div>
        )}

        {!searching && !text.trim() && (
          <Empty description={<Text>{t('moments.placeholder.searchEmpty')}</Text>} />
        )}

        {!searching && text.trim() && results.length === 0 && query === text.trim() && (
          <Empty description={<Text>{t('moments.placeholder.noResults')}</Text>} />
        )}

        {!searching && results.length > 0 && (
          <List
            dataSource={results}
            renderItem={(u) => (
              <List.Item
                key={u.id}
                onClick={() => onOpenUser(u.id)}
                style={{ cursor: 'pointer' }}
              >
                <UserProfileHeader
                  actor={asPostAuthor(u)}
                  viewerActorId={viewerActorId}
                  inline
                />
              </List.Item>
            )}
          />
        )}
      </div>
    </div>
  );
}
