import { useMemo, type CSSProperties } from 'react';
import { Button, Empty, Input, Spin, Typography } from 'antd';
import {
  ArrowLeft,
  FileText,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Send,
  Square,
  Users,
  X,
} from 'lucide-react';

import {
  type ChatSurfaceFixtureId,
} from '../../acceptance/chatSurfaceFixture';
import { useMobileI18n } from '../../app/mobileI18n';
import { MobileNotice } from '../../components/MobileNotice';
import type { ChatActionState } from '../../features/chat/chatActionState';
import type { ChatMessageCommandOutcome } from '../../features/chat/messageCommandState';
import type {
  PeerProfile,
  SocialMessage,
} from '../../features/social/socialTypes';
import { MemberRole } from '../../gen/proto/domain/chat/conversation_pb';
import type {
  MessagingConversationProjection,
  MessagingMemberAuthorityMemberProjection,
} from '../../services/mobileCommands';
import {
  ChatActionSheet,
  ChatDestructiveConfirmSheet,
  ForwardMessageSheet,
  GroupManagementModal,
  MessageActionSheet,
  type MessageForwardDestination,
} from './ChatOverlayHost';
import {
  MessageCommandStatus,
  MessageDeliveryStatus,
} from './ChatMessagePresentation';
import { ChatThreadPageContent } from './ChatPageContent';
import {
  chatInputPanelState,
  useChatBottomOcclusion,
} from './chatBottomOcclusion';
import type { ConversationSettingsFeedback } from './conversationSettingsState';

const { Text } = Typography;

const FIXTURE_ATTACHMENT_NAME = 'launch-checklist.pdf';
const FIXTURE_PEER_AVATAR = 'A';
const FIXTURE_SEARCH_RESULT = 'The revised launch checklist is ready.';
const FIXTURE_SELF_AVATAR = 'Y';

const LIST_SURFACES = new Set<ChatSurfaceFixtureId>([
  'chat.list',
  'chat.list-loading',
  'chat.list-empty',
  'chat.list-error',
  'chat.list-unavailable',
  'chat.list-search',
  'chat.list-search-empty',
]);

const OVERLAY_SURFACES = new Set<ChatSurfaceFixtureId>([
  'chat.message-actions',
  'chat.conversation-actions',
  'chat.conversation-settings-pending',
  'chat.conversation-settings-saved',
  'chat.conversation-settings-failed',
  'chat.destructive-confirm',
  'chat.forward-picker',
  'chat.forward-pending',
  'chat.forward-failed',
  'chat.group-management',
  'chat.group-role-denied',
]);

const FIXTURE_MESSAGE: SocialMessage = {
  ulid: 'message-planning',
  sessionUlid: 'acceptance-direct',
  senderPtid: 'member-self',
  receiverPtid: 'member-alice',
  type: 1,
  content: 'The revised launch checklist is ready for review.',
  status: 3,
  messagingState: 'read',
  createdAt: { seconds: Math.floor(Date.now() / 1000) - 90 },
};

const FIXTURE_DESTINATIONS: readonly MessageForwardDestination[] = [
  {
    key: 'direct-alice',
    conversationId: 'direct-alice',
    kind: 'friend',
    title: 'Alice Chen',
    subtitle: 'Direct conversation',
    avatar: '',
  },
  {
    key: 'group-design',
    conversationId: 'group-design',
    kind: 'group',
    title: 'Product Design',
    subtitle: 'Group conversation',
    avatar: '',
  },
];

