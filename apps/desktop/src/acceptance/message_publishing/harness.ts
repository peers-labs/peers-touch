import { api, type NotificationPreferenceData } from '../../services/desktop_api';
import { useSocialChatStore } from '../../store/socialChat';
import {
  aggregateServiceEvents,
  serviceAggregationKey,
} from '../../components/chat/message/serviceEventAggregation';
import { registerAcceptanceHarness } from '../registry';

interface ConversationMessageInput {
  conversationId: string;
  messageId: string;
}

interface AttachmentInput {
  conversationId: string;
  filename: string;
  mimeType: string;
  bytes: number[];
}

const CHAT_NOTIFICATION_CATEGORY = 2;

async function receiverSnapshot({
  conversationId,
  messageId,
}: ConversationMessageInput) {
  const social = useSocialChatStore.getState();
  await social.loadSessions();
  const conversationBeforeOpen = useSocialChatStore.getState()
    .getIMConversations()
    .find(item => item.kind === 'friend' && item.id === conversationId);
  await useSocialChatStore.getState().loadMessages(conversationId, 'friend');

  const state = useSocialChatStore.getState();
  const messages = state.getIMMessages('friend', conversationId);
  const matching = messages.filter(message => message.id === messageId);
  const message = matching[0];
  const aggregationKey = message ? serviceAggregationKey(message) : '';
  const aggregateRows = aggregateServiceEvents(messages);
  const aggregate = aggregateRows.find(
    row => row.aggregation?.key === aggregationKey,
  )?.aggregation;
  const notificationPage = await api.notificationList(
    undefined,
    undefined,
    undefined,
    100,
  );
  const notifications = notificationPage.notifications.filter(notification => (
    notification.metadata?.message_id === messageId
  ));

  return {
    conversationId,
    messageId,
    messageCount: matching.length,
    unreadBeforeOpen: conversationBeforeOpen?.visibleUnread ?? 0,
    notificationCount: notifications.length,
    notificationIds: notifications.map(notification => notification.id),
    message: message
      ? {
          id: message.id,
          senderPtid: message.senderPtid,
          content: message.content,
          eventSequence: message.eventSequence,
          deliveryState: message.deliveryState,
          attachmentCount: message.attachments.length,
          serviceMessage: message.serviceMessage ?? null,
        }
      : null,
    aggregation: aggregate
      ? {
          key: aggregate.key,
          knownCount: aggregate.knownCount,
          conflicting: aggregate.conflicting,
          knownHistoryOnly: aggregate.knownHistoryOnly,
          effectiveMessageId: aggregate.effective.messageId,
          effectiveRevision:
            aggregate.effective.content?.primary?.taskState?.revision ?? '',
          effectiveState:
            aggregate.effective.content?.primary?.taskState?.state ?? 0,
        }
      : null,
  };
}

function currentChatNotificationPreference(
  preferences: NotificationPreferenceData[],
): NotificationPreferenceData {
  const preference = preferences.find(
    item => item.category === CHAT_NOTIFICATION_CATEGORY,
  );
  if (!preference) {
    throw new Error('Chat notification preference is unavailable');
  }
  return preference;
}

export function installAcceptanceHarness(): void {
  registerAcceptanceHarness('messagePublishing', {
    async parkReceiver() {
      useSocialChatStore.setState({
        activeSessionUlid: null,
        activeGroupUlid: null,
        openThreadRootUlid: null,
      });
      return { parked: true };
    },

    receiverSnapshot,

    async openReceiverMessage(input: ConversationMessageInput) {
      const snapshot = await receiverSnapshot(input);
      if (!snapshot.message) {
        throw new Error(`Message ${input.messageId} is not projected`);
      }
      const social = useSocialChatStore.getState();
      social.selectSession(input.conversationId);
      social.setActiveTab('friend');
      return snapshot;
    },

    async locateReceiverMessage(input: ConversationMessageInput) {
      const snapshot = await receiverSnapshot(input);
      if (!snapshot.message) {
        throw new Error(`Message ${input.messageId} is not projected`);
      }
      const social = useSocialChatStore.getState();
      social.selectSession(input.conversationId);
      social.setActiveTab('friend');
      useSocialChatStore.getState().setScrollToMessageUlid(input.messageId);
      return {
        ...snapshot,
        located: true,
      };
    },

    async createBot({ name }: { name: string }) {
      const created = await api.botCreate(name);
      return {
        botPtid: created.bot.botPtid,
        publishingId: created.bot.publishingId,
        ingressUrl: created.ingressUrl,
        secret: created.secret,
      };
    },

    async revokeBot({ botPtid }: { botPtid: string }) {
      const result = await api.botSetState(botPtid, 4);
      return {
        botPtid: result.bot.botPtid,
        state: result.bot.state,
        publishingId: result.bot.publishingId,
      };
    },

    async disableChatNotifications() {
      const snapshot = await api.notificationPreferences();
      const original = currentChatNotificationPreference(snapshot.preferences);
      const result = await api.notificationPreferencesUpdate({
        updates: [{
          category: CHAT_NOTIFICATION_CATEGORY,
          enabled: false,
          pushEnabled: original.pushEnabled,
          soundEnabled: original.soundEnabled,
        }],
        observedRevision: snapshot.notificationPreferencesRevision,
      });
      return {
        original,
        updated: currentChatNotificationPreference(
          result.snapshot.preferences,
        ),
        revision: result.snapshot.notificationPreferencesRevision,
      };
    },

    async restoreChatNotifications({
      preference,
    }: {
      preference: NotificationPreferenceData;
    }) {
      const snapshot = await api.notificationPreferences();
      const result = await api.notificationPreferencesUpdate({
        updates: [{
          category: CHAT_NOTIFICATION_CATEGORY,
          enabled: preference.enabled,
          pushEnabled: preference.pushEnabled,
          soundEnabled: preference.soundEnabled,
        }],
        observedRevision: snapshot.notificationPreferencesRevision,
      });
      return {
        restored: currentChatNotificationPreference(
          result.snapshot.preferences,
        ),
        revision: result.snapshot.notificationPreferencesRevision,
      };
    },

    async uploadAttachment(input: AttachmentInput) {
      const uploaded = await api.ossUploadAgentAttachmentBytes({
        filename: input.filename,
        mime_type: input.mimeType,
        bytes: input.bytes,
        conversation_id: input.conversationId,
      });
      const key = uploaded.object_ref.replace(/^oss:/, '');
      const listed = await api.ossListMyFiles({
        include_deleted: false,
        page: 1,
        page_size: 100,
      });
      const object = listed.files.find(file => file.key === key);
      if (!object) {
        throw new Error(`Uploaded object ${key} is not owner-visible`);
      }
      return {
        objectId: object.id,
        key: object.key,
        filename: object.name,
        mediaType: object.mime,
        size: object.size,
      };
    },

    async deleteAttachment({ key }: { key: string }) {
      const deleted = await api.ossDeleteFile(key);
      return {
        key,
        deleted: Boolean(deleted),
      };
    },
  });
}
