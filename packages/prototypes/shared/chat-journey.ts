export type ChatJourneyLocale = 'en' | 'zh';
export type ChatDeliveryState = 'failed' | 'recovering' | 'delivered';

export const CHAT_JOURNEY_ID = 'CHAT-CRAFT-J01';
export const CHAT_JOURNEY_MESSAGE_ID = 'release-hold-001';

export const CHAT_JOURNEY = {
  conversationId: 'release-room',
  conversationName: {
    en: 'Release Room',
    zh: '发布协同',
  },
  participants: 7,
  station: 'Singapore Station',
  remoteStation: 'Frankfurt Station',
  messageId: CHAT_JOURNEY_MESSAGE_ID,
  traceId: 'msg-7F3A · relay-eu-02',
  messages: {
    inbound: {
      en: 'The connection dropped on their side again. Do we still ship?',
      zh: '对方那边连接又断了。我们还继续发布吗？',
    },
    outbound: {
      en: 'Hold the release until reconnect recovery is verified.',
      zh: '先暂停发布，直到重连恢复验证通过。',
    },
    followup: {
      en: 'Acknowledged. I will keep the release gate closed.',
      zh: '收到。我会保持发布门禁关闭。',
    },
  },
  timestamps: {
    inbound: '10:28',
    outbound: '10:29',
    recovered: '10:31',
  },
} as const;

export const CHAT_JOURNEY_COPY = {
  en: {
    deliveryFailed: 'Delivery needs attention',
    deliveryFailedDetail: 'Saved on this device. The remote Station has not acknowledged it.',
    deliveryRecovering: 'Reconnecting and confirming delivery...',
    deliveryRecovered: 'Delivered after reconnect',
    retry: 'Retry',
    retrying: 'Retrying',
    delivered: 'Delivered',
    localSaved: 'Saved locally',
    stationAccepted: 'Station accepted',
    relayUnavailable: 'Relay unavailable',
    remotePending: 'Remote acknowledgement pending',
    remoteAcknowledged: 'Remote Station acknowledged',
    runReconciliation: 'Run reconciliation',
    inspectQueue: 'Inspect queue',
    queueTitle: 'Message delivery',
    queueSubtitle: 'Follow one encrypted message from the sender device to remote acknowledgement.',
    attentionSummary: '1 delivery needs attention',
    healthySummary: 'Delivery path healthy',
    operatorNote: 'The operator reconciles delivery state; message content and send intent remain user-owned.',
    journeyName: 'Release hold message',
    noDataLoss: 'No message or draft was lost.',
  },
  zh: {
    deliveryFailed: '消息投递需要处理',
    deliveryFailedDetail: '消息已保存在本机，但远端 Station 尚未确认。',
    deliveryRecovering: '正在重连并确认投递…',
    deliveryRecovered: '重连后已送达',
    retry: '重试',
    retrying: '重试中',
    delivered: '已送达',
    localSaved: '已保存到本机',
    stationAccepted: 'Station 已接收',
    relayUnavailable: '中继不可用',
    remotePending: '等待远端确认',
    remoteAcknowledged: '远端 Station 已确认',
    runReconciliation: '执行对账',
    inspectQueue: '检查队列',
    queueTitle: '消息投递',
    queueSubtitle: '追踪一条加密消息从发送设备到远端确认的完整路径。',
    attentionSummary: '1 条投递需要处理',
    healthySummary: '投递链路正常',
    operatorNote: '运维侧只对账投递状态；消息内容与发送意图仍由用户持有。',
    journeyName: '暂停发布消息',
    noDataLoss: '消息与草稿均未丢失。',
  },
} as const;

export function resolveChatJourneyLocale(search = '', language = ''): ChatJourneyLocale {
  const requested = new URLSearchParams(search).get('lang');
  if (requested === 'zh' || requested === 'zh-CN') return 'zh';
  if (requested === 'en' || requested === 'en-US') return 'en';
  return language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