const FIXTURE_GROUP: MessagingConversationProjection = {
  conversationId: 'acceptance-group',
  authorityStationId: 'station-team',
  federationId: 'federation-team',
  kind: 2,
  name: 'Product Design',
  description: 'Launch planning and design review',
  ownerPtid: 'member-self',
  memberPtids: ['member-self', 'member-alice', 'member-morgan'],
  members: [
    {
      ptid: 'member-self',
      role: MemberRole.OWNER,
      homeStationPeerId: 'station-team',
      muted: false,
    },
    {
      ptid: 'member-alice',
      role: MemberRole.ADMIN,
      homeStationPeerId: 'station-team',
      muted: false,
    },
    {
      ptid: 'member-morgan',
      role: MemberRole.MEMBER,
      homeStationPeerId: 'station-team',
      muted: true,
    },
  ],
  membershipEpoch: 3,
  mlsEpoch: 8,
  active: true,
  updatedAtUnixMs: Date.now(),
};

const FIXTURE_PROFILES = {
  'member-self': fixtureProfile('member-self', 'You', '@you'),
  'member-alice': fixtureProfile('member-alice', 'Alice Chen', '@alice'),
  'member-morgan': fixtureProfile('member-morgan', 'Morgan Lee', '@morgan'),
} as Record<string, PeerProfile>;

export function ChatAcceptanceSurface({
  surfaceId,
}: {
  readonly surfaceId: ChatSurfaceFixtureId;
}) {
  if (LIST_SURFACES.has(surfaceId)) {
    return <ChatFixtureList surfaceId={surfaceId} />;
  }
  if (OVERLAY_SURFACES.has(surfaceId)) {
    return <ChatFixtureOverlay surfaceId={surfaceId} />;
  }
  return <ChatFixtureThread surfaceId={surfaceId} />;
}

function ChatFixtureList({
  surfaceId,
}: {
  readonly surfaceId: ChatSurfaceFixtureId;
}) {
  const { t } = useMobileI18n();
  const query = surfaceId === 'chat.list-search'
    ? 'Alice'
    : surfaceId === 'chat.list-search-empty'
      ? 'Unknown person'
      : '';
  const showRows = ![
    'chat.list-loading',
    'chat.list-empty',
    'chat.list-search-empty',
  ].includes(surfaceId);

  return (
    <div
      className="page-container chat-acceptance-fixture"
      data-product-surface={surfaceId}
    >
      <header className="page-header">
        <h1 className="header-title">{t('mobile.chat.title')}</h1>
        <button
          type="button"
          className="header-action"
          aria-label={t('mobile.chat.moreActions')}
        >
          <Pencil size={20} />
        </button>
      </header>
      <div className="chat-search-bar">
        <Input
          data-chat-fixture-search
          prefix={<Search size={16} />}
          placeholder={t('mobile.chat.searchPlaceholder')}
          value={query}
          readOnly
          allowClear={false}
        />
      </div>
      {surfaceId === 'chat.list-error' ? (
        <MobileNotice>
          {t('mobile.chat.renderFailed')}
          <Button icon={<RotateCcw size={14} />}>
            {t('common.action.retry')}
          </Button>
        </MobileNotice>
      ) : null}
      {surfaceId === 'chat.list-unavailable' ? (
        <MobileNotice>
          {t('mobile.social.runtimeUnavailable')}
          <Button icon={<RotateCcw size={14} />}>
            {t('common.action.retry')}
          </Button>
        </MobileNotice>
      ) : null}
      <section className="social-list-panel chat-fixture-list-panel">
        {surfaceId === 'chat.list-loading' ? (
          <div className="chat-fixture-state" role="status">
            <Spin />
            <Text>{t('common.state.loading')}</Text>
          </div>
        ) : surfaceId === 'chat.list-empty' ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={(
              <div className="empty-copy">
                <Text strong>{t('mobile.chat.emptyTitle')}</Text>
                <Text type="secondary">{t('mobile.chat.emptySubtitle')}</Text>
              </div>
            )}
          />
        ) : surfaceId === 'chat.list-search-empty' ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t('mobile.chat.noSearchResults')}
          />
        ) : showRows ? (
          <div className="chat-fixture-conversations">
            <FixtureConversation
              name="Alice Chen"
              preview="The revised launch checklist is ready."
              time="10:42"
              online
            />
            <FixtureConversation
              name="Product Design"
              preview="Morgan: I added the final review notes."
              time="09:18"
              group
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}

