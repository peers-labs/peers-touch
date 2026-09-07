import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Input, toast } from '@lobehub/ui';
import { theme } from 'antd';
import { Search, X } from 'lucide-react';
import { peerOfSession, useSocialChatStore } from '../../store/socialChat';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { imServiceV1 } from '../../services/im-service';
import { log } from '../../utils/logger';
import { useActiveChatSessionSlice, useActiveSocialChatSlice } from './useActiveSocialChatStore';

interface Props {
  open: boolean;
  onClose: () => void;
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
  const {
    sessions,
    friendRequests,
    currentUserPtid,
    loadGroups,
    selectGroup,
    setActiveTab,
    getIMConversations,
    trackPendingGroupCreation,
  } = useActiveSocialChatSlice((s) => ({
    sessions: s.sessions,
    friendRequests: s.friendRequests,
    currentUserPtid: s.currentUserPtid,
    loadGroups: s.loadGroups,
    selectGroup: s.selectGroup,
    setActiveTab: s.setActiveTab,
    getIMConversations: s.getIMConversations,
    trackPendingGroupCreation: s.trackPendingGroupCreation,
  }));
  const sessionActorPtid = useActiveChatSessionSlice((s) => s.currentUser?.actorPtid ?? null);
  const ownDid = currentUserPtid || sessionActorPtid;

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
      if (conv.kind !== 'friend' || !conv.peerPtid || conv.peerPtid === ownDid || seen.has(conv.peerPtid)) continue;
      seen.set(conv.peerPtid, {
        did: conv.peerPtid,
        name: conv.title || t('chat.social.sessionList.unknown'),
        avatar: conv.avatar || '',
      });
    }

    for (const req of friendRequests) {
      if (req.status !== 2) continue;
      const isSender: boolean = req.senderPtid === ownDid;
      const peerId: string = isSender ? req.receiverPtid : req.senderPtid;
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

    const memberPtids = Array.from(selectedDids).filter((did) => did !== ownDid);
    if (memberPtids.length === 0) { setCreating(false); return; }

    const namesByDid = new Map(contacts.map((c) => [c.did, c.name]));
    const groupName =
      memberPtids.length <= 3
        ? memberPtids.map((d) => namesByDid.get(d) ?? d.slice(0, 8)).join(', ')
        : t('chat.social.createGroup.defaultName', { count: memberPtids.length + 1 });

    handleClose();

    const conversationId = crypto.randomUUID();
    useSocialChatStore.getState().setGroupSecurityState(conversationId, 'establishing');
    try {
      const created = await imServiceV1.messaging.createGroup(
        conversationId,
        groupName,
        memberPtids,
      );
      if (created.state === 'failed') {
        useSocialChatStore.getState().setGroupSecurityState(conversationId, 'error');
        toast.error(t('chat.social.createGroup.failed'));
        return;
      }
      trackPendingGroupCreation(conversationId, created.commandId);
      await loadGroups();
      const projectionReady = useSocialChatStore.getState().conversations.some(
        conversation => conversation.conversationId === conversationId,
      );
      if (!projectionReady) {
        toast.info({
          description: t('chat.social.encryption.establishing'),
          placement: 'top',
        });
        return;
      }
      setActiveTab('group');
      selectGroup(conversationId);
      toast.success({
        description: t('chat.social.createGroup.success'),
        placement: 'top',
      });
    } catch (err) {
      useSocialChatStore.getState().setGroupSecurityState(conversationId, 'error');
      log.error('chat', 'createGroup failed', { conversationId, error: err });
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
      data-chat-create-group
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-group-dialog-title"
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
              data-chat-create-group-search
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
                      <button
                        type="button"
                        key={contact.did}
                        data-chat-create-group-contact={contact.did}
                        aria-label={contact.name}
                        aria-pressed={selected}
                        onClick={() => toggleSelect(contact.did)}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '7px 16px',
                          border: 'none',
                          cursor: 'pointer',
                          background: selected ? token.colorFillQuaternary : 'transparent',
                          color: 'inherit',
                          font: 'inherit',
                          textAlign: 'left',
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
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right panel — selected + actions */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div
            id="create-group-dialog-title"
            style={{ padding: '20px 24px 0', fontSize: 15, fontWeight: 600, color: token.colorText }}
          >
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
              {t('common.action.cancel', { ns: 'common' })}
            </button>
            <button
              data-chat-create-group-submit
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
