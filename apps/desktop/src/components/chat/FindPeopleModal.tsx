import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Input, toast } from '@lobehub/ui';
import { theme, Modal, Typography } from 'antd';
import { Search } from 'lucide-react';
import { api } from '../../services/desktop_api';
import { useSocialChatStore } from '../../store/socialChat';
import { UserSquareAvatar } from '../common/UserSquareAvatar';

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
}

export function FindPeopleModal({ open, onClose }: Props) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const { sendFriendRequest } = useSocialChatStore();

  const [searchText, setSearchText] = useState('');
  const [results, setResults] = useState<{ id: string; username: string; displayName: string; avatar: string }[]>([]);
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
        avatar: a.avatar || '',
      })));
    } catch (e: any) {
      toast.error(e?.message || t('chat.social.findPeople.searchFailed'));
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleSendRequest = async (did: string) => {
    if (addingId) return;
    setAddingId(did);
    try {
      await sendFriendRequest(did, '');
      toast.success(t('chat.social.findPeople.requestSent'));
    } catch (e: any) {
      toast.error(e?.message || t('chat.social.findPeople.addFailed'));
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
      title={t('chat.social.findPeople.title')}
      open={open}
      onCancel={handleClose}
      footer={null}
      width={420}
      destroyOnClose
    >
      <Flexbox gap={12}>
        <Input
          prefix={<Search size={14} style={{ color: token.colorTextQuaternary }} />}
          placeholder={t('chat.social.findPeople.searchPlaceholder')}
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
              disabled={!searchText.trim()}
              style={{ padding: 0 }}
            >
              {t('chat.social.findPeople.search')}
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
              {searchText ? t('chat.social.findPeople.noResults') : t('chat.social.findPeople.hint')}
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
                {/* Unified rounded-square avatar for consistent visual style */}
                <UserSquareAvatar
                  remoteUrl={r.avatar}
                  name={r.displayName || r.username}
                  size={36}
                />
                <Flexbox flex={1} style={{ minWidth: 0 }}>
                  <Text ellipsis style={{ fontSize: 13 }}>{r.displayName || r.username}</Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>@{r.username}</Text>
                </Flexbox>
                <Button
                  type="primary"
                  size="small"
                  loading={addingId === r.id}
                  onClick={() => handleSendRequest(r.id)}
                >
                  {t('chat.social.findPeople.sendRequest')}
                </Button>
              </Flexbox>
            ))
          )}
        </Flexbox>
      </Flexbox>
    </Modal>
  );
}
