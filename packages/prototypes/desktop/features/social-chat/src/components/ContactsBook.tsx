import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Collapse, Empty, Tag, theme, Typography } from 'antd';
import {
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Contact as ContactBookIcon,
  Copy,
  Inbox,
  MessageCircle,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { Avatar } from './Avatar';
import { RequestDecisionButtons } from './RequestDecisionButtons';
import {
  CONTACTS,
  INITIAL_FRIEND_REQUESTS,
  SAVED_GROUPS,
  type MockContactRequest,
  type MockSavedGroup,
  type FederatedFriendMeta,
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
  federated?: boolean;
}

interface ContactsBookProps {
  compact?: boolean;
  onOpenConversation: (conversationId: string) => void;
  onStartChatWithPerson: (name: string, peerId: string, meta?: FederatedFriendMeta) => void;
}

export function ContactsBook({ compact = false, onOpenConversation, onStartChatWithPerson }: ContactsBookProps) {
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
      federated: request.federated,
    }));

  const directoryPeers: FriendEntry[] = CONTACTS.map((contact) => ({
    id: contact.id,
    name: contact.name,
    identityKey: contact.id,
    federationName: contact.federationName,
    homeStation: contact.homeStation,
    handle: contact.federatedHandle,
    federated: contact.federated,
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
    <Flexbox gap={6}>
      {requests.map((request) => {
        const isSelected = selected?.kind === 'request' && selected.id === request.id;
        const pendingIncoming = request.direction === 'incoming' && request.status === 1;
        const statusColor = request.status === 1
          ? token.colorWarning
          : request.status === 2
            ? token.colorSuccess
            : token.colorTextTertiary;
        return (
          <Flexbox
            key={request.id}
            data-chat-friend-request-id={request.id}
            data-entity="friend-request"
            horizontal
            align="center"
            gap={9}
            role="button"
            tabIndex={0}
            aria-label={`${request.name} friend request`}
            onClick={() => setSelected({ kind: 'request', id: request.id })}
            onKeyDown={(event) => rowKeyboard(event, () => setSelected({ kind: 'request', id: request.id }))}
            style={{
              padding: '7px 9px',
              borderRadius: 10,
              border: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorFillQuaternary,
              cursor: 'pointer',
              minWidth: 0,
              ...(isSelected ? selectedRowStyle : null),
            }}
          >
            <Avatar
              identityKey={request.identityKey}
              name={request.name}
              initials={request.initials}
              size={34}
              federated={request.federated}
            />
            <Flexbox flex={1} style={{ minWidth: 0 }} gap={1}>
              <Text
                strong
                ellipsis
                style={{ display: 'block', fontSize: 13, lineHeight: 1.3 }}
              >
                {request.name}
              </Text>
              {request.message ? (
                <Text
                  type="secondary"
                  ellipsis
                  style={{ display: 'block', fontSize: 12, lineHeight: 1.35 }}
                >
                  {request.message}
                </Text>
              ) : null}
              <span
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  fontSize: 11, lineHeight: 1.4, color: token.colorTextTertiary,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                <span style={{ color: statusColor, fontWeight: 600 }}>{STATUS_META[request.status].label}</span>
                {request.direction === 'outgoing' ? <span>· sent</span> : null}
                {request.attempts > 1 ? <span>· {request.attempts} requests</span> : null}
              </span>
            </Flexbox>
            {pendingIncoming ? (
              <RequestDecisionButtons
                targetName={request.name}
                onAccept={() => setRequestStatus(request.id, 2)}
                onReject={() => setRequestStatus(request.id, 3)}
              />
            ) : null}
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
            onDoubleClick={() => onStartChatWithPerson(
              friend.name,
              friend.identityKey,
              friend.federated
                ? { federated: true, station: friend.homeStation, handle: friend.handle }
                : undefined,
            )}
            onKeyDown={(event) => rowKeyboard(event, select)}
            style={{
              ...rowBaseStyle,
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              ...(isSelected ? selectedRowStyle : null),
            }}
          >
            <Avatar identityKey={friend.identityKey} name={friend.name} initials={friend.initials} size={36} federated={friend.federated} />
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
          // Wide: fixed 320 rail. Narrow: share the row (46%, floored at 240)
          // so the detail pane never collapses its value column to 0 width.
          width: compact ? '46%' : 320,
          minWidth: compact ? 240 : 320,
          maxWidth: 320,
          flexShrink: 1,
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
        compact={compact}
        request={selectedRequest}
        friend={selectedFriend}
        group={selectedGroup}
        copiedKey={copiedKey}
        onCopy={copyValue}
        onMessagePerson={(name, peerId) => onStartChatWithPerson(
          name,
          peerId,
          selectedFriend?.federated
            ? { federated: true, station: selectedFriend.homeStation, handle: selectedFriend.handle }
            : undefined,
        )}
        onMessageGroup={(conversationId) => onOpenConversation(conversationId)}
      />
    </Flexbox>
  );
}

function DetailRow({ label, value, copyKey, copied, stack = false, onCopy }: {
  label: string;
  value: string;
  copyKey: string;
  copied: boolean;
  // Narrow panes stack label over value so the monospace column can never be
  // squeezed below one character per line.
  stack?: boolean;
  onCopy: (key: string, value: string) => void;
}) {
  return (
    <div style={{ padding: '7px 0', borderBottom: '1px solid rgba(0,0,0,0.05)', width: '100%', minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8, flexDirection: stack ? 'column' : 'row', alignItems: stack ? 'flex-start' : 'center', minWidth: 0 }}>
        <Text type="secondary" style={{ fontSize: 12, width: stack ? 'auto' : 118, flexShrink: 0 }}>{label}</Text>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Text
            title={value}
            style={{
              flex: 1, minWidth: 0, fontSize: 12, fontFamily: 'monospace',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {value}
          </Text>
          <button
            type="button"
            aria-label={`Copy ${label}`}
            title={`Copy ${label}`}
            onClick={() => onCopy(copyKey, value)}
            style={{
              width: 26, height: 26, flexShrink: 0, border: 'none', borderRadius: 6,
              background: 'transparent', color: copied ? '#38a169' : '#8c8c8c', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {copied ? <CheckCheck size={14} /> : <Copy size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}

function ContactsDetail({ compact = false, request, friend, group, copiedKey, onCopy, onMessagePerson, onMessageGroup }: {
  compact?: boolean;
  request: MockContactRequest | null;
  friend: FriendEntry | null;
  group: MockSavedGroup | null;
  copiedKey: string | null;
  onCopy: (key: string, value: string) => void;
  onMessagePerson: (name: string, peerId: string) => void;
  onMessageGroup: (conversationId: string) => void;
}) {
  const { token } = theme.useToken();
  // PTID / station / handle are low-frequency technical provenance: collapsed
  // by default (trust-state "On-demand detail"), never inline jargon.
  const [technicalOpen, setTechnicalOpen] = useState(false);
  // Profile background configured in Settings (same-origin storage).
  const [profileCover] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem('pt.profile.cover') ?? '';
  });

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
          stack={compact}
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
          stack={compact}
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
        stack={compact}
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
      style={{ background: token.colorBgLayout, padding: compact ? 16 : 32, overflow: 'auto', minWidth: 0 }}
    >
      <Flexbox
        align="center"
        gap={10}
        style={{
          width: 'min(380px, 100%)',
          minWidth: 0,
          boxSizing: 'border-box',
          padding: 0,
          overflow: 'hidden',
          background: token.colorBgContainer,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 14,
        }}
      >
        {/* Profile background (the banner seen on this person's details) */}
        <div
          data-contact-cover
          style={{
            width: '100%', height: 88, flexShrink: 0,
            background: profileCover
              ? `center / cover url("${profileCover}")`
              : `linear-gradient(120deg, ${token.colorPrimary} 0%, color-mix(in srgb, ${token.colorPrimary} 72%, white) 55%, color-mix(in srgb, ${token.colorPrimary} 42%, white) 100%)`,
          }}
        />
        <Flexbox align="center" gap={10} style={{ width: '100%', padding: `0 ${compact ? 20 : 28}px ${compact ? 20 : 24}px`, marginTop: -4 }}>
        {group ? (
          <Flexbox
            align="center"
            justify="center"
            style={{ position: 'relative', zIndex: 1, width: 72, height: 72, borderRadius: 14, background: token.colorFillSecondary, color: token.colorTextSecondary, boxShadow: '0 4px 14px rgba(15,23,42,0.16)', border: '4px solid #fff' }}
          >
            <Users size={34} />
          </Flexbox>
        ) : (
          <span style={{ position: 'relative', zIndex: 1, display: 'inline-flex', borderRadius: 14, boxShadow: '0 4px 14px rgba(15,23,42,0.16)', border: '4px solid #fff', lineHeight: 0, overflow: 'hidden' }}>
            <Avatar
              identityKey={request?.identityKey ?? friend?.identityKey ?? name}
              name={name}
              initials={request?.initials ?? friend?.initials}
              size={72}
              federated={Boolean(request?.federated ?? friend?.federated)}
            />
          </span>
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
        <div style={{ width: '100%', margin: '6px 0', minWidth: 0 }}>
          <button
            type="button"
            aria-expanded={technicalOpen}
            data-chat-contact-technical-toggle
            onClick={() => setTechnicalOpen((value) => !value)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 2px', border: 'none', background: 'transparent', cursor: 'pointer',
              color: token.colorTextSecondary, fontSize: 13, fontWeight: 600, textAlign: 'left',
            }}
          >
            <ShieldCheck size={16} color={token.colorTextTertiary} />
            <span style={{ flex: 1 }}>Identity & technical details</span>
            <ChevronDown
              size={15}
              style={{ transform: technicalOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}
            />
          </button>
          {technicalOpen ? (
            <div
              data-chat-contact-technical
              style={{
                padding: `2px 10px`,
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: 10,
                background: token.colorFillQuaternary,
                minWidth: 0,
              }}
            >
              {identityRows}
            </div>
          ) : null}
        </div>
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
    </Flexbox>
  );
}
