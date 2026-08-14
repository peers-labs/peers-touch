import { TEST_ACCOUNTS, type AccountName } from '../accounts';

const ALICE_GATEWAY = `http://localhost:${process.env.PT_DESKTOP_APP_GATEWAY_PORT || '3130'}`;
const BOB_GATEWAY = `http://localhost:${process.env.PEER_GATEWAY_PORT || '3830'}`;

export function gatewayUrl(account: AccountName = 'alice'): string {
  return account === 'bob' ? BOB_GATEWAY : ALICE_GATEWAY;
}

export async function gateway(
  cmd: string,
  args: Record<string, unknown> = {},
  account: AccountName = 'alice',
): Promise<any> {
  const url = gatewayUrl(account);
  const res = await fetch(`${url}/api/gateway`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd, args }),
  });
  return res.json();
}

export async function peerGateway(
  cmd: string,
  args: Record<string, unknown> = {},
): Promise<any> {
  return gateway(cmd, args, 'bob');
}

export async function login(account: AccountName): Promise<any> {
  const { email, password } = TEST_ACCOUNTS[account];
  const restorable = await gateway('account_list_restorable', {}, account);

  if (restorable.ok) {
    const list = JSON.parse(restorable.data?.status || '{"accounts":[]}');
    const existing = list.accounts?.find((a: any) => a.email === email);
    if (existing?.has_session) {
      return gateway('account_switch', { id: existing.id }, account);
    }
  }

  return gateway('auth_login', { account: email, password }, account);
}

export async function waitForAuth(
  tauriPage: any,
  timeoutMs = 30_000,
): Promise<void> {
  await tauriPage.waitForFunction(
    "document.querySelectorAll('[data-pt-primary-nav]').length > 0",
    timeoutMs,
  );
}

export async function ensureEnrolled(account: AccountName): Promise<boolean> {
  const debug = await gateway('messaging_debug', {}, account);
  if (!debug.ok) return false;
  const status = JSON.parse(debug.data?.status || '{}');
  return status.enrolled === true && (status.prekeys_published || 0) > 0;
}

export async function getConversations(account: AccountName): Promise<any[]> {
  const res = await gateway('messaging_conversations', {}, account);
  if (!res.ok) return [];
  const parsed = JSON.parse(res.data?.status || '{"conversations":[]}');
  return parsed.conversations || [];
}

export async function sendMessage(
  account: AccountName,
  conversationId: string,
  text: string,
): Promise<any> {
  return gateway('messaging_send_message', {
    conversation_id: conversationId,
    plaintext: text,
  }, account);
}

export async function drain(account: AccountName): Promise<any> {
  return gateway('messaging_drain', {}, account);
}

export async function listMessages(
  account: AccountName,
  conversationId: string,
): Promise<any> {
  return gateway('messaging_list_messages', {
    conversation_id: conversationId,
  }, account);
}

export async function createDirectConversation(
  fromAccount: AccountName,
  toEmail: string,
): Promise<any> {
  return gateway('messaging_create_direct', {
    peer_account: toEmail,
  }, fromAccount);
}
