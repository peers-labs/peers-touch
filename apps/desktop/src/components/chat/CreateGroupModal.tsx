import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Input, toast } from '@lobehub/ui';
import { theme } from 'antd';
import { Search, X } from 'lucide-react';
import { peerOfSession } from '../../store/socialChat';
import { currentAuthenticatedActorId } from '../../store/session';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { api } from '../../services/desktop_api';
import { imServiceV1 } from '../../services/im-service';
import { MlsDeliveryKind } from '../../services/im-service-contract';
import { log } from '../../utils/logger';
import { useActiveChatSessionSlice, useActiveSocialChatSlice } from './useActiveSocialChatStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

async function setupMlsGroupSession(groupUlid: string): Promise<void> {
  const resp = await api.groupChatGetMembers(groupUlid);
  const selfDid = currentAuthenticatedActorId();
  const otherMembers = (resp?.members ?? []).filter((m) => m.ptid !== selfDid);
  if (otherMembers.length === 0) return;

  const memberKeyPackages: Uint8Array[] = [];
  for (const member of otherMembers) {
    const { data } = await imServiceV1.keyPackage.fetch(
      member.ptid,
      member.actorHomeStationPeerId || undefined,
    );
    if (data) memberKeyPackages.push(data);
  }
  if (memberKeyPackages.length === 0) return;
  const { welcomeBytes } = await imServiceV1.mlsGroup.createGroup(groupUlid, memberKeyPackages);
  await imServiceV1.mlsGroup.save(groupUlid);
  if (welcomeBytes.length > 0) {
    await imServiceV1.mlsGroup.distribute(groupUlid, MlsDeliveryKind.WELCOME, 0, welcomeBytes);
  }
}

interface Contact {
  did: string;
  name: string;
  avatar: string;
}

function getFirstLetter(name: string): string {
  if (!name) return '#';
  const first = name.trim().charAt(0).toUpperCase();
  if (/[A-Z]/.test(first)) return first;
  return '#';
}