function FixtureConversation({
  name,
  preview,
  time,
  online = false,
  group = false,
}: {
  readonly name: string;
  readonly preview: string;
  readonly time: string;
  readonly online?: boolean;
  readonly group?: boolean;
}) {
  return (
    <button type="button" className="conversation-item chat-fixture-conversation">
      <span className="conversation-avatar-frame chat-fixture-avatar">
        {name.slice(0, 1)}
        {online ? <span className="conversation-online-dot" aria-hidden="true" /> : null}
      </span>
      <span className="chat-fixture-conversation-copy">
        <span className="conversation-title-row">
          <Text strong>{name}</Text>
          {group ? <Users size={14} aria-hidden="true" /> : null}
        </span>
        <Text type="secondary">{preview}</Text>
      </span>
      <Text type="secondary">{time}</Text>
    </button>
  );
}

function ChatFixtureThread({
  surfaceId,
  overlayBackground = false,
}: {
  readonly surfaceId: ChatSurfaceFixtureId;
  readonly overlayBackground?: boolean;
}) {
  const { t } = useMobileI18n();
  const attachmentState = surfaceId.startsWith('chat.attachment-');
  const voiceState = surfaceId.startsWith('chat.voice-');
  const activePanel = chatInputPanelState({
    emojiOpen: false,
    attachmentOpen: attachmentState || voiceState,
  });
  const bottom = useChatBottomOcclusion({
    activePanel,
    tabBarVisible: false,
  });
  const style = useMemo<CSSProperties>(() => ({
    ...bottom.style,
    '--chat-message-bubble-max-width': '78%',
    '--chat-message-avatar-size': '38px',
    '--chat-message-avatar-gap': '7px',
    '--chat-scroll-bottom-clearance': '12px',
    '--chat-composer-min-height': '62px',
  }), [bottom.style]);
  const isGroup = surfaceId === 'chat.group-thread'
    || surfaceId === 'chat.group-management'
    || surfaceId === 'chat.group-role-denied';
  const title = isGroup ? 'Product Design' : 'Alice Chen';
  const isEmpty = surfaceId === 'chat.thread-empty';
  const isSearch = surfaceId.startsWith('chat.thread-search');
  const productSurface = overlayBackground
    || surfaceId === 'chat.composer-keyboard'
    ? undefined
    : surfaceId;
  const messageState = surfaceId === 'chat.message-pending'
    ? 'sending'
    : surfaceId === 'chat.message-failed'
      ? 'failed'
      : null;

  return (
    <ChatThreadPageContent
      activeInputPanel={bottom.activePanel}
      keyboardOverlapHeight={bottom.keyboardOverlapHeight}
      productSurface={productSurface}
      style={style}
      tabBarVisible={false}
    >
      <header className={`page-header chat-thread-header ${isSearch ? 'searching' : ''}`}>
        <button className="header-action" type="button" aria-label={t('common.action.back')}>
          <ArrowLeft size={20} />
        </button>
        {isSearch ? (
          <>
            <h1 className="chat-search-title">
              {t('mobile.chat.quickSearch')}
            </h1>
            <Input
              className="chat-header-search"
              prefix={<Search size={16} />}
              value={surfaceId === 'chat.thread-search-empty' ? 'Unavailable message' : 'launch'}
              readOnly
              aria-label={t('mobile.chat.searchMessagesPlaceholder')}
            />
            <button className="header-action" type="button" aria-label={t('common.action.cancel')}>
              <X size={18} />
            </button>
          </>
        ) : (
          <>
            <div className="header-title-stack">
              <h1 className="header-title compact">{title}</h1>
              <Text type="secondary">
                {isGroup
                  ? t('mobile.group.memberCount', { count: 3 })
                  : t('mobile.chat.peerAtStation', { station: 'home.peers' })}
              </Text>
            </div>
            <button
              className="header-action"
              type="button"
              aria-label={t('mobile.chat.moreActions')}
            >
              <MoreHorizontal size={20} />
            </button>
          </>
        )}
      </header>

      {surfaceId === 'chat.history-loading' ? (
        <div className="chat-fixture-inline-state" role="status">
          <Spin size="small" />
          <Text>{t('common.state.loading')}</Text>
        </div>
      ) : null}
      {surfaceId === 'chat.history-error' ? (
        <MobileNotice>
          {t('mobile.chat.operationThreadFailed')}
          <Button icon={<RotateCcw size={14} />}>
            {t('common.action.retry')}
          </Button>
        </MobileNotice>
      ) : null}
      {surfaceId === 'chat.thread-search-error' ? (
        <MobileNotice>
          {t('mobile.chat.searchFailed')}
          <Button icon={<RotateCcw size={14} />}>
            {t('common.action.retry')}
          </Button>
        </MobileNotice>
      ) : null}
      {isSearch ? (
        <section className="message-search-panel">
          {surfaceId === 'chat.thread-search-empty' ? (
            <Text type="secondary">{t('mobile.chat.noMessageResults')}</Text>
          ) : (
            <button type="button" className="message-search-result">
              <Text ellipsis>{FIXTURE_SEARCH_RESULT}</Text>
              <Text type="secondary">10:42</Text>
            </button>
          )}
        </section>
      ) : null}

      <section className="message-list chat-background-default" data-message-viewport>
        {isEmpty ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t('mobile.chat.emptyThread')}
          />
        ) : (
          <>
            <FixtureMessage mine={false} text="I added the final review notes." />
            <FixtureMessage
              mine
              text="The revised launch checklist is ready for review."
              deliveryState={messageState}
              uncertain={surfaceId === 'chat.message-uncertain'}
            />
          </>
        )}
      </section>

      <footer className="message-composer chat-fixture-composer">
        <div
          className="message-composer-input-panels"
          ref={bottom.inputPanelRef}
        >
          {attachmentState ? (
            <div className="message-composer-panel attachment-draft-panel">
              <div className="attachment-draft-chip">
                <FileText size={17} />
                <span>{FIXTURE_ATTACHMENT_NAME}</span>
                {surfaceId === 'chat.attachment-uploading' ? <Spin size="small" /> : null}
                {surfaceId === 'chat.attachment-failed' ? (
                  <button type="button" aria-label={t('common.action.retry')}>
                    <RotateCcw size={14} />
                  </button>
                ) : null}
                <button type="button" aria-label={t('common.action.delete')}>
                  <X size={14} />
                </button>
              </div>
              <Text type="secondary">
                {surfaceId === 'chat.attachment-uploading'
                  ? t('chat.social.messageArea.attachmentStateDownloading')
                  : surfaceId === 'chat.attachment-failed'
                    ? t('mobile.chat.attachmentUploadFailed')
                    : t('mobile.chat.attachmentMessage')}
              </Text>
            </div>
          ) : null}
          {surfaceId === 'chat.voice-recording' ? (
            <div className="message-composer-panel voice-recording-panel">
              <span className="voice-recording-status">
                <span className="voice-recording-dot" />
                <Text>{t('chat.social.composer.recording', { seconds: 8 })}</Text>
              </span>
              <Button icon={<Square size={14} />}>
                {t('chat.social.composer.finishRecord')}
              </Button>
            </div>
          ) : null}
          {surfaceId === 'chat.voice-failed' ? (
            <MobileNotice>
              {t('chat.social.composer.voiceSendFailed')}
              <Button icon={<RotateCcw size={14} />}>
                {t('common.action.retry')}
              </Button>
            </MobileNotice>
          ) : null}
        </div>
        <div className="message-composer-surface" ref={bottom.composerRef}>
          <span
            className="chat-keyboard-context"
            role="heading"
            aria-level={1}
          >
            {title}
          </span>
          <div className="message-composer-row">
            <button
              type="button"
              className="message-composer-tool"
              aria-label={t('mobile.chat.composerMore')}
            >
              <Paperclip size={18} />
            </button>
            <Input
              data-chat-fixture-composer
              data-product-surface={surfaceId === 'chat.composer-keyboard'
                ? 'chat.composer-keyboard'
                : undefined}
              className="message-composer-input"
              value={surfaceId === 'chat.composer-keyboard' ? 'Meet at 4 PM?' : ''}
              readOnly={surfaceId !== 'chat.composer-keyboard'}
              onChange={() => undefined}
              autoFocus={surfaceId === 'chat.composer-keyboard'}
              placeholder={t('mobile.chat.messagePlaceholder')}
            />
            <button
              type="button"
              className="message-composer-tool"
              aria-label={t('mobile.chat.composerMore')}
            >
              <Plus size={18} />
            </button>
            <Button
              className="message-send-button"
              type="primary"
              icon={<Send size={16} />}
              aria-label={t('common.action.send')}
            />
          </div>
        </div>
      </footer>
    </ChatThreadPageContent>
  );
}

