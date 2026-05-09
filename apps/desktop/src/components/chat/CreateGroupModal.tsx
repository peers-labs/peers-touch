import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Input, toast } from '@lobehub/ui';
import { theme, Modal, Typography } from 'antd';
import { Search, Check } from 'lucide-react';
import { peerOfSession, useSocialChatStore } from '../../store/socialChat';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { api } from '../../services/desktop_api';
import { log } from '../../utils/logger';
import { useSessionStore } from '../../store/session';

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Contact {
  did: string;
  name: string;
  avatar: string;
}

export function CreateGroupModal({ open, onClose }: Props) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const { sessions, currentUserDid, loadGroups } = useSocialChatStore();
  const sessionActorId = useSessionStore((s) => s.currentUser?.actorId ?? null);
  const ownDid = currentUserDid || sessionActorId;

  const [searchText, setSearchText] = useState('');
  const [selectedDids, setSelectedDids] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  // Resolve every friend session to "the other side" relative to the
  // current user. peerOfSession centralises the A/B selection so we
  // can never accidentally list ourselves as an invitable contact
  // (which is exactly what the previous `participantBDid`-as-name
  // implementation did when the viewer happened to be participant B).
  // De-dup by DID -- the same friend can appear in more than one
  // session row in some federated edge cases.
  const contacts: Contact[] = useMemo(() => {
    if (!ownDid) return [];
    const seen = new Map<string, Contact>();
    for (const s of sessions) {
      const peer = peerOfSession(s, ownDid);
      if (!peer.did) continue;
      if (peer.did === ownDid) continue;
      if (seen.has(peer.did)) continue;
      seen.set(peer.did, {
        did: peer.did,
        name: peer.name || t('chat.social.sessionList.unknown'),
        avatar: peer.avatar,
      });
    }
    return Array.from(seen.values());
  }, [sessions, ownDid, t]);

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
    if (!ownDid) return;
    if (selectedDids.size === 0) return;
    setCreating(true);
    try {
      const memberDids = Array.from(selectedDids).filter((did) => did !== ownDid);
      if (memberDids.length === 0) return;
      // Build a default group name from the *display names* of the
      // selected peers (not their raw DIDs, which used to bleed
      // 64-character ULID-like strings into the title). Fall back to
      // a short placeholder when peers have no display name yet.
      const namesByDid = new Map(contacts.map((c) => [c.did, c.name]));
      const groupName =
        memberDids.length <= 3
          ? memberDids.map((d) => namesByDid.get(d) ?? d.slice(0, 8)).join(', ')
          : t('chat.social.createGroup.defaultName', { count: memberDids.length + 1 });
      await api.groupChatCreateGroup(groupName, '', memberDids);
      await loadGroups();
      handleClose();
    } catch (err) {
      log.error('chat', 'createGroup failed', err);
      toast.error(t('chat.social.createGroup.failed'));
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
      title={t('chat.social.createGroup.title')}
      open={open}
      onCancel={handleClose}
      footer={
        <Flexbox horizontal justify="flex-end" gap={8}>
          <Button onClick={handleClose}>{t('chat.social.createGroup.cancel')}</Button>
          <Button
            type="primary"
            disabled={selectedDids.size === 0}
            loading={creating}
            onClick={handleFinish}
          >
            {t('chat.social.createGroup.finish')}
          </Button>
        </Flexbox>
      }
      width={420}
      destroyOnClose
    >
      <Flexbox gap={12}>
        <Input
          prefix={<Search size={14} style={{ color: token.colorTextQuaternary }} />}
          placeholder={t('chat.social.createGroup.searchContacts')}
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
              {t('chat.social.createGroup.noContacts')}
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
                  <UserSquareAvatar remoteUrl={contact.avatar} name={contact.name} size={32} />
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
