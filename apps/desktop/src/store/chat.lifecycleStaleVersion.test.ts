import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CachedAgentMessage } from '@peers-touch/client-chat-core';
import { api, type AgentConversation, type Session } from '../services/desktop_api';

const agentChatCache = vi.hoisted(() => ({
  clearConversation: vi.fn(),
  getMessages: vi.fn(),
  getTurnEvents: vi.fn(),
  listConversations: vi.fn(),
  refreshConversation: vi.fn(),
  syncConversation: vi.fn(),
  upsertMessage: vi.fn(),
}));

vi.mock('../storage/desktopAgentChatCache', () => ({
  getDesktopAgentChatCache: () => agentChatCache,
}));

import { useChatStore } from './chat';

const conversationId = 'conversation-1';
const projectedSession: Session = {
  id: conversationId,
  key: conversationId,
  agent_name: 'agent-1',
  title: 'Projected title',
  message_count: 2,
  version: 4,
  created_at: '2026-09-16T00:00:00Z',
  updated_at: '2026-09-16T00:00:00Z',
};

function staleVersionError() {
  return Object.assign(new Error('Agent revision command rejected'), {
    details: {
      error_code: 'LIFECYCLE_STALE_VERSION',
      locale_key: 'agent.errors.lifecycleStaleVersion',
      retryable: 'true',
      terminal: 'true',
      resource_id: conversationId,
      expected_revision: '4',
      actual_revision: '5',
    },
  });
}

function installProjectedConversation(): void {
  useChatStore.getState().reset();
  useChatStore.setState({
    currentSessionKey: conversationId,
    sessions: [projectedSession],
    messages: [{
      id: 'assistant-1',
      role: 'assistant',
      content: 'projected answer',
      loading: false,
      timestamp: 1,
      turnId: 'turn-1',
      terminalStatus: 'completed',
    }],
  });
}

function expectCapturedStaleFailure(): void {
  expect(useChatStore.getState().revisionCommandFailure).toMatchObject({
    conversationId,
    resourceId: conversationId,
    expectedRevision: 4,
    actualRevision: 5,
    typedError: {
      error_type: 'LIFECYCLE_STALE_VERSION',
      locale_key: 'agent.errors.lifecycleStaleVersion',
    },
    resolution: {
      type: 'reloadLatest',
      label: 'agent.recovery.reloadLatest',
    },
  });
}

describe('chat lifecycle stale-version recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installProjectedConversation();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useChatStore.getState().reset();
  });

  it('uses the viewed revision and captures stale failures for all revision commands', async () => {
    const getConversation = vi.spyOn(api, 'getAgentConversation')
      .mockRejectedValue(new Error('unexpected latest-version prefetch'));

    const regenerate = vi.spyOn(api, 'regenerateAgentTurn')
      .mockRejectedValueOnce(staleVersionError());
    await expect(
      useChatStore.getState().regenerateMessage('assistant-1'),
    ).resolves.toBeUndefined();
    expect(regenerate).toHaveBeenCalledWith(expect.objectContaining({
      expected_conversation_version: 4,
    }));
    expectCapturedStaleFailure();

    installProjectedConversation();
    const retry = vi.spyOn(api, 'retryAgentTurn')
      .mockRejectedValueOnce(staleVersionError());
    await expect(
      useChatStore.getState().retryMessage('assistant-1'),
    ).resolves.toBeUndefined();
    expect(retry).toHaveBeenCalledWith(expect.objectContaining({
      expected_conversation_version: 4,
      source_turn_id: 'turn-1',
    }));
    expectCapturedStaleFailure();

    installProjectedConversation();
    const branch = vi.spyOn(api, 'selectAgentActiveBranch')
      .mockRejectedValueOnce(staleVersionError());
    await expect(
      useChatStore.getState().branchFromMessage('assistant-1'),
    ).resolves.toBeUndefined();
    expect(branch).toHaveBeenCalledWith(expect.objectContaining({
      expected_conversation_version: 4,
    }));
    expectCapturedStaleFailure();

    installProjectedConversation();
    const tombstone = vi.spyOn(api, 'tombstoneAgentMessage')
      .mockRejectedValueOnce(staleVersionError());
    await expect(
      useChatStore.getState().deleteMessage('assistant-1'),
    ).resolves.toBeUndefined();
    expect(tombstone).toHaveBeenCalledWith(expect.objectContaining({
      expected_conversation_version: 4,
      destructive_confirmed: true,
    }));
    expectCapturedStaleFailure();

    installProjectedConversation();
    const edit = vi.spyOn(api, 'editAndResendAgentMessage')
      .mockRejectedValueOnce(staleVersionError());
    await expect(
      useChatStore.getState().editMessage('user-1', 'stale edit'),
    ).resolves.toBeUndefined();
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({
      expected_conversation_version: 4,
      revised_content: 'stale edit',
    }));
    expectCapturedStaleFailure();

    expect(getConversation).not.toHaveBeenCalled();
  });

  it('reloads authoritative messages and revision without replaying the failed command', async () => {
    const edit = vi.spyOn(api, 'editAndResendAgentMessage')
      .mockRejectedValueOnce(staleVersionError());
    await useChatStore.getState().editMessage('user-1', 'stale edit');
    expectCapturedStaleFailure();

    const authoritativeConversation: AgentConversation = {
      conversation_id: conversationId,
      agent_id: 'agent-1',
      ptid: 'ptid:person:owner',
      title: 'Winner title',
      status: 'active',
      active_branch_message_id: 'assistant-winner',
      queued_turn_count: 0,
      version: 5,
      created_at: '2026-09-16T00:00:00Z',
      updated_at: '2026-09-16T00:01:00Z',
    };
    const authoritativeMessages: CachedAgentMessage[] = [{
      messageId: 'assistant-winner',
      conversationId,
      turnId: 'turn-winner',
      role: 'assistant',
      status: 'completed',
      content: 'winner answer',
      seq: 3,
      createdAt: '2026-09-16T00:01:00Z',
      updatedAt: '2026-09-16T00:01:00Z',
    }];
    vi.spyOn(api, 'getAgentConversation')
      .mockResolvedValue(authoritativeConversation);
    agentChatCache.refreshConversation.mockResolvedValue(authoritativeMessages);

    await expect(
      useChatStore.getState().reloadLatestRevision(conversationId),
    ).resolves.toBeUndefined();

    expect(edit).toHaveBeenCalledTimes(1);
    expect(agentChatCache.refreshConversation).toHaveBeenCalledWith(conversationId);
    expect(useChatStore.getState()).toMatchObject({
      revisionCommandFailure: null,
      revisionReloadingConversationId: null,
      messages: [expect.objectContaining({
        id: 'assistant-winner',
        content: 'winner answer',
        terminalStatus: 'completed',
      })],
    });
    expect(useChatStore.getState().sessions[0]).toMatchObject({
      key: conversationId,
      title: 'Winner title',
      version: 5,
    });
  });

  it('keeps the recovery notice when authoritative reload fails', async () => {
    vi.spyOn(api, 'editAndResendAgentMessage')
      .mockRejectedValueOnce(staleVersionError());
    await useChatStore.getState().editMessage('user-1', 'stale edit');

    vi.spyOn(api, 'getAgentConversation')
      .mockRejectedValueOnce(new Error('reload failed'));
    agentChatCache.refreshConversation.mockResolvedValue([]);

    await expect(
      useChatStore.getState().reloadLatestRevision(conversationId),
    ).rejects.toThrow('reload failed');

    expectCapturedStaleFailure();
    expect(useChatStore.getState().revisionReloadingConversationId).toBeNull();
  });
});