export function CreateGroupModal({ open, onClose }: Props) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const { sessions, friendRequests, currentUserDid, loadGroups, selectGroup, setActiveTab, getIMConversations, loadFriendRequests, loadSessions } = useActiveSocialChatSlice((s) => ({
    sessions: s.sessions,
    friendRequests: s.friendRequests,
    currentUserDid: s.currentUserDid,
    loadGroups: s.loadGroups,
    selectGroup: s.selectGroup,
    setActiveTab: s.setActiveTab,
    getIMConversations: s.getIMConversations,
    loadFriendRequests: s.loadFriendRequests,
    loadSessions: s.loadSessions,
  }));
  const sessionActorId = useActiveChatSessionSlice((s) => s.currentUser?.actorId ?? null);
  const ownDid = currentUserDid || sessionActorId;

  useEffect(() => {
    if (open) {
      loadFriendRequests();
      loadSessions();
    }
  }, [open, loadFriendRequests, loadSessions]);

  const [searchText, setSearchText] = useState('');
  const [selectedDids, setSelectedDids] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  const contacts: Contact[] = useMemo(() => {
    if (!ownDid) return [];
    const seen = new Map<string, Contact>();

    for (const s of sessions) {
      const peer = peerOfSession(s, ownDid);
      if (!peer.did || peer.did === ownDid || seen.has(peer.did)) continue;
      seen.set(peer.did, {
        did: peer.did,
        name: peer.name || t('chat.social.sessionList.unknown'),
        avatar: peer.avatar,
      });
    }

    const conversations = getIMConversations();
    for (const conv of conversations) {
      if (conv.kind !== 'friend' || !conv.peerDid || conv.peerDid === ownDid || seen.has(conv.peerDid)) continue;
      seen.set(conv.peerDid, {
        did: conv.peerDid,
        name: conv.title || t('chat.social.sessionList.unknown'),
        avatar: conv.avatar || '',
      });
    }

    for (const req of friendRequests) {
      if (req.status !== 2) continue;
      const isSender: boolean = req.senderId === ownDid;
      const peerId: string = isSender ? req.receiverId : req.senderId;
      if (!peerId || peerId === ownDid || seen.has(peerId)) continue;
      const peerName: string = isSender ? req.receiverDisplayName : req.senderDisplayName;
      const peerAvatar: string = isSender ? req.receiverAvatar : req.senderAvatar;
      seen.set(peerId, {
        did: peerId,
        name: peerName || t('chat.social.sessionList.unknown'),
        avatar: peerAvatar || '',
      });
    }

    return Array.from(seen.values());
  }, [sessions, friendRequests, ownDid, t, getIMConversations]);

  const selectedContacts = useMemo(() => {
    return contacts.filter((c) => selectedDids.has(c.did));
  }, [contacts, selectedDids]);

  const filteredContacts = useMemo(() => {
    let result = contacts;
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      result = contacts.filter(
        (c) => c.name.toLowerCase().includes(q) || c.did.toLowerCase().includes(q),
      );
    }
    const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
    return [...result].sort((a, b) => {
      const letterA = getFirstLetter(a.name);
      const letterB = getFirstLetter(b.name);
      if (letterA === '#' && letterB !== '#') return 1;
      if (letterA !== '#' && letterB === '#') return -1;
      if (letterA !== letterB) return letterA.localeCompare(letterB);
      return collator.compare(a.name, b.name);
    });
  }, [contacts, searchText]);

  const groupedContacts = useMemo(() => {
    const groups = new Map<string, Contact[]>();
    for (const contact of filteredContacts) {
      const letter = getFirstLetter(contact.name);
      if (!groups.has(letter)) {
        groups.set(letter, []);
      }
      groups.get(letter)!.push(contact);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === '#' && b !== '#') return 1;
      if (a !== '#' && b === '#') return -1;
      return a.localeCompare(b);
    });
  }, [filteredContacts]);

  const toggleSelect = useCallback((did: string) => {
    setSelectedDids((prev) => {
      const next = new Set(prev);
      if (next.has(did)) {
        next.delete(did);
      } else {
        next.add(did);
      }
      return next;
    });
  }, []);

  const removeSelected = useCallback((did: string) => {
    setSelectedDids((prev) => {
      const next = new Set(prev);
      next.delete(did);
      return next;
    });
  }, []);

  const handleFinish = async () => {
    if (!ownDid) return;
    if (selectedDids.size === 0) return;
    setCreating(true);

    const memberDids = Array.from(selectedDids).filter((did) => did !== ownDid);
    if (memberDids.length === 0) { setCreating(false); return; }

    const namesByDid = new Map(contacts.map((c) => [c.did, c.name]));
    const groupName =
      memberDids.length <= 3
        ? memberDids.map((d) => namesByDid.get(d) ?? d.slice(0, 8)).join(', ')
        : t('chat.social.createGroup.defaultName', { count: memberDids.length + 1 });

    handleClose();

    try {
      const resp = await api.groupChatCreateGroup(groupName, '', memberDids);
      await loadGroups();
      await loadSessions();
      const newGroupUlid = resp?.group?.ulid;
      if (newGroupUlid) {
        setupMlsGroupSession(newGroupUlid).catch((err) =>
          log.warn('chat', 'MLS group setup failed (non-fatal)', err),
        );
        setActiveTab('group');
        selectGroup(newGroupUlid);
      }
      toast.success(t('chat.social.createGroup.success'));
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

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={handleClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.4)',
        }}
      />
      <div
        style={{
          position: 'relative',
          width: 640,
          height: '72vh',
          maxHeight: 580,
          background: token.colorBgContainer,
          borderRadius: 8,
          boxShadow: '0 8px 40px rgba(0,0,0,0.15)',
          display: 'flex',
          overflow: 'hidden',
        }}
      >
        {/* Left panel — contacts */}
        <div style={{ width: 300, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${token.colorBorderSecondary}` }}>
          <div style={{ padding: '16px 16px 12px' }}>
            <Input
              prefix={<Search size={14} style={{ color: token.colorTextQuaternary }} />}
              placeholder={t('chat.social.createGroup.searchContacts')}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              allowClear={{ clearIcon: <X size={12} /> }}
              style={{ borderRadius: 4, height: 32 }}
              styles={{ input: { fontSize: 13 } }}
            />
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filteredContacts.length === 0 ? (
              <Flexbox align="center" justify="center" style={{ padding: '40px 20px', height: '100%' }}>
                <span style={{ color: token.colorTextTertiary, fontSize: 13 }}>
                  {t('chat.social.createGroup.noContacts')}
                </span>
              </Flexbox>
            ) : (
              groupedContacts.map(([letter, items]) => (
                <div key={letter}>
                  <div
                    style={{
                      padding: '4px 16px',
                      fontSize: 11,
                      color: token.colorTextQuaternary,
                      fontWeight: 500,
                      position: 'sticky',
                      top: 0,
                      zIndex: 1,
                      background: token.colorBgContainer,
                    }}
                  >
                    {letter}
                  </div>
                  {items.map((contact) => {
                    const selected = selectedDids.has(contact.did);
                    return (
                      <div
                        key={contact.did}
                        onClick={() => toggleSelect(contact.did)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '7px 16px',
                          cursor: 'pointer',
                          background: selected ? token.colorFillQuaternary : 'transparent',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={(e) => {
                          if (!selected) e.currentTarget.style.background = token.colorFillTertiary;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = selected ? token.colorFillQuaternary : 'transparent';
                        }}
                      >
                        <div
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 9,
                            border: selected ? 'none' : `1.5px solid ${token.colorBorder}`,
                            background: selected ? '#07C160' : 'transparent',
                            flexShrink: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.12s ease',
                          }}
                        >
                          {selected && (
                            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                              <path d="M1 4L3.5 6.5L9 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </div>
                        <UserSquareAvatar
                          remoteUrl={contact.avatar}
                          name={contact.name}
                          size={34}
                          radius={4}
                        />
                        <span
                          style={{
                            fontSize: 13,
                            color: token.colorText,
                            flex: 1,
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {contact.name}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right panel — selected + actions */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '20px 24px 0', fontSize: 15, fontWeight: 600, color: token.colorText }}>
            {t('chat.social.createGroup.title')}
          </div>

          <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
            {selectedContacts.length === 0 ? (
              <Flexbox align="center" justify="center" style={{ height: '100%' }}>
                <span style={{ color: token.colorTextQuaternary, fontSize: 13 }}>
                  {t('chat.social.createGroup.selectHint')}
                </span>
              </Flexbox>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {selectedContacts.map((contact) => (
                  <div
                    key={contact.did}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 52, position: 'relative' }}
                  >
                    <div
                      onClick={() => removeSelected(contact.did)}
                      style={{ cursor: 'pointer' }}
                    >
                      <UserSquareAvatar
                        remoteUrl={contact.avatar}
                        name={contact.name}
                        size={42}
                        radius={4}
                      />
                    </div>
                    <span
                      style={{
                        fontSize: 10,
                        color: token.colorTextSecondary,
                        marginTop: 4,
                        maxWidth: 52,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        textAlign: 'center',
                      }}
                    >
                      {contact.name}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div
            style={{
              padding: '12px 24px 16px',
              borderTop: `1px solid ${token.colorBorderSecondary}`,
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 12,
            }}
          >
            <button
              onClick={handleClose}
              style={{
                padding: '6px 20px',
                fontSize: 13,
                border: `1px solid ${token.colorBorder}`,
                borderRadius: 4,
                background: token.colorBgContainer,
                color: token.colorText,
                cursor: 'pointer',
              }}
            >
              {t('common.action.cancel')}
            </button>
            <button
              onClick={handleFinish}
              disabled={selectedDids.size === 0 || creating}
              style={{
                padding: '6px 20px',
                fontSize: 13,
                border: 'none',
                borderRadius: 4,
                background: selectedDids.size > 0 ? '#07C160' : token.colorFillSecondary,
                color: selectedDids.size > 0 ? '#fff' : token.colorTextQuaternary,
                cursor: selectedDids.size > 0 ? 'pointer' : 'default',
                fontWeight: 500,
                opacity: creating ? 0.6 : 1,
              }}
            >
              {creating ? '...' : t('chat.social.createGroup.finish')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