function FixtureMessage({
  mine,
  text,
  deliveryState = null,
  uncertain = false,
}: {
  readonly mine: boolean;
  readonly text: string;
  readonly deliveryState?: 'sending' | 'failed' | null;
  readonly uncertain?: boolean;
}) {
  const commandOutcome: ChatMessageCommandOutcome = {
    commandId: 'command-fixture',
    conversationId: 'acceptance-direct',
    messageId: 'message-planning',
    kind: 'edit',
    state: 'uncertain',
  };
  return (
    <div className={`message-bubble-row ${mine ? 'mine' : 'peer'}`}>
      {!mine ? (
        <span className="message-avatar ant-avatar">{FIXTURE_PEER_AVATAR}</span>
      ) : null}
      <div className="message-bubble">
        <Text className="message-text">{text}</Text>
        <span className="message-meta attachment-only-meta message-meta-row">
          <span>10:42</span>
          {deliveryState ? (
            <MessageDeliveryStatus
              state={deliveryState}
              canRetry={deliveryState === 'failed'}
              onRetry={() => undefined}
            />
          ) : null}
          {uncertain ? <MessageCommandStatus outcome={commandOutcome} /> : null}
        </span>
      </div>
      {mine ? (
        <span className="message-avatar ant-avatar">{FIXTURE_SELF_AVATAR}</span>
      ) : null}
    </div>
  );
}

