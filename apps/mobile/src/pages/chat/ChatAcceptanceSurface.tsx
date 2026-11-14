import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Button, Empty, Icon, IconButton, Spin, Text, TextField } from '@peers-touch/ui';

import {
  type ChatSurfaceFixtureId,
} from '../../acceptance/chatSurfaceFixture';
import { useMobileI18n } from '../../app/mobileI18n';
import { MobileAvatar } from '../../components/MobileAvatar';
import { MobileNotice } from '../../components/MobileNotice';
import { SearchKind, SearchZone } from '../../gen/proto/domain/search/search_pb';
import { MobileSearchResult } from '../MobileSearchResult';
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
  AttachmentDraftChip,
  ChatMessageSelectionToolbar,
} from './ChatMessagePresentation';
import { ChatThreadPageContent } from './ChatPageContent';
import {
  chatInputPanelState,
  useChatBottomOcclusion,
} from './chatBottomOcclusion';
import type { ConversationSettingsFeedback } from './conversationSettingsState';
import { MobileChatComposer } from './MobileChatComposer';
import { MobileGroupCallInvitationView, MobileGroupCallView } from '../../components/call/MobileGroupCallSurface';
import { createIdleSnapshot, type GroupCallSnapshot } from '@peers-touch/client-chat-core/group-call';
import { setChatSurfaceFixture } from '../../acceptance/chatSurfaceFixture';

const FIXTURE_ATTACHMENT_NAME = 'launch-checklist.pdf';
const FIXTURE_PEER_AVATAR = 'A';
const FIXTURE_SEARCH_RESULT = 'The revised launch checklist is ready.';
const FIXTURE_SELF_AVATAR = 'Y';

/** One-second PCM tone served by the app, consistent with its self-only media CSP.
 * Generate with scripts/generate-fixture-audio.py. Not recording/delivery proof. */
const FIXTURE_VOICE_PREVIEW_URL = '/acceptance-voice-preview.wav';

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
  listHeader,
}: {
  readonly surfaceId: ChatSurfaceFixtureId;
  readonly listHeader?: ReactNode;
}) {
  if (LIST_SURFACES.has(surfaceId)) {
    return <ChatFixtureList surfaceId={surfaceId} listHeader={listHeader} />;
  }
  if (OVERLAY_SURFACES.has(surfaceId)) {
    return <ChatFixtureOverlay surfaceId={surfaceId} />;
  }
  if (surfaceId.startsWith('chat.group-call-')) return <ChatGroupCallFixture key={surfaceId} surfaceId={surfaceId} />;
  return <ChatFixtureThread surfaceId={surfaceId} />;
}

function ChatGroupCallFixture({ surfaceId }: { surfaceId: ChatSurfaceFixtureId }) {
  const close = () => { setChatSurfaceFixture('chat.group-thread'); };
  const [snapshot, setSnapshot] = useState<GroupCallSnapshot>(() => {
    const state = surfaceId === 'chat.group-call-connecting' ? 'connecting'
      : surfaceId === 'chat.group-call-reconnecting' ? 'reconnecting'
        : surfaceId === 'chat.group-call-failed' ? 'failed'
          : surfaceId === 'chat.group-call-leaving' ? 'leaving' : 'connected';
    const video = surfaceId === 'chat.group-call-video';
    return {
      ...createIdleSnapshot(), state, groupUlid: 'acceptance-group', roomName: 'acceptance-room',
      mediaKind: video ? 'video' : 'audio', localMicEnabled: true, localCameraEnabled: video,
      startedAt: Date.now() - 84_000, errorCode: state === 'failed' ? 'network' : undefined,
      participants: state === 'connected' || state === 'reconnecting' ? [
        { participantId: 'fixture-self', actorPtid: 'member-self', isLocal: true, isMicEnabled: true, isCameraEnabled: video, isSpeaking: false, connectionQuality: 'excellent' },
        { participantId: 'fixture-alice', actorPtid: 'member-alice', isLocal: false, isMicEnabled: true, isCameraEnabled: video, isSpeaking: true, connectionQuality: 'good' },
        { participantId: 'fixture-morgan', actorPtid: 'member-morgan', isLocal: false, isMicEnabled: false, isCameraEnabled: false, isSpeaking: false, connectionQuality: 'poor' },
      ] : [],
    };
  });
  return <>
    {surfaceId === 'chat.group-call-invitation' ? <MobileGroupCallInvitationView groupName={FIXTURE_GROUP.name}
      onJoin={() => setChatSurfaceFixture('chat.group-call-audio')} onDismiss={close} />
      : <MobileGroupCallView snapshot={snapshot} groupName={FIXTURE_GROUP.name}
        identities={{ 'member-alice': { name: 'Alice Chen' }, 'member-morgan': { name: 'Morgan Lee' } }}
        attachMedia={() => () => {}} onLeave={close}
        onJoin={() => setChatSurfaceFixture('chat.group-call-audio')}
        onMic={() => setSnapshot((current) => ({ ...current, localMicEnabled: !current.localMicEnabled,
          participants: current.participants.map((participant) => participant.isLocal ? { ...participant, isMicEnabled: !current.localMicEnabled } : participant) }))}
        onCamera={() => setSnapshot((current) => ({ ...current, localCameraEnabled: !current.localCameraEnabled,
          participants: current.participants.map((participant) => participant.isLocal ? { ...participant, isCameraEnabled: !current.localCameraEnabled } : participant) }))} />}
  </>;
}

