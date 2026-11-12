import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const agentChatCache = vi.hoisted(() => ({
  getMessages: vi.fn(),
  syncConversation: vi.fn(),
  upsertMessage: vi.fn(),
  refreshConversation: vi.fn(),
  clearConversation: vi.fn(),
}));

const bus = vi.hoisted(() => {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  return {
    listeners,
    publish: (type: string, payload: unknown) => {
      listeners.get(type)?.forEach((listener) => listener(payload));
    },
    subscribe: (type: string, listener: (payload: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
      return () => listeners.get(type)?.delete(listener);
    },
  };
});

vi.mock('../storage/desktopAgentChatCache', () => ({
  getDesktopAgentChatCache: () => agentChatCache,
}));

vi.mock('../kernel/events', () => ({
  EVENT: {
    AGENT_TURN_ADMITTED: 'agent.turn_admitted',
    AGENT_TURN_QUEUE_CANCELLED: 'agent.turn_queue_cancelled',
    AGENT_TURN_RECOVERY_RETRY_REQUESTED: 'agent.turn_recovery_retry_requested',
  },
  eventBus: {
    publish: bus.publish,
    subscribe: bus.subscribe,
  },
}));

import { api, type AgentAttachmentRefInput } from '../services/desktop_api';
import { useAgentStore } from './agent';
import { createAgentDraftKey } from './agentDraft';
import { useChatStore } from './chat';

function makeRef(attachmentId: string, objectRef: string): AgentAttachmentRefInput {
  return {
    attachment_id: attachmentId,
    object_ref: objectRef,
    mime_type: 'application/pdf',
    size_bytes: 64,
    checksum: `checksum-${attachmentId}`,
    filename: `${attachmentId}.pdf`,
    authorization_scope: 'conversation',
    expires_at: '',
    extracted_content_ref: '',
  };
}

describe('TW-D2 durable composer attachments', () => {
  let deleteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    agentChatCache.clearConversation.mockResolvedValue(undefined);
    deleteSpy = vi
      .spyOn(api, 'ossDeleteAgentAttachment')
      .mockResolvedValue({ key: 'x' } as never);
    useChatStore.getState().reset();
  });

  afterEach(() => {
    useChatStore.getState().reset();
    vi.restoreAllMocks();
  });

  it('guards setComposerAttachments against identical ref lists', () => {
    const { setComposerAttachments } = useChatStore.getState();
    setComposerAttachments('conv-1', [makeRef('att-1', 'oss://1')]);
    const before = useChatStore.getState().composerAttachments;

    let notifications = 0;
    const unsubscribe = useChatStore.subscribe(() => {
      notifications += 1;
    });

    // New array, same identity pair: no state update, no notification.
    setComposerAttachments('conv-1', [makeRef('att-1', 'oss://1')]);
    expect(useChatStore.getState().composerAttachments).toBe(before);
    expect(notifications).toBe(0);

    setComposerAttachments('conv-1', [
      makeRef('att-1', 'oss://1'),
      makeRef('att-2', 'oss://2'),
    ]);
    expect(notifications).toBe(1);

    setComposerAttachments('conv-1', []);
    expect(useChatStore.getState().composerAttachments['conv-1']).toBeUndefined();
    unsubscribe();
  });

  it('purges only the abandoned session refs and reclaims them on Station OSS', async () => {
    const { setComposerAttachments, setComposerDraft, purgeSessions } = useChatStore.getState();
    setComposerDraft('conv-1', 'unsent one');
    setComposerDraft('conv-2', 'unsent two');
    setComposerAttachments('conv-1', [makeRef('att-1', 'oss://1')]);
    setComposerAttachments('conv-2', [makeRef('att-2', 'oss://2')]);

    await purgeSessions(['conv-1']);

    const state = useChatStore.getState();
    expect(state.composerDrafts['conv-1']).toBeUndefined();
    expect(state.composerAttachments['conv-1']).toBeUndefined();
    expect(state.composerDrafts['conv-2']).toBe('unsent two');
    expect(state.composerAttachments['conv-2']?.[0]?.attachment_id).toBe('att-2');
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith('oss://1');
  });

  it('releases staged refs of same-agent drafts replaced by a new session', () => {
    useAgentStore.setState({
      selectedAgent: 'agent-a',
      agents: [{ id: 'agent-a', name: 'agent-a' }],
    } as never);
    const oldDraftA = createAgentDraftKey('agent-a');
    const draftB = createAgentDraftKey('agent-b');
    const { setComposerAttachments, newSession } = useChatStore.getState();
    setComposerAttachments(oldDraftA, [makeRef('att-a', 'oss://a')]);
    setComposerAttachments(draftB, [makeRef('att-b', 'oss://b')]);

    newSession();

    const state = useChatStore.getState();
    expect(state.composerAttachments[oldDraftA]).toBeUndefined();
    expect(state.composerAttachments[draftB]?.[0]?.attachment_id).toBe('att-b');
    expect(useChatStore.getState().currentSessionKey).not.toBe(oldDraftA);
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith('oss://a');
  });
});
