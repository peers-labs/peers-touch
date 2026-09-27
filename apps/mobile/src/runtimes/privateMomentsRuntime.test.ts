import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type {
  PrivateMomentProjection,
  PrivateMomentReadProjection,
} from '../services/mobileCommands';
import type { MobileAuthSession } from '../features/auth/authSession';
import { useAuthStore } from '../features/auth/authStore';

const commandMocks = vi.hoisted(() => ({
  activate: vi.fn(),
  publish: vi.fn(),
  readText: vi.fn(),
  reconcile: vi.fn(),
  snapshot: vi.fn(),
  teardown: vi.fn(),
}));

vi.mock('../services/mobileCommands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/mobileCommands')>();
  return {
    ...actual,
    privateSocialActivate: commandMocks.activate,
    privateSocialPublishText: commandMocks.publish,
    privateSocialReadText: commandMocks.readText,
    privateSocialReconcile: commandMocks.reconcile,
    privateSocialSnapshot: commandMocks.snapshot,
    privateSocialTeardown: commandMocks.teardown,
  };
});

import {
  createPrivateMomentsRuntimeDescriptor,
  mergeProjectionLists,
  mergeReadProjectionMap,
  publishPrivateTextMoment,
  readPrivateMomentsSnapshot,
  readPrivateTextMoment,
  reconcilePrivateMoments,
} from './privateMomentsRuntime';

let activeDescriptor: ReturnType<typeof createPrivateMomentsRuntimeDescriptor> | null = null;

beforeEach(() => {
  for (const mock of Object.values(commandMocks)) mock.mockReset();
  commandMocks.snapshot.mockResolvedValue({
    publishProjections: [],
    readProjections: [],
  });
  commandMocks.teardown.mockResolvedValue({
    active: false,
    activationGeneration: 0,
    workerMode: 'on_demand',
  });
  useAuthStore.setState({
    session: null,
    accessDecision: null,
    loading: false,
    error: null,
    restored: false,
  });
});

afterEach(async () => {
  await activeDescriptor?.teardown();
  activeDescriptor = null;
  useAuthStore.setState({
    session: null,
    accessDecision: null,
  });
});

function projection(
  draftId: string,
  draftRevision: number,
  state: PrivateMomentProjection['state'],
): PrivateMomentProjection {
  return {
    draftId,
    draftRevision,
    contentId: `${draftId}:${draftRevision}`,
    generation: 1,
    audienceKind: 'FRIENDS',
    state,
  };
}

function readProjection(
  postId: string,
  generation: string,
  state: PrivateMomentReadProjection['state'],
): PrivateMomentReadProjection {
  return {
    postId,
    contentId: postId,
    generation,
    authorPtid: state === 'CONTENT_READY' ? 'ptid:alice' : '',
    audienceKind: state === 'CONTENT_READY' ? 'FRIENDS' : 'UNKNOWN',
    state,
    content: state === 'CONTENT_READY'
      ? { kind: 'TEXT', text: `text:${generation}` }
      : undefined,
  };
}

function authSession(sessionId: string): MobileAuthSession {
  return {
    stationPeerId: 'station-1',
    stationUrl: 'https://station.test',
    sessionId,
    deviceId: 'device-1',
    lifecycleGeneration: 1,
    actorRef: { ptid: 'ptid:alice' },
    authenticatedAt: 1,
  };
}

function activeStatus(activationGeneration: number) {
  return {
    active: true,
    profileId: 'profile-1',
    stationPeerId: 'station-1',
    actorPtid: 'ptid:alice',
    deviceId: 'device-1',
    activationGeneration,
    workerMode: 'on_demand' as const,
  };
}

