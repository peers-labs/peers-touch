import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MobileAuthSession } from '../auth/authSession';
import type { MessagingConversationProjection } from '../../services/mobileCommands';
import { MobileMutationAdmissionError } from '../../runtimes/mutationAdmission';
import type { SocialMessage } from './socialTypes';

const commands = vi.hoisted(() => ({
  submitReadCursor: vi.fn(),
}));

vi.mock('../../services/mobileCommands', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/mobileCommands')>()),
  messagingSubmitReadCursor: commands.submitReadCursor,
}));

import { useSocialStore } from './socialStore';

const session: MobileAuthSession = {
  stationPeerId: 'station-a',
  stationUrl: 'https://station.example',
  sessionId: 'session-a',
  deviceId: 'device-a',
  lifecycleGeneration: 1,
  actorRef: { ptid: 'ptid:alice' },
  authenticatedAt: 1,
};

const message: SocialMessage = {
  ulid: 'message-1',
  eventSequence: 7,
  sessionUlid: 'direct-a',
  senderPtid: 'ptid:bob',
  receiverPtid: 'ptid:alice',
  type: 1,
  content: 'hello',
  status: 1,
};

describe('Social store read cursor admission', () => {
  beforeEach(() => {
    commands.submitReadCursor.mockReset();
    useSocialStore.setState(useSocialStore.getInitialState(), true);
    useSocialStore.setState({
      authSession: session,
      currentUserPtid: session.actorRef.ptid,
      activeSessionUlid: 'direct-a',
      messages: { 'direct-a': [message] },
      messagingConversations: [{
        conversationId: 'direct-a',
        kind: 1,
      } as MessagingConversationProjection],
    });
  });

  afterEach(() => {
    useSocialStore.setState(useSocialStore.getInitialState(), true);
  });

  it('defers a read cursor while write admission is closed', async () => {
    commands.submitReadCursor.mockRejectedValueOnce(
      new MobileMutationAdmissionError('reconciliation_required'),
    );

    await expect(
      useSocialStore.getState().markActiveSessionRead('direct-a', message.ulid),
    ).resolves.toBeUndefined();
    expect(commands.submitReadCursor).toHaveBeenCalledWith({
      stationPeerId: session.stationPeerId,
      actorPtid: session.actorRef.ptid,
      deviceId: session.deviceId,
      lifecycleGeneration: session.lifecycleGeneration,
      admissionDomain: 'social',
      conversationId: 'direct-a',
      lastReadSequence: message.eventSequence,
    });
  });

  it('preserves non-admission failures', async () => {
    commands.submitReadCursor.mockRejectedValueOnce(new Error('transport failed'));

    await expect(
      useSocialStore.getState().markActiveSessionRead('direct-a', message.ulid),
    ).rejects.toThrow('transport failed');
  });
});
