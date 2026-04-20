import client from './client';

export interface FriendChatStats {
  sessions: number;
  messages: number;
  friend_requests: number;
  outbox: number;
  attachments: number;
  updated_at: string;
}

export async function getFriendChatStats(): Promise<FriendChatStats> {
  const resp = await client.get('/chat/friend/stats');
  return resp.data as FriendChatStats;
}

