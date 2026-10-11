import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Collapse, Empty, Tag, theme, Typography } from 'antd';
import {
  Check,
  CheckCheck,
  ChevronRight,
  Contact as ContactBookIcon,
  Copy,
  Inbox,
  MessageCircle,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { Avatar } from './Avatar';
import {
  CONTACTS,
  INITIAL_FRIEND_REQUESTS,
  SAVED_GROUPS,
  type MockContactRequest,
  type MockSavedGroup,
} from '../mock';

const { Text } = Typography;

// Mirrors real apps/desktop ChatContactsPanel: 1 pending · 2 accepted · 3 rejected.
const STATUS_META: Record<MockContactRequest['status'], { label: string; color: string }> = {
  1: { label: 'Pending', color: 'blue' },
  2: { label: 'Accepted', color: 'green' },
  3: { label: 'Rejected', color: 'default' },
};

type Selection =
  | { kind: 'request'; id: string }
  | { kind: 'friend'; id: string }
  | { kind: 'group'; conversationId: string };

interface FriendEntry {
  id: string;
  name: string;
  initials?: string;
  identityKey: string;
  federationName?: string;
  homeStation?: string;
  handle?: string;
}

interface ContactsBookProps {
  onOpenConversation: (conversationId: string) => void;
  onStartChatWithPerson: (name: string, peerId: string) => void;
}

export function ContactsBook({ onOpenConversation, onStartChatWithPerson }: ContactsBookProps) {
  const { token } = theme.useToken();
  const [requests, setRequests] = useState<MockContactRequest[]>(INITIAL_FRIEND_REQUESTS);
  const [savedGroups] = useState<MockSavedGroup[]>(SAVED_GROUPS);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const acceptedPeers: FriendEntry[] = requests
    .filter((request) => request.status === 2)
    .map((request) => ({
      id: request.identityKey,
      name: request.name,
      initials: request.initials,
      identityKey: request.identityKey,
      federationName: request.federationName,
      homeStation: request.homeStation,
      handle: request.handle,
    }));

  const directoryPeers: FriendEntry[] = CONTACTS.map((contact) => ({
    id: contact.id,
    name: contact.name,
    identityKey: contact.id,
    federationName: contact.federationName,
    homeStation: contact.homeStation,
    handle: contact.federatedHandle,
  }));

  // Same-name contacts stay as distinct rows; the contact key is the PTID.
  const contacts = new Map<string, FriendEntry>();
  [...acceptedPeers, ...directoryPeers].forEach((peer) => {
    if (!contacts.has(peer.id)) contacts.set(peer.id, peer);
  });
  const friendList = [...contacts.values()];

  const selectedRequest = selected?.kind === 'request'
    ? requests.find((request) => request.id === selected.id) ?? null
    : null;
  const selectedFriend = selected?.kind === 'friend'
    ? friendList.find((peer) => peer.id === selected.id) ?? null
    : null;
  const selectedGroup = selected?.kind === 'group'
    ? savedGroups.find((group) => group.conversationId === selected.conversationId) ?? null
    : null;

  function setRequestStatus(id: string, status: MockContactRequest['status']) {
    setRequests((prev) => prev.map((request) => (
      request.id === id ? { ...request, status } : request
    )));
  }

  async function copyValue(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500);
    } catch {
      // Clipboard can be unavailable inside the framed prototype; selection still works.
    }
  }

  const selectedRowStyle: CSSProperties = {
    background: token.colorPrimaryBg,
    boxShadow: `inset 0 0 0 1px ${token.colorPrimaryBorder}`,
  };

  const rowBaseStyle: CSSProperties = {
    padding: '9px 10px',
    borderRadius: 10,
    cursor: 'pointer',
    transition: 'background 0.15s, box-shadow 0.15s',
    width: '100%',
    border: 'none',
    background: 'transparent',
    textAlign: 'left',
  };

  function rowKeyboard(event: KeyboardEvent<HTMLElement>, action: () => void) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    // Keydown bubbles from nested Accept/Reject buttons; their native
    // activation must not be replaced by the row's select action.
    if (event.target !== event.currentTarget
      && (event.target as HTMLElement).closest('button, a, input, [role="button"]')) {
      return;
    }
    event.preventDefault();
    action();
  }

  // ── New Friends ──────────────────────────────────────────────
  const newFriendsContent = requests.length === 0 ? (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No pending friend requests" />
  ) : (
    <Flexbox gap={8}>
      {requests.map((request) => {
        const isSelected = selected?.kind === 'request' && selected.id === request.id;
        const pendingIncoming = request.direction === 'incoming' && request.status === 1;
        return (
          <Flexbox
            key={request.id}
            data-chat-friend-request-id={request.id}
            horizontal
            align="flex-start"
            gap={10}
            role="button"
            tabIndex={0}
            aria-label={`${request.name} friend request`}
            onClick={() => setSelected({ kind: 'request', id: request.id })}
            onKeyDown={(event) => rowKeyboard(event, () => setSelected({ kind: 'request', id: request.id }))}
            style={{
              padding: 10,
              borderRadius: 8,
              border: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorFillQuaternary,
              cursor: 'pointer',
              ...(isSelected ? selectedRowStyle : null),
            }}
          >
            <Avatar identityKey={request.identityKey} name={request.name} initials={request.initials} size={36} />
            <Flexbox flex={1} style={{ minWidth: 0 }} gap={5}>
              <Text strong style={{ fontSize: 13, lineHeight: 1.35, overflowWrap: 'anywhere' }}>
                {request.name}
              </Text>
              {request.message ? (
                <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.4, overflowWrap: 'anywhere' }}>
                  {request.message}
                </Text>
              ) : null}
              <Flexbox horizontal align="center" gap={6} style={{ flexWrap: 'wrap' }}>
                <Tag color={request.direction === 'incoming' ? 'blue' : 'default'} style={{ marginInlineEnd: 0 }}>
                  {request.direction === 'incoming' ? 'Incoming' : 'Outgoing'}
                </Tag>
                <Tag color={STATUS_META[request.status].color} style={{ marginInlineEnd: 0 }}>
                  {STATUS_META[request.status].label}
                </Tag>
                <Tag style={{ marginInlineEnd: 0 }}>
                  {request.attempts} request attempt{request.attempts === 1 ? '' : 's'}
                </Tag>
              </Flexbox>
              {pendingIncoming ? (
                <Flexbox horizontal gap={6}>
                  <button
                    type="button"
                    data-chat-friend-request-action="accept"
                    aria-label={`Accept ${request.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setRequestStatus(request.id, 2);
                    }}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      height: 28, padding: '0 12px', border: 'none', borderRadius: 6,
                      background: token.colorPrimary, color: '#fff',
                      font: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    <Check size={12} />
                    Accept
                  </button>
                  <button
                    type="button"
                    data-chat-friend-request-action="reject"
                    aria-label={`Reject ${request.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setRequestStatus(request.id, 3);
                    }}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      height: 28, padding: '0 12px',
                      border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 6,
                      background: token.colorBgContainer, color: token.colorText,
                      font: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    <X size={12} />
                    Reject
                  </button>
                </Flexbox>
              ) : null}
            </Flexbox>
          </Flexbox>
        );
      })}
    </Flexbox>
  );

  // ── Saved Groups ─────────────────────────────────────────────
  const savedGroupsContent = savedGroups.length === 0 ? (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No groups yet" />
  ) : (
    <Flexbox gap={3} style={{ padding: '2px 0 4px' }}>
      {savedGroups.map((group) => {
        const isSelected = selected?.kind === 'group' && selected.conversationId === group.conversationId;
        const select = () => setSelected({ kind: 'group', conversationId: group.conversationId });
        return (
          <button
            key={group.conversationId}
            type="button"
            data-chat-saved-group={group.conversationId}
            onClick={select}
            onDoubleClick={() => onOpenConversation(group.conversationId)}
            onKeyDown={(event) => rowKeyboard(event, select)}
            style={{
              ...rowBaseStyle,
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              ...(isSelected ? selectedRowStyle : null),
            }}
          >
            <Avatar identityKey={group.name} name={group.name} groupIcon size={36} />
            <Flexbox flex={1} style={{ minWidth: 0 }}>
              <Text strong ellipsis style={{ display: 'block', fontSize: 13, color: isSelected ? token.colorPrimary : undefined }}>
                {group.name}
              </Text>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {group.memberCount} members
              </Text>
            </Flexbox>
            <ChevronRight size={14} color={isSelected ? token.colorPrimary : token.colorTextQuaternary} />
          </button>
        );
      })}
    </Flexbox>
  );

  // ── Contacts ─────────────────────────────────────────────────
  const contactsContent = friendList.length === 0 ? (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No contacts yet" />
  ) : (
    <Flexbox gap={3} style={{ padding: '2px 0 4px' }}>
      {friendList.map((friend) => {
        const isSelected = selected?.kind === 'friend' && selected.id === friend.id;
        const select = () => setSelected({ kind: 'friend', id: friend.id });
        return (
          <button
            key={friend.id}
            type="button"
            data-chat-contact-ptid={friend.identityKey}
            onClick={select}
            onDoubleClick={() => onStartChatWithPerson(friend.name, friend.identityKey)}
            onKeyDown={(event) => rowKeyboard(event, select)}
            style={{
              ...rowBaseStyle,
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              ...(isSelected ? selectedRowStyle : null),
            }}
          >
            <Avatar identityKey={friend.identityKey} name={friend.name} initials={friend.initials} size={36} />
            <Text
              strong
              ellipsis
              style={{ flex: 1, minWidth: 0, fontSize: 13, color: isSelected ? token.colorPrimary : undefined }}
            >
              {friend.name}
            </Text>
            <ChevronRight size={14} color={isSelected ? token.colorPrimary : token.colorTextQuaternary} />
          </button>
        );
      })}
    </Flexbox>
  );

  const sectionLabel = (icon: ReactNode, text: string) => (
    <Flexbox horizontal align="center" gap={8}>
      {icon}
      <Text strong style={{ fontSize: 13 }}>{text}</Text>
    </Flexbox>
  );

  const collapseItems = [
    {
      key: 'new-friends',
      label: sectionLabel(<UserPlus size={14} color={token.colorTextSecondary} />, `New Friends (${requests.length})`),
      children: newFriendsContent,
    },
    {
      key: 'saved-groups',
      label: sectionLabel(<Users size={14} color={token.colorTextSecondary} />, `Saved Groups (${savedGroups.length})`),
      children: savedGroupsContent,
    },
    {
      key: 'contacts',
      label: sectionLabel(<ContactBookIcon size={14} color={token.colorTextSecondary} />, `Contacts (${friendList.length})`),
      children: contactsContent,
    },
  ];

  return (
    <Flexbox horizontal flex={1} height="100%" style={{ minWidth: 0, background: token.colorBgContainer }}>
      <div
        data-chat-contacts
        style={{
          width: 320,
          minWidth: 320,
          height: '100%',
          borderRight: `1px solid ${token.colorBorderSecondary}`,
          overflow: 'hidden',
        }}
      >
        <div style={{ height: '100%', overflowY: 'auto', padding: '8px 6px' }}>
          <Collapse
            bordered={false}
            defaultActiveKey={['new-friends', 'contacts']}
            style={{ background: 'transparent' }}
            items={collapseItems}
          />
        </div>
      </div>
      <ContactsDetail
        request={selectedRequest}
        friend={selectedFriend}
        group={selectedGroup}
        copiedKey={copiedKey}
        onCopy={copyValue}
        onMessagePerson={(name, peerId) => onStartChatWithPerson(name, peerId)}
        onMessageGroup={(conversationId) => onOpenConversation(conversationId)}
      />
    </Flexbox>
  );
}