function ChatFixtureList({
  surfaceId,
  listHeader,
}: {
  readonly surfaceId: ChatSurfaceFixtureId;
  readonly listHeader?: ReactNode;
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
      {listHeader ?? <><header className="page-header">
        <h1 className="header-title">{t('mobile.chat.title')}</h1>
        <button
          type="button"
          className="header-action"
          aria-label={t('mobile.chat.moreActions')}
        >
          <Icon iconId="pen-line" size={20} />
        </button>
      </header>
      <div className="chat-search-bar">
        <TextField
          className="chat-search-field"
          data-chat-fixture-search
          leading={<Icon iconId="search" size={16} className="chat-search-leading" />}
          placeholder={t('mobile.chat.searchPlaceholder')}
          value={query}
          readOnly
        />
      </div>
      </>}
      {surfaceId === 'chat.list-error' ? (
        <MobileNotice>
          {t('mobile.chat.renderFailed')}
          <Button
            actionId="chat.fixture.retry-list-error"
            leading={<Icon iconId="rotate-ccw" size={14} />}
          >
            {t('common.action.retry')}
          </Button>
        </MobileNotice>
      ) : null}
      {surfaceId === 'chat.list-unavailable' ? (
        <MobileNotice>
          {t('mobile.social.runtimeUnavailable')}
          <Button
            actionId="chat.fixture.retry-list-unavailable"
            leading={<Icon iconId="rotate-ccw" size={14} />}
          >
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
            description={(
              <div className="empty-copy">
                <Text strong>{t('mobile.chat.emptyTitle')}</Text>
                <Text tone="secondary">{t('mobile.chat.emptySubtitle')}</Text>
              </div>
            )}
          />
        ) : surfaceId === 'chat.list-search-empty' ? (
          <Empty description={t('mobile.chat.noSearchResults')} />
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
          {group ? <Icon iconId="users" size={14} aria-hidden="true" /> : null}
        </span>
        <Text tone="secondary">{preview}</Text>
      </span>
      <Text tone="secondary">{time}</Text>
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
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [draft, setDraft] = useState(surfaceId === 'chat.composer-keyboard' ? 'Meet at 4 PM?' : '');
  const [selectionVisible, setSelectionVisible] = useState(surfaceId === 'chat.message-selection');
  const [voicePreviewVisible, setVoicePreviewVisible] = useState(surfaceId === 'chat.voice-preview');
  const [emojiOpen, setEmojiOpen] = useState(false);
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
          <Icon iconId="arrow-left" size={20} />
        </button>
        {isSearch ? (
          <>
            <h1 className="chat-search-title">
              {t('mobile.chat.quickSearch')}
            </h1>
            <span className="chat-header-search-field">
              <TextField
                className="chat-header-search"
                leading={<Icon iconId="search" size={16} />}
                value={surfaceId === 'chat.thread-search-empty' ? 'Unavailable message' : 'launch'}
                readOnly
                aria-label={t('mobile.chat.searchMessagesPlaceholder')}
              />
            </span>
            <button className="header-action" type="button" aria-label={t('common.action.cancel')}>
              <Icon iconId="close" size={18} />
            </button>
          </>
        ) : (
          <>
            <div className="header-title-stack">
              <h1 className="header-title compact">{title}</h1>
              <Text tone="secondary">
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
              <Icon iconId="more-horizontal" size={20} />
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
          <Button
            actionId="chat.fixture.retry-history"
            leading={<Icon iconId="rotate-ccw" size={14} />}
          >
            {t('common.action.retry')}
          </Button>
        </MobileNotice>
      ) : null}
      {surfaceId === 'chat.thread-search-error' ? (
        <MobileNotice>
          {t('mobile.chat.searchFailed')}
          <Button
            actionId="chat.fixture.retry-search"
            leading={<Icon iconId="rotate-ccw" size={14} />}
          >
            {t('common.action.retry')}
          </Button>
        </MobileNotice>
      ) : null}
      {isSearch ? (
        <section className="message-search-panel">
          {surfaceId === 'chat.thread-search-empty' ? (
            <Text tone="secondary">{t('mobile.chat.noMessageResults')}</Text>
          ) : (
            <MobileSearchResult resourceId="message-planning" resourceKey="fixture:message-planning"
              kind={SearchKind.MESSAGE} snippet={FIXTURE_SEARCH_RESULT} title=""
              authorName="Alice Chen" conversationTitle="Launch planning" zone={SearchZone.DEVICE_E2EE}
              createdAtUnixMs={(FIXTURE_MESSAGE.createdAt?.seconds ?? 0) * 1000}
              selected={false} opening={false} onOpen={() => setChatSurfaceFixture('chat.direct-thread')} />
          )}
        </section>
      ) : null}

      {selectionVisible && <ChatMessageSelectionToolbar count={2} busy={false}
        onForward={() => undefined} onHide={() => undefined} onCancel={() => setSelectionVisible(false)} />}
      <section className="message-list chat-background-default" data-message-viewport>
        {isEmpty ? (
          <Empty description={t('mobile.chat.emptyThread')} />
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

      <MobileChatComposer
        draft={draft} onDraftChange={setDraft} placeholder={t('mobile.chat.messagePlaceholder')}
        inputRef={inputRef} composerRef={bottom.composerRef} inputPanelRef={bottom.inputPanelRef}
        inputProps={{ 'data-chat-fixture-composer': true, readOnly: surfaceId !== 'chat.composer-keyboard' }}
        keyboardOpen={surfaceId === 'chat.composer-keyboard'}
        title={title} onSend={() => undefined} sending={false} toolsDisabled={false}
        inputDisabled={false} editing={false}
        initiallyExpanded={surfaceId === 'chat.composer-expanded'}
        emojiOpen={emojiOpen} onEmojiOpenChange={setEmojiOpen} recentEmojis={[]} onEmojiUsed={() => undefined}
        onChooseFile={() => undefined} onTakePhoto={() => undefined} onRecordVoice={() => undefined}
        recording={surfaceId === 'chat.voice-recording' ? { seconds: 8, cancel: () => undefined, finish: () => undefined } : undefined}
        attachments={<>
          {voicePreviewVisible && <AttachmentDraftChip draft={{
            id: 'voice-preview', filename: 'voice-note.wav', mimeType: 'audio/wav',
            previewUrl: FIXTURE_VOICE_PREVIEW_URL,
            attempt: 1, status: 'ready',
            voiceNote: { durationMs: 1000, codec: 'audio/wav', waveform: [8, 15, 8] },
          }} disabled={false} onRemove={() => setVoicePreviewVisible(false)} onRetry={() => undefined} />}
          {attachmentState ? (
            <div className="message-composer-panel attachment-draft-panel">
              <div className="attachment-draft-chip">
                <Icon iconId="file-text" size={17} />
                <span>{FIXTURE_ATTACHMENT_NAME}</span>
                {surfaceId === 'chat.attachment-uploading' ? <Spin size="small" /> : null}
                {surfaceId === 'chat.attachment-failed' ? (
                  <IconButton actionId="chat.fixture.attachment.retry" iconId="rotate-ccw" density="comfortable" emphasis="quiet" label={t('common.action.retry')} />
                ) : null}
                <IconButton actionId="chat.fixture.attachment.remove" iconId="close" density="comfortable" emphasis="quiet" label={t('common.action.delete')} />
              </div>
              <Text tone="secondary">
                {surfaceId === 'chat.attachment-uploading'
                  ? t('chat.social.messageArea.attachmentStateDownloading')
                  : surfaceId === 'chat.attachment-failed'
                    ? t('mobile.chat.attachmentUploadFailed')
                    : t('mobile.chat.attachmentMessage')}
              </Text>
            </div>
          ) : null}
          {surfaceId === 'chat.voice-failed' ? (
            <MobileNotice>
              {t('chat.social.composer.voiceSendFailed')}
              <Button
                actionId="chat.fixture.retry-voice"
                leading={<Icon iconId="rotate-ccw" size={14} />}
              >
                {t('common.action.retry')}
              </Button>
            </MobileNotice>
          ) : null}
        </>}
      />
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
        <MobileAvatar className="message-avatar" size={38} name="Alice">{FIXTURE_PEER_AVATAR}</MobileAvatar>
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
        <MobileAvatar className="message-avatar" size={38} name="You">{FIXTURE_SELF_AVATAR}</MobileAvatar>
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
        onClose={() => setChatSurfaceFixture('chat.direct-thread')}
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
        onClose={() => setChatSurfaceFixture('chat.group-thread')}
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
