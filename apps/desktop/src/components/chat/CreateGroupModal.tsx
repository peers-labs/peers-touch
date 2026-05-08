import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Input } from '@lobehub/ui';
import { Empty, Modal, Typography, theme } from 'antd';
import { Check, Search, X } from 'lucide-react';

import { api } from '../../services/desktop_api';
import { peerOfSession, useSocialChatStore } from '../../store/socialChat';
import { log } from '../../utils/logger';
import { UserSquareAvatar } from '../common/UserSquareAvatar';

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultGroupName(contacts: Contact[], countLabel: string): string {
  if (contacts.length === 0) return '';
  if (contacts.length <= 3) {
    return contacts.map((contact) => contact.name || contact.did.slice(0, 8)).join(', ');
  }
  return countLabel;
}

export function CreateGroupModal({ open, onClose }: Props) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const {
    sessions,
    currentUserDid,
    loadGroups,
    selectGroup,
    setActiveTab,
  } = useSocialChatStore();

  const [searchText, setSearchText] = useState('');
  const [selectedDids, setSelectedDids] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState('');
  const [groupNameTouched, setGroupNameTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const contacts: Contact[] = useMemo(() => {
    const seen = new Map<string, Contact>();
    for (const session of sessions) {
      const peer = peerOfSession(session, currentUserDid);
      if (!peer.did) continue;
      if (currentUserDid && peer.did === currentUserDid) continue;
      if (seen.has(peer.did)) continue;
      seen.set(peer.did, {
        did: peer.did,
        name: peer.name || t('chat.social.sessionList.unknown'),
        avatar: peer.avatar,
      });
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [sessions, currentUserDid, t]);

  const selectedContacts = useMemo(
    () => contacts.filter((contact) => selectedDids.has(contact.did)),
    [contacts, selectedDids],
  );

  const filteredContacts = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return contacts;
    return contacts.filter((contact) => (
      contact.name.toLowerCase().includes(query) || contact.did.toLowerCase().includes(query)
    ));
  }, [contacts, searchText]);

  useEffect(() => {
    if (!open) return;
    const nextDefaultName = defaultGroupName(
      selectedContacts,
      t('chat.social.createGroup.defaultName', { count: selectedContacts.length + 1 }),
    );
    if (!groupNameTouched) {
      setGroupName(nextDefaultName);
    }
  }, [groupNameTouched, open, selectedContacts, t]);

  const toggleSelect = (did: string) => {
    setError(null);
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

  const removeSelected = (did: string) => {
    setSelectedDids((prev) => {
      const next = new Set(prev);
      next.delete(did);
      return next;
    });
  };

  const handleClose = () => {
    setSearchText('');
    setSelectedDids(new Set());
    setGroupName('');
    setGroupNameTouched(false);
    setCreating(false);
    setError(null);
    onClose();
  };

  const handleFinish = async () => {
    if (selectedDids.size < 2) return;
    const name = groupName.trim();
    if (!name) {
      setError(t('chat.social.createGroup.nameRequired', 'Group name is required'));
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const response = await api.groupChatCreateGroup(name, '', Array.from(selectedDids));
      await loadGroups();
      if (response.group?.ulid) {
        setActiveTab('group');
        selectGroup(response.group.ulid);
      }
      handleClose();
    } catch (err) {
      const message = errorMessage(err);
      log.error('chat', 'createGroup failed', err);
      setError(message || t('chat.social.createGroup.failed'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      title={t('chat.social.createGroup.title')}
      open={open}
      onCancel={handleClose}
      width={760}
      footer={[
        <Button key="cancel" onClick={handleClose}>{t('chat.social.createGroup.cancel')}</Button>,
        <Button
          key="finish"
          type="primary"
          disabled={selectedDids.size < 2 || creating}
          loading={creating}
          onClick={handleFinish}
        >
          {t('chat.social.createGroup.finish')}
        </Button>,
      ]}
      styles={{
        body: {
          height: 'min(520px, calc(100vh - 220px))',
          padding: 0,
          overflow: 'hidden',
        },
      }}
      destroyOnClose
    >
      <Flexbox style={{ height: '100%', minHeight: 0 }}>
        <Flexbox horizontal style={{ flex: 1, minHeight: 0 }}>
          <Flexbox
            gap={12}
            style={{
              width: 340,
              minWidth: 340,
              padding: 16,
              minHeight: 0,
            }}
          >
            <Input
              prefix={<Search size={14} style={{ color: token.colorTextQuaternary }} />}
              placeholder={t('chat.social.createGroup.searchContacts')}
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              allowClear
            />

            <Flexbox gap={4} style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              {filteredContacts.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t('chat.social.createGroup.noContacts')}
                  style={{ marginTop: 72 }}
                />
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
                        padding: '9px 10px',
                        borderRadius: 10,
                        cursor: 'pointer',
                        background: selected ? token.colorPrimaryBg : 'transparent',
                      }}
                    >
                      <Flexbox
                        align="center"
                        justify="center"
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 999,
                          border: selected ? 'none' : `2px solid ${token.colorBorder}`,
                          background: selected ? token.colorPrimary : token.colorBgContainer,
                          flexShrink: 0,
                        }}
                      >
                        {selected && <Check size={14} style={{ color: '#fff' }} />}
                      </Flexbox>
                      <UserSquareAvatar remoteUrl={contact.avatar} name={contact.name} size={36} />
                      <Flexbox style={{ minWidth: 0 }}>
                        <Text ellipsis style={{ fontSize: 13, fontWeight: 500 }}>
                          {contact.name}
                        </Text>
                        <Text ellipsis type="secondary" style={{ fontSize: 11 }}>
                          {contact.did}
                        </Text>
                      </Flexbox>
                    </Flexbox>
                  );
                })
              )}
            </Flexbox>
          </Flexbox>

          <Flexbox gap={14} style={{ flex: 1, padding: 16, minHeight: 0 }}>
            <Flexbox gap={6}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('chat.social.createGroup.groupName', 'Group name')}
              </Text>
              <Input
                value={groupName}
                placeholder={t('chat.social.createGroup.groupNamePlaceholder', 'Name this group')}
                onChange={(event) => {
                  setGroupNameTouched(true);
                  setGroupName(event.target.value);
                }}
              />
            </Flexbox>

            <Flexbox horizontal align="center" justify="space-between">
              <Text strong>
                {t('chat.social.createGroup.selectedCount', 'Selected {{count}}', {
                  count: selectedDids.size,
                })}
              </Text>
              <Text type={selectedDids.size >= 2 ? 'secondary' : 'danger'} style={{ fontSize: 12 }}>
                {t('chat.social.createGroup.minimumHint', 'Choose at least 2 contacts')}
              </Text>
            </Flexbox>

            <Flexbox gap={6} style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              {selectedContacts.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t('chat.social.createGroup.noSelected', 'No contacts selected')}
                  style={{ marginTop: 72 }}
                />
              ) : (
                selectedContacts.map((contact) => (
                  <Flexbox
                    key={contact.did}
                    horizontal
                    align="center"
                    gap={10}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 10,
                      background: token.colorFillTertiary,
                    }}
                  >
                    <UserSquareAvatar remoteUrl={contact.avatar} name={contact.name} size={34} />
                    <Text ellipsis style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                      {contact.name}
                    </Text>
                    <button
                      type="button"
                      aria-label={t('chat.social.createGroup.removeMember', 'Remove member')}
                      onClick={() => removeSelected(contact.did)}
                      style={{
                        appearance: 'none',
                        border: 0,
                        background: 'transparent',
                        color: token.colorTextTertiary,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        padding: 4,
                      }}
                    >
                      <X size={16} />
                    </button>
                  </Flexbox>
                ))
              )}
            </Flexbox>

            {error && (
              <Text type="danger" style={{ fontSize: 12 }}>
                {error}
              </Text>
            )}
          </Flexbox>
        </Flexbox>

      </Flexbox>
    </Modal>
  );
}
