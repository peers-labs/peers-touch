import { useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Button, Input, Modal, Typography, theme } from 'antd';
import { Search } from 'lucide-react';
import { api } from '../../services/desktop_api';
import { useSocialChatStore } from '../../store/socialChat';

const { Text } = Typography;

function getInitial(name: string): string {
  if (!name) return '?';
  return name.charAt(0).toUpperCase();
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function FindPeopleModal({ open, onClose }: Props) {
  const { token } = theme.useToken();
  const { loadSessions, selectSession } = useSocialChatStore();

  const [searchText, setSearchText] = useState('');
  const [results, setResults] = useState<{ id: string; username: string; displayName: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!searchText.trim()) return;
    setSearching(true);
    try {
      const resp = await api.actorSearchActors(searchText.trim());
      setResults(resp.items.map((a) => ({
        id: a.id,
        username: a.username,
        displayName: a.displayName,
      })));
    } catch (e) {
      console.error('search failed', e);
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleAdd = async (username: string) => {
    setAddingId(username);
    try {
      const resp = await api.friendChatCreateSession(username);
      await loadSessions();
      if (resp.session) {
        selectSession(resp.session.ulid);
      }
      handleClose();
    } catch {
    } finally {
      setAddingId(null);
    }
  };

  const handleClose = () => {
    setSearchText('');
    setResults([]);
    onClose();
  };

  return (
    <Modal
      title="Find People"
      open={open}
      onCancel={handleClose}
      footer={null}
      width={420}
      destroyOnClose
    >
      <Flexbox gap={12}>
        <Input
          prefix={<Search size={14} style={{ color: token.colorTextQuaternary }} />}
          placeholder="Search by username..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          onPressEnter={handleSearch}
          allowClear
          suffix={
            <Button
              type="link"
              size="small"
              loading={searching}
              onClick={handleSearch}
              disabled={!searchText.trim()}
              style={{ padding: 0 }}
            >
              Search
            </Button>
          }
        />

        <Flexbox
          gap={2}
          style={{
            maxHeight: 320,
            overflow: 'auto',
          }}
        >
          {results.length === 0 ? (
            <Text type="secondary" style={{ textAlign: 'center', padding: 24, fontSize: 13 }}>
              {searchText ? 'No results found' : 'Enter a username to search'}
            </Text>
          ) : (
            results.map((r) => (
              <Flexbox
                key={r.id}
                horizontal
                align="center"
                gap={10}
                style={{
                  padding: '10px',
                  borderRadius: 8,
                }}
              >
                <Flexbox
                  align="center"
                  justify="center"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    background: token.colorFillSecondary,
                    color: token.colorTextSecondary,
                    fontSize: 14,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {getInitial(r.displayName || r.username)}
                </Flexbox>
                <Flexbox flex={1} style={{ minWidth: 0 }}>
                  <Text ellipsis style={{ fontSize: 13 }}>{r.displayName || r.username}</Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>@{r.username}</Text>
                </Flexbox>
                <Button
                  type="primary"
                  size="small"
                  loading={addingId === r.username}
                  onClick={() => handleAdd(r.username)}
                >
                  Add
                </Button>
              </Flexbox>
            ))
          )}
        </Flexbox>
      </Flexbox>
    </Modal>
  );
}
