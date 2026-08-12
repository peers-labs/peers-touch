export const CHAT_MESSAGE_VIRTUALIZATION_THRESHOLD = 50;

export function shouldVirtualizeChatMessageTimeline(messageCount: number): boolean {
  return messageCount > CHAT_MESSAGE_VIRTUALIZATION_THRESHOLD;
}