describe('privateMomentsRuntime projection', () => {
  it('replaces an older state for the same durable draft identity', () => {
    const merged = mergeProjectionLists(
      [projection('draft-a', 1, 'UNKNOWN_OUTCOME')],
      [{ ...projection('draft-a', 1, 'PUBLISHED'), postId: 'post-a' }],
    );

    expect(merged).toEqual([
      expect.objectContaining({
        draftId: 'draft-a',
        state: 'PUBLISHED',
        postId: 'post-a',
      }),
    ]);
  });

  it('keeps independent draft revisions addressable', () => {
    const merged = mergeProjectionLists(
      [projection('draft-a', 1, 'PUBLISHED')],
      [projection('draft-a', 2, 'PUBLISHING')],
    );

    expect(merged.map((item) => item.draftRevision)).toEqual([2, 1]);
  });

  it('merges receiver projections by stable post ID and rejects older ready content', () => {
    const current = {
      'post-a': readProjection('post-a', '2', 'CONTENT_READY'),
    };
    const merged = mergeReadProjectionMap(current, [
      readProjection('post-a', '1', 'CONTENT_READY'),
      readProjection('post-b', '1', 'CONTENT_READY'),
    ]);

    expect(merged['post-a']?.content).toEqual({ kind: 'TEXT', text: 'text:2' });
    expect(merged['post-b']?.content).toEqual({ kind: 'TEXT', text: 'text:1' });
  });

  it('lets a terminal deny replace and clear a cached ready projection', () => {
    const merged = mergeReadProjectionMap(
      { 'post-a': readProjection('post-a', '2', 'CONTENT_READY') },
      [readProjection('post-a', '0', 'NOT_FOUND_OR_NOT_AUTHORIZED')],
    );

    expect(merged['post-a']).toEqual(expect.objectContaining({
      postId: 'post-a',
      state: 'NOT_FOUND_OR_NOT_AUTHORIZED',
      content: undefined,
    }));
  });

  it('discards a plaintext read completion after a same-PTID session switch', async () => {
    commandMocks.activate
      .mockResolvedValueOnce(activeStatus(1))
      .mockResolvedValueOnce(activeStatus(2));
    let resolveRead: ((projection: PrivateMomentReadProjection) => void) | undefined;
    commandMocks.readText.mockReturnValueOnce(new Promise((resolve) => {
      resolveRead = resolve;
    }));
    useAuthStore.setState({
      session: authSession('session-1'),
      accessDecision: {
        state: 'ACCESS_DECISION_STATE_GRANTED',
        attemptId: 'attempt-1',
        gates: [],
      },
    });
    activeDescriptor = createPrivateMomentsRuntimeDescriptor();
    await activeDescriptor.bootstrap();

    const completion = readPrivateTextMoment('post-a');
    expect(commandMocks.readText).toHaveBeenCalledWith({
      stationPeerId: 'station-1',
      actorPtid: 'ptid:alice',
      deviceId: 'device-1',
      lifecycleGeneration: 1,
      activationGeneration: 1,
      postId: 'post-a',
    });

    useAuthStore.setState({ session: authSession('session-2') });
    await vi.waitFor(() => {
      expect(commandMocks.activate).toHaveBeenCalledTimes(2);
      expect(commandMocks.snapshot).toHaveBeenCalledTimes(2);
    });
    resolveRead?.(readProjection('post-a', '1', 'CONTENT_READY'));

    await expect(completion).rejects.toThrow('mobile.privateSocial.staleReadCompletion');
    expect(readPrivateMomentsSnapshot().postsById).toEqual({});
    expect(readPrivateMomentsSnapshot().errorMessage).toBeNull();
  });

  it('carries the exact activation generation on every account-scoped command', async () => {
    commandMocks.activate.mockResolvedValue(activeStatus(7));
    commandMocks.publish.mockResolvedValue(projection('draft-a', 1, 'PUBLISHED'));
    commandMocks.reconcile.mockResolvedValue({
      endpointPrekeysAvailable: 8,
      submissionsProcessed: 1,
      submissionsUnknown: 0,
      submissionsTerminal: 0,
    });
    useAuthStore.setState({
      session: authSession('session-1'),
      accessDecision: {
        state: 'ACCESS_DECISION_STATE_GRANTED',
        attemptId: 'attempt-1',
        gates: [],
      },
    });
    activeDescriptor = createPrivateMomentsRuntimeDescriptor();
    await activeDescriptor.bootstrap();

    await publishPrivateTextMoment({
      draftId: 'draft-a',
      draftRevision: 1,
      text: 'private',
      audience: { kind: 'FRIENDS' },
    });
    await reconcilePrivateMoments();
    await activeDescriptor.teardown();
    activeDescriptor = null;

    const exactScope = {
      stationPeerId: 'station-1',
      actorPtid: 'ptid:alice',
      deviceId: 'device-1',
      lifecycleGeneration: 1,
      activationGeneration: 7,
    };
    expect(commandMocks.snapshot).toHaveBeenCalledWith(exactScope);
    expect(commandMocks.publish).toHaveBeenCalledWith({
      ...exactScope,
      draftId: 'draft-a',
      draftRevision: 1,
      text: 'private',
      audience: { kind: 'FRIENDS' },
    });
    expect(commandMocks.reconcile).toHaveBeenCalledWith(exactScope);
    expect(commandMocks.teardown).toHaveBeenCalledWith(exactScope);
  });

  it('tears down the exact native generation when post-activation bootstrap fails', async () => {
    commandMocks.activate.mockResolvedValue(activeStatus(11));
    commandMocks.snapshot.mockRejectedValueOnce(new Error('snapshot failed'));
    useAuthStore.setState({
      session: authSession('session-1'),
      accessDecision: {
        state: 'ACCESS_DECISION_STATE_GRANTED',
        attemptId: 'attempt-1',
        gates: [],
      },
    });
    activeDescriptor = createPrivateMomentsRuntimeDescriptor();

    await activeDescriptor.bootstrap();

    expect(commandMocks.teardown).toHaveBeenCalledWith({
      stationPeerId: 'station-1',
      actorPtid: 'ptid:alice',
      deviceId: 'device-1',
      lifecycleGeneration: 1,
      activationGeneration: 11,
    });
    expect(readPrivateMomentsSnapshot()).toEqual(expect.objectContaining({
      active: false,
      projections: [],
      postsById: {},
      errorMessage: 'snapshot failed',
    }));
  });

  it('tears down an activated generation when its returned identity is invalid', async () => {
    commandMocks.activate.mockResolvedValue({
      ...activeStatus(13),
      actorPtid: 'ptid:eve',
    });
    useAuthStore.setState({
      session: authSession('session-1'),
      accessDecision: {
        state: 'ACCESS_DECISION_STATE_GRANTED',
        attemptId: 'attempt-1',
        gates: [],
      },
    });
    activeDescriptor = createPrivateMomentsRuntimeDescriptor();

    await activeDescriptor.bootstrap();

    expect(commandMocks.snapshot).not.toHaveBeenCalled();
    expect(commandMocks.teardown).toHaveBeenCalledWith({
      stationPeerId: 'station-1',
      actorPtid: 'ptid:alice',
      deviceId: 'device-1',
      lifecycleGeneration: 1,
      activationGeneration: 13,
    });
    expect(readPrivateMomentsSnapshot()).toEqual(expect.objectContaining({
      active: false,
      projections: [],
      postsById: {},
      errorMessage: 'mobile.privateSocial.activationIdentityMismatch',
    }));
  });

  it('discards a publish completion after a same-PTID session switch', async () => {
    commandMocks.activate
      .mockResolvedValueOnce(activeStatus(1))
      .mockResolvedValueOnce(activeStatus(2));
    let resolvePublish: ((value: PrivateMomentProjection) => void) | undefined;
    commandMocks.publish.mockReturnValueOnce(new Promise((resolve) => {
      resolvePublish = resolve;
    }));
    useAuthStore.setState({
      session: authSession('session-1'),
      accessDecision: {
        state: 'ACCESS_DECISION_STATE_GRANTED',
        attemptId: 'attempt-1',
        gates: [],
      },
    });
    activeDescriptor = createPrivateMomentsRuntimeDescriptor();
    await activeDescriptor.bootstrap();

    const completion = publishPrivateTextMoment({
      draftId: 'draft-a',
      draftRevision: 1,
      text: 'private',
      audience: { kind: 'FRIENDS' },
    });
    useAuthStore.setState({ session: authSession('session-2') });
    await vi.waitFor(() => {
      expect(commandMocks.activate).toHaveBeenCalledTimes(2);
      expect(commandMocks.snapshot).toHaveBeenCalledTimes(2);
    });
    resolvePublish?.(projection('draft-a', 1, 'PUBLISHED'));

    await expect(completion).rejects.toThrow('mobile.privateSocial.stalePublishCompletion');
    expect(readPrivateMomentsSnapshot().projections).toEqual([]);
    expect(readPrivateMomentsSnapshot().errorMessage).toBeNull();
  });

  it('does not publish a stale same-PTID session error globally', async () => {
    commandMocks.activate
      .mockResolvedValueOnce(activeStatus(1))
      .mockResolvedValueOnce(activeStatus(2));
    let rejectPublish: ((reason: Error) => void) | undefined;
    commandMocks.publish.mockReturnValueOnce(new Promise((_, reject) => {
      rejectPublish = reject;
    }));
    useAuthStore.setState({
      session: authSession('session-1'),
      accessDecision: {
        state: 'ACCESS_DECISION_STATE_GRANTED',
        attemptId: 'attempt-1',
        gates: [],
      },
    });
    activeDescriptor = createPrivateMomentsRuntimeDescriptor();
    await activeDescriptor.bootstrap();

    const completion = publishPrivateTextMoment({
      draftId: 'draft-a',
      draftRevision: 1,
      text: 'private',
      audience: { kind: 'FRIENDS' },
    });
    useAuthStore.setState({ session: authSession('session-2') });
    await vi.waitFor(() => {
      expect(commandMocks.activate).toHaveBeenCalledTimes(2);
      expect(commandMocks.snapshot).toHaveBeenCalledTimes(2);
    });
    rejectPublish?.(new Error('old session failed'));

    await expect(completion).rejects.toThrow('old session failed');
    expect(readPrivateMomentsSnapshot().errorMessage).toBeNull();
  });

  it('does not merge a stale same-PTID reconciliation completion', async () => {
    commandMocks.activate
      .mockResolvedValueOnce(activeStatus(1))
      .mockResolvedValueOnce(activeStatus(2));
    let resolveReconcile: ((report: {
      endpointPrekeysAvailable: number;
      submissionsProcessed: number;
      submissionsUnknown: number;
      submissionsTerminal: number;
    }) => void) | undefined;
    commandMocks.reconcile.mockReturnValueOnce(new Promise((resolve) => {
      resolveReconcile = resolve;
    }));
    useAuthStore.setState({
      session: authSession('session-1'),
      accessDecision: {
        state: 'ACCESS_DECISION_STATE_GRANTED',
        attemptId: 'attempt-1',
        gates: [],
      },
    });
    activeDescriptor = createPrivateMomentsRuntimeDescriptor();
    await activeDescriptor.bootstrap();

    const completion = reconcilePrivateMoments();
    useAuthStore.setState({ session: authSession('session-2') });
    await vi.waitFor(() => {
      expect(commandMocks.activate).toHaveBeenCalledTimes(2);
      expect(commandMocks.snapshot).toHaveBeenCalledTimes(2);
    });
    resolveReconcile?.({
      endpointPrekeysAvailable: 9,
      submissionsProcessed: 3,
      submissionsUnknown: 0,
      submissionsTerminal: 0,
    });

    await expect(completion).resolves.toBeNull();
    expect(readPrivateMomentsSnapshot().lastReport).toBeNull();
    expect(readPrivateMomentsSnapshot().errorMessage).toBeNull();
  });
});