function ChatFixtureOverlay({
  surfaceId,
}: {
  readonly surfaceId: ChatSurfaceFixtureId;
}) {
  const { t } = useMobileI18n();
  const settingsFeedback = fixtureSettingsFeedback(surfaceId);
  const isGroupSurface = surfaceId === 'chat.group-management'
    || surfaceId === 'chat.group-role-denied';

  return (
    <>
      <ChatFixtureThread
        surfaceId={isGroupSurface ? 'chat.group-thread' : 'chat.direct-thread'}
        overlayBackground
      />
      <MessageActionSheet
        message={surfaceId === 'chat.message-actions' ? FIXTURE_MESSAGE : undefined}
        currentUserPtid="member-self"
        canEdit
        commandBusy={false}
        onClose={() => undefined}
        onReply={() => undefined}
        onForward={() => undefined}
        onOpenThread={() => undefined}
        onToggleReaction={() => undefined}
        onTogglePin={() => undefined}
        flagged={false}
        flagLabel={t('mobile.chat.flagOnDevice')}
        flagLoading={false}
        onToggleFlag={() => undefined}
        onEdit={() => undefined}
        onRecall={() => undefined}
        onHideForMe={() => undefined}
        canModerate={false}
        onModerate={() => undefined}
      />
      <ChatActionSheet
        open={surfaceId.startsWith('chat.conversation-')}
        state={FIXTURE_ACTION_STATE}
        onClose={() => undefined}
        onSearch={() => undefined}
        onToggleMute={() => undefined}
        onToggleSticky={() => undefined}
        onToggleAlert={() => undefined}
        onSelectBackground={() => undefined}
        onClearHistory={() => undefined}
        isFriendThread
        peerBlocked={false}
        onBlockPeer={() => undefined}
        onUnblockPeer={() => undefined}
        settingsFeedback={settingsFeedback}
        onRetrySettings={() => undefined}
      />
      <ChatDestructiveConfirmSheet
        open={surfaceId === 'chat.destructive-confirm'}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />
      <ForwardMessageSheet
        open={surfaceId.startsWith('chat.forward-')}
        destinations={FIXTURE_DESTINATIONS}
        pendingDestinationId={surfaceId === 'chat.forward-pending'
          ? 'direct-alice'
          : ''}
        error={surfaceId === 'chat.forward-failed'
          ? t('mobile.chat.operationForwardFailed')
          : ''}
        onClose={() => undefined}
        onSelect={() => undefined}
      />
      <GroupManagementModal
        open={isGroupSurface}
        onClose={() => undefined}
        conversation={FIXTURE_GROUP}
        members={FIXTURE_GROUP.members as readonly MessagingMemberAuthorityMemberProjection[]}
        myRole={surfaceId === 'chat.group-role-denied'
          ? MemberRole.MEMBER
          : MemberRole.OWNER}
        canManage={surfaceId !== 'chat.group-role-denied'}
        groupNameDraft={FIXTURE_GROUP.name}
        setGroupNameDraft={() => undefined}
        groupDescriptionDraft={FIXTURE_GROUP.description ?? ''}
        setGroupDescriptionDraft={() => undefined}
        conversationSettings={undefined}
        groupCommandOutcomes={{}}
        inviteCandidates={[]}
        peerProfiles={FIXTURE_PROFILES}
        currentUserPtid="member-self"
        onSaveGroup={async () => undefined}
        onUpdateMySettings={async () => undefined}
        onUpdateMemberRole={async () => undefined}
        onTransferOwnership={async () => undefined}
        onToggleMemberMuted={async () => undefined}
        onRemoveMember={async () => undefined}
        onInviteMember={async () => undefined}
        onDissolveGroup={async () => undefined}
        onLeaveGroup={async () => undefined}
      />
    </>
  );
}