function DetailRow({ label, value, copyKey, copied, onCopy }: {
  label: string;
  value: string;
  copyKey: string;
  copied: boolean;
  onCopy: (key: string, value: string) => void;
}) {
  return (
    <Flexbox horizontal align="center" gap={8} style={{ padding: '7px 0', borderBottom: `1px solid rgba(0,0,0,0.05)` }}>
      <Text type="secondary" style={{ fontSize: 12, width: 118, flexShrink: 0 }}>{label}</Text>
      <Text style={{ fontSize: 12, flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontFamily: 'monospace' }}>
        {value}
      </Text>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        onClick={() => onCopy(copyKey, value)}
        style={{
          width: 26, height: 26, flexShrink: 0, border: 'none', borderRadius: 6,
          background: 'transparent', color: copied ? '#38a169' : '#8c8c8c', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {copied ? <CheckCheck size={14} /> : <Copy size={14} />}
      </button>
    </Flexbox>
  );
}

function ContactsDetail({ request, friend, group, copiedKey, onCopy, onMessagePerson, onMessageGroup }: {
  request: MockContactRequest | null;
  friend: FriendEntry | null;
  group: MockSavedGroup | null;
  copiedKey: string | null;
  onCopy: (key: string, value: string) => void;
  onMessagePerson: (name: string, peerId: string) => void;
  onMessageGroup: (conversationId: string) => void;
}) {
  const { token } = theme.useToken();

  if (!request && !friend && !group) {
    return (
      <Flexbox
        flex={1}
        align="center"
        justify="center"
        gap={12}
        style={{ background: token.colorBgLayout }}
      >
        <Inbox size={46} color={token.colorTextQuaternary} strokeWidth={1.4} />
        <Text type="secondary" style={{ fontSize: 13 }}>
          Select a contact or saved group to view details
        </Text>
      </Flexbox>
    );
  }

  const identityRows: ReactNode[] = [];
  if (request) {
    [
      ['Actor PTID', request.identityKey],
      ['Home Station', request.homeStation ?? ''],
      ['Federated handle', request.handle ?? ''],
      ['Federation', request.federationName ?? ''],
    ].filter(([, value]) => Boolean(value)).forEach(([label, value]) => {
      identityRows.push(
        <DetailRow
          key={label}
          label={label}
          value={value}
          copyKey={`request-${request.id}-${label}`}
          copied={copiedKey === `request-${request.id}-${label}`}
          onCopy={onCopy}
        />,
      );
    });
  } else if (friend) {
    [
      ['Actor PTID', friend.identityKey],
      ['Home Station', friend.homeStation ?? ''],
      ['Federated handle', friend.handle ?? ''],
      ['Federation', friend.federationName ?? ''],
    ].filter(([, value]) => Boolean(value)).forEach(([label, value]) => {
      identityRows.push(
        <DetailRow
          key={label}
          label={label}
          value={value}
          copyKey={`friend-${friend.id}-${label}`}
          copied={copiedKey === `friend-${friend.id}-${label}`}
          onCopy={onCopy}
        />,
      );
    });
  } else if (group) {
    identityRows.push(
      <DetailRow
        key="group-id"
        label="Group ID"
        value={group.conversationId}
        copyKey={`group-${group.conversationId}`}
        copied={copiedKey === `group-${group.conversationId}`}
        onCopy={onCopy}
      />,
    );
  }

  const name = request?.name ?? friend?.name ?? group?.name ?? '';
  const relationTag = request
    ? <Tag color={STATUS_META[request.status].color}>{STATUS_META[request.status].label}</Tag>
    : group
      ? <Tag>Group · {group.memberCount} members</Tag>
      : <Tag color="green">Friend</Tag>;

  const canMessage = Boolean(group) || (!request && Boolean(friend)) || request?.status === 2;

  return (
    <Flexbox
      flex={1}
      align="center"
      justify="center"
      style={{ background: token.colorBgLayout, padding: 32, overflow: 'auto' }}
    >
      <Flexbox
        align="center"
        gap={10}
        style={{
          width: 'min(380px, 100%)',
          padding: 28,
          background: token.colorBgContainer,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 14,
        }}
      >
        {group ? (
          <Flexbox
            align="center"
            justify="center"
            style={{ width: 72, height: 72, borderRadius: 18, background: token.colorFillSecondary, color: token.colorTextSecondary }}
          >
            <Users size={34} />
          </Flexbox>
        ) : (
          <Avatar
            identityKey={request?.identityKey ?? friend?.identityKey ?? name}
            name={name}
            initials={request?.initials ?? friend?.initials}
            size={72}
          />
        )}
        <Text strong style={{ fontSize: 17, textAlign: 'center', overflowWrap: 'anywhere' }}>{name}</Text>
        {relationTag}
        {request?.direction ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {request.direction === 'incoming' ? 'Incoming' : 'Outgoing'} request · {request.attempts} attempt{request.attempts === 1 ? '' : 's'}
          </Text>
        ) : null}
        {request?.message ? (
          <Text type="secondary" style={{ fontSize: 12, textAlign: 'center', overflowWrap: 'anywhere' }}>
            “{request.message}”
          </Text>
        ) : null}
        <div style={{ width: '100%', margin: '6px 0' }}>{identityRows}</div>
        {canMessage ? (
          <button
            type="button"
            data-chat-contact-message
            onClick={() => {
              if (group) onMessageGroup(group.conversationId);
              else onMessagePerson(name, request?.identityKey ?? friend?.identityKey ?? name);
            }}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              width: '100%', height: 40, border: 'none', borderRadius: 10,
              background: token.colorPrimary, color: '#fff',
              font: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <MessageCircle size={16} />
            Message
          </button>
        ) : null}
      </Flexbox>
    </Flexbox>
  );
}
