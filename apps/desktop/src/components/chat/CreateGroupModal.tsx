import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Input, toast } from '@lobehub/ui';
import { theme } from 'antd';
import { Search, X, Check } from 'lucide-react';
import { peerOfSession } from '../../store/socialChat';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { api } from '../../services/desktop_api';
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
  const { sessions, currentUserDid, loadGroups, selectGroup, setActiveTab } = useActiveSocialChatSlice((s) => ({
    sessions: s.sessions,
    currentUserDid: s.currentUserDid,
    loadGroups: s.loadGroups,
    selectGroup: s.selectGroup,
    setActiveTab: s.setActiveTab,
  }));
  const sessionActorId = useActiveChatSessionSlice((s) => s.currentUser?.actorId ?? null);
  const ownDid = currentUserDid || sessionActorId;

  const [searchText, setSearchText] = useState('');
  const [selectedDids, setSelectedDids] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

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
    try {
      const memberDids = Array.from(selectedDids).filter((did) => did !== ownDid);
      if (memberDids.length === 0) return;
      const namesByDid = new Map(contacts.map((c) => [c.did, c.name]));
      const groupName =
        memberDids.length <= 3
          ? memberDids.map((d) => namesByDid.get(d) ?? d.slice(0, 8)).join(', ')
          : t('chat.social.createGroup.defaultName', { count: memberDids.length + 1 });
      const resp = await api.groupChatCreateGroup(groupName, '', memberDids);
      await loadGroups();
      const newGroupUlid = resp?.group?.ulid;
      if (newGroupUlid) {
        setActiveTab('group');
        selectGroup(newGroupUlid);
      }
      toast.success(t('chat.social.createGroup.success'));
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

  const WECHAT_GREEN = '#07C160';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: open ? 'auto' : 'none',
        opacity: open ? 1 : 0,
        transition: 'opacity 0.2s ease',
      }}
    >
      <div
        onClick={handleClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.45)',
        }}
      />
      <div
        style={{
          position: 'relative',
          width: 540,
          maxHeight: '80vh',
          background: token.colorBgContainer,
          borderRadius: 12,
          boxShadow: token.boxShadowSecondary,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '16px 20px 12px',
            borderBottom: selectedContacts.length > 0 ? `1px solid ${token.colorBorderSecondary}` : 'none',
          }}
        >
          <Input
            prefix={<Search size={16} style={{ color: token.colorTextTertiary }} />}
            placeholder={t('chat.social.createGroup.searchContacts')}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            allowClear={{ clearIcon: <X size={14} /> }}
            style={{
              borderRadius: 6,
            }}
            styles={{
              input: {
                fontSize: 14,
              },
            }}
          />
        </div>

        {selectedContacts.length > 0 && (
          <div
            style={{
              padding: '10px 16px',
              borderBottom: `1px solid ${token.colorBorderSecondary}`,
              display: 'flex',
              gap: 8,
              flexWrap: 'nowrap',
              overflowX: 'auto',
              minHeight: 56,
              alignItems: 'center',
            }}
          >
            {selectedContacts.map((contact) => (
              <div
                key={contact.did}
                onClick={() => removeSelected(contact.did)}
                style={{
                  position: 'relative',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                <UserSquareAvatar
                  remoteUrl={contact.avatar}
                  name={contact.name}
                  size={40}
                  radius={20}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -4,
                    width: 16,
                    height: 16,
                    borderRadius: 8,
                    background: 'rgba(0,0,0,0.55)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                  }}
                >
                  <X size={10} />
                </div>
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            minHeight: 200,
            maxHeight: 420,
          }}
        >
          {filteredContacts.length === 0 ? (
            <Flexbox
              align="center"
              justify="center"
              style={{ padding: '40px 20px', height: '100%' }}
            >
              <span style={{ color: token.colorTextTertiary, fontSize: 13 }}>
                {t('chat.social.createGroup.noContacts')}
              </span>
            </Flexbox>
          ) : (
            groupedContacts.map(([letter, items]) => (
              <div key={letter}>
                <div
                  style={{
                    padding: '6px 20px',
                    fontSize: 12,
                    color: token.colorTextTertiary,
                    background: token.colorFillQuaternary,
                    fontWeight: 500,
                    position: 'sticky',
                    top: 0,
                    zIndex: 1,
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
                        gap: 12,
                        padding: '9px 20px',
                        cursor: 'pointer',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = token.colorFillTertiary;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      <div
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 11,
                          border: selected ? 'none' : `2px solid ${token.colorBorder}`,
                          background: selected ? WECHAT_GREEN : 'transparent',
                          flexShrink: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {selected && <Check size={14} color="#fff" strokeWidth={3} />}
                      </div>
                      <UserSquareAvatar
                        remoteUrl={contact.avatar}
                        name={contact.name}
                        size={38}
                        radius={19}
                      />
                      <span
                        style={{
                          fontSize: 14,
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

        <div
          style={{
            padding: '12px 20px',
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Button
            type="text"
            onClick={handleClose}
            style={{
              fontSize: 14,
              color: token.colorTextSecondary,
              paddingInline: 8,
            }}
          >
            {t('chat.social.createGroup.cancel')}
          </Button>
          <button
            onClick={handleFinish}
            disabled={selectedDids.size === 0 || creating}
            style={{
              padding: '7px 20px',
              borderRadius: 6,
              border: 'none',
              background: selectedDids.size === 0 ? token.colorFillSecondary : WECHAT_GREEN,
              color: selectedDids.size === 0 ? token.colorTextDisabled : '#fff',
              fontSize: 14,
              fontWeight: 500,
              cursor: selectedDids.size === 0 ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
              fontFamily: 'inherit',
            }}
          >
            {creating
              ? t('chat.social.createGroup.finish')
              : selectedDids.size > 0
                ? `${t('chat.social.createGroup.finish')}(${selectedDids.size})`
                : t('chat.social.createGroup.finish')}
          </button>
        </div>
      </div>
    </div>
  );
}