const FIXTURE_ACTION_STATE: ChatActionState = {
  muted: false,
  sticky: true,
  alertEnabled: true,
  background: 'default',
};

function fixtureSettingsFeedback(
  surfaceId: ChatSurfaceFixtureId,
): ConversationSettingsFeedback {
  const phase = surfaceId === 'chat.conversation-settings-pending'
    ? 'pending'
    : surfaceId === 'chat.conversation-settings-saved'
      ? 'committed'
      : surfaceId === 'chat.conversation-settings-failed'
        ? 'failed'
        : 'idle';
  return {
    conversationKey: 'friend:acceptance-direct',
    phase,
    patch: phase === 'idle' ? null : { muted: true },
  };
}

function fixtureProfile(
  id: string,
  displayName: string,
  acct: string,
): PeerProfile {
  return {
    id,
    profileRevision: 1n,
    username: acct.slice(1),
    acct,
    displayName,
    note: '',
    url: '',
    avatar: '',
    header: '',
    locked: false,
    createdAt: '',
    statusesCount: 0,
    followingCount: 0,
    followersCount: 0,
    region: '',
    timezone: '',
    tags: [],
    links: [],
    defaultVisibility: 'private',
    manuallyApprovesFollowers: false,
    messagePermission: 'friends',
    autoExpireDays: 0,
    networkId: 'fixture-network',
    federatedHandle: acct,
    homeStationPeerId: 'station-team',
    homeStationDomain: 'home.peers',
    discoverability: 'by_handle',
  };
}
