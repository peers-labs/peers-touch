import { useState, useMemo } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Button, Input } from '@lobehub/ui';
import { theme, Modal, Typography } from 'antd';
import { Search, Check } from 'lucide-react';
import { useSocialChatStore } from '../../store/socialChat';
import { api } from '../../services/desktop_api';
import type { FriendChatSession } from '../../gen/proto/domain/chat/friend_chat_pb';

const { Text } = Typography;

function getInitial(name: string): string {
  if (!name) return '?';
  return name.charAt(0).toUpperCase();
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CreateGroupModal({ open, onClose }: Props) {
  const { token } = theme.useToken();
  const { sessions, loadGroups } = useSocialChatStore();

  const [searchText, setSearchText] = useState('');
  const [selectedDids, setSelectedDids] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  const contacts: { did: string; name: string }[] = useMemo(() => {
    return sessions.map((s: FriendChatSession) => ({
      did: s.participantBDid,
      name: s.participantBDid || 'Unknown',
    }));
  }, [sessions]);

  const filteredContacts = useMemo(() => {
    if (!searchText.trim()) return contacts;
    const q = searchText.toLowerCase();
    return contacts.filter((c) => c.name.toLowerCase().includes(q) || c.did.toLowerCase().includes(q));
  }, [contacts, searchText]);

  const toggleSelect = (did: string) => {
    setSelectedDids((prev) => {
      const next = new Set(prev);
      if (next.has(did)) {
        next.delete(did);
      } else {
        next.add(did);
      }
      return next;
    });
  };

  const handleFinish = async () => {
    if (selectedDids.size === 0) return;
    setCreating(true);
    try {
      const memberDids = Array.from(selectedDids);
      const groupName = memberDids.length <= 3
        ? memberDids.map((d) => d.slice(0, 8)).join(', ')
        : `Group (${memberDids.length + 1})`;
      await api.groupChatCreateGroup(groupName, '', memberDids);
      await loadGroups();
      handleClose();
    } catch {
    } finally {
      setCreating(false);
    }
  };

  const handleClose = () => {
    setSearchText('');
    setSelectedDids(new Set());
    onClose();
  };

  return (
    <Modal
      title="Start Group Chat"
      open={open}
      onCancel={handleClose}
      footer={
        <Flexbox horizontal justify="flex-end" gap={8}>
          <Button onClick={handleClose}>Cancel</Button>
          <Button
            type="primary"
            disabled={selectedDids.size === 0}
            loading={creating}
            onClick={handleFinish}
          >
            Finish
          </Button>
        </Flexbox>
      }
      width={420}
      destroyOnClose
    >
      <Flexbox gap={12}>
        <Input
          prefix={<Search size={14} style={{ color: token.colorTextQuaternary }} />}
          placeholder="Search contacts..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
        />

        <Flexbox
          gap={2}
          style={{
            maxHeight: 320,
            overflow: 'auto',
          }}
        >
          {filteredContacts.length === 0 ? (
            <Text type="secondary" style={{ textAlign: 'center', padding: 24, fontSize: 13 }}>
              No contacts found
            </Text>
          ) : (
            filteredContacts.map((contact) => {
              const selected = selectedDids.has(contact.did);
              return (
                <Flexbox
                  key={contact.did}
                  horizontal
                  align="center"
                  gap={10}
                  onClick={() => toggleSelect(contact.did)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                >
                  <Flexbox
                    align="center"
                    justify="center"
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      border: selected ? 'none' : `2px solid ${token.colorBorder}`,
                      background: selected ? token.colorPrimary : 'transparent',
                      flexShrink: 0,
                      transition: 'all 0.15s',
                    }}
                  >
                    {selected && <Check size={14} style={{ color: '#fff' }} />}
                  </Flexbox>
                  <Flexbox
                    align="center"
                    justify="center"
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      background: token.colorFillSecondary,
                      color: token.colorTextSecondary,
                      fontSize: 13,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {getInitial(contact.name)}
                  </Flexbox>
                  <Text ellipsis style={{ fontSize: 13, flex: 1, minWidth: 0 }}>
                    {contact.name}
                  </Text>
                </Flexbox>
              );
            })
          )}
        </Flexbox>
      </Flexbox>
    </Modal>
  );
}
