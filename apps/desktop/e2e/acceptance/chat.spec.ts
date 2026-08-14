import { test, expect } from '../fixtures';
import { CHAT_CONTRACT } from './chat.contract';
import {
  login,
  waitForAuth,
  ensureEnrolled,
  getConversations,
  createDirectConversation,
  sendMessage,
  drain,
  listMessages,
  gateway,
  peerGateway,
} from './helpers';
import { TEST_ACCOUNTS } from '../accounts';

/**
 * Chat Module Acceptance Spec
 *
 * Injection:
 * - setup: authenticates both sides, ensures enrollment and conversation exist
 * - matrix: each verification point is a test case
 *
 * Requires dual-client mode: PEER_GATEWAY_PORT env must point to Bob's gateway.
 */

let conversationId: string;

test.describe(CHAT_CONTRACT.module, () => {
  test.beforeAll(async ({ tauriPage }) => {
    // ── Depends: auth ──
    const aliceLogin = await login('alice');
    expect(aliceLogin.ok).toBe(true);
    await waitForAuth(tauriPage);

    const bobLogin = await login('bob');
    expect(bobLogin.ok).toBe(true);

    // ── Enrollment: wait for MLS device enrollment ──
    let retries = 10;
    while (retries-- > 0) {
      const enrolled = await ensureEnrolled('alice');
      const bobEnrolled = await ensureEnrolled('bob');
      if (enrolled && bobEnrolled) break;
      await new Promise((r) => setTimeout(r, 3000));
    }

    // ── Conversation: ensure one exists ──
    let conversations = await getConversations('alice');
    if (conversations.length === 0) {
      await createDirectConversation('alice', TEST_ACCOUNTS.bob.email);
      await new Promise((r) => setTimeout(r, 2000));
      conversations = await getConversations('alice');
    }
    expect(conversations.length).toBeGreaterThan(0);
    conversationId = conversations[0].conversation_id;

    // ── Bob hydrate ──
    await gateway('messaging_hydrate', {}, 'bob');
  });

  // ── Matrix ──

  test(CHAT_CONTRACT.matrix[0].name, async ({ tauriPage }) => {
    await tauriPage.click('[data-pt-primary-nav="chat"] [role="button"]');
    await tauriPage.waitForFunction(
      "document.querySelectorAll('[data-pt-conversation-item]').length > 0",
      10_000,
    );
    const count = await tauriPage.evaluate(
      "document.querySelectorAll('[data-pt-conversation-item]').length",
    );
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test(CHAT_CONTRACT.matrix[1].name, async () => {
    const text = `acceptance-send-${Date.now()}`;
    const result = await sendMessage('alice', conversationId, text);
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.data?.status || '{}');
    expect(['pending', 'accepted']).toContain(parsed.state);
  });

  test(CHAT_CONTRACT.matrix[2].name, async () => {
    await drain('bob');
    const messages = await listMessages('bob', conversationId);
    expect(messages.ok).toBe(true);
    const parsed = JSON.parse(messages.data?.status || '{"messages":[]}');
    expect(parsed.messages.length).toBeGreaterThan(0);
  });

  test(CHAT_CONTRACT.matrix[3].name, async () => {
    const replyText = `acceptance-reply-${Date.now()}`;
    const result = await sendMessage('bob', conversationId, replyText);
    expect(result.ok).toBe(true);

    await new Promise((r) => setTimeout(r, 2000));
    await drain('alice');

    const messages = await listMessages('alice', conversationId);
    expect(messages.ok).toBe(true);
    const parsed = JSON.parse(messages.data?.status || '{"messages":[]}');
    const found = parsed.messages.some(
      (m: any) => m.plaintext === replyText,
    );
    expect(found).toBe(true);
  });

  test(CHAT_CONTRACT.matrix[4].name, async () => {
    for (let round = 1; round <= 3; round++) {
      const aliceText = `alice-r${round}-${Date.now()}`;
      const aliceSend = await sendMessage('alice', conversationId, aliceText);
      expect(aliceSend.ok).toBe(true);

      await new Promise((r) => setTimeout(r, 2000));
      await drain('bob');

      const bobText = `bob-r${round}-${Date.now()}`;
      const bobSend = await sendMessage('bob', conversationId, bobText);
      expect(bobSend.ok).toBe(true);

      await new Promise((r) => setTimeout(r, 2000));
      await drain('alice');
    }
  });

  test(CHAT_CONTRACT.matrix[5].name, async ({ tauriPage }) => {
    const beforeCount = await tauriPage.evaluate(
      "document.querySelectorAll('[data-pt-message-item]').length",
    );
    const text = `ui-render-${Date.now()}`;
    await sendMessage('alice', conversationId, text);
    await tauriPage.waitForFunction(
      `document.querySelectorAll('[data-pt-message-item]').length > ${beforeCount}`,
      10_000,
    );
  });

  test(CHAT_CONTRACT.matrix[6].name, async ({ tauriPage }) => {
    // Navigate Bob away from chat
    // Alice sends a message
    // Check Bob badge
    const text = `badge-test-${Date.now()}`;
    await sendMessage('alice', conversationId, text);
    await new Promise((r) => setTimeout(r, 3000));

    // This test requires tauriPage to be Bob's page
    // In dual-client mode, we need peer's tauriPage
    // For now: verify via gateway that unread count > 0
    // TODO: when dual playwright sockets work, check DOM on peer
    test.skip(); // Requires dual tauriPage — pending infra
  });

  test(CHAT_CONTRACT.matrix[7].name, async () => {
    // Same dependency as above
    test.skip(); // Requires dual tauriPage — pending infra
  });
});
