import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { api } from '../services/desktop_api';
import { ArtifactStaleBaseError, useTaskArtifactStore } from './taskArtifacts';

vi.mock('../storage/desktopAgentChatCache', () => ({
  getDesktopAgentChatCache: vi.fn(),
  createDesktopClientStorageRuntime: vi.fn(),
}));
vi.mock('../services/desktop_api', () => ({
  api: {
    listTaskArtifacts: vi.fn(),
    listTaskArtifactVersions: vi.fn(),
    getTaskArtifactVersionBody: vi.fn(),
    claimTaskArtifactVersion: vi.fn(),
    submitTaskArtifactFeedback: vi.fn(),
    recordTaskArtifactCheck: vi.fn(),
    acceptTaskArtifactVersion: vi.fn(),
    listTaskArtifactFeedback: vi.fn(),
    listTaskArtifactChecks: vi.fn(),
    listTaskArtifactAcceptances: vi.fn(),
  },
}));

const conversationId = 'artifact-conversation';

function artifactResponse(overrides: Record<string, unknown> = {}) {
  return {
    artifact: {
      artifactId: 'art-1',
      taskId: 'task-1',
      conversationId,
      kind: 'LOGICAL_ARTIFACT_KIND_DOCUMENT',
      name: 'Site study',
      currentVersionId: 'ver-1',
      currentSeq: 1,
    },
    version: {
      versionId: 'ver-1',
      artifactId: 'art-1',
      seq: 1,
      origin: 'ARTIFACT_VERSION_ORIGIN_AGENT_OUTPUT',
      sha256: 'abc',
      size: 12,
      sourceTurnId: 'turn-1',
      sourceMessageId: 'msg-1',
    },
    ...overrides,
  };
}

beforeEach(() => {
  useTaskArtifactStore.getState().reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

it('claims an assistant message into an artifact and loads versions and body', async () => {
  vi.mocked(api.listTaskArtifacts).mockResolvedValue({
    artifacts: [artifactResponse().artifact as never],
  } as never);
  vi.mocked(api.listTaskArtifactVersions).mockResolvedValue({
    versions: [artifactResponse().version],
  } as never);
  vi.mocked(api.getTaskArtifactVersionBody).mockResolvedValue({
    version: artifactResponse().version,
    body: '# Site study',
  } as never);
  vi.mocked(api.listTaskArtifactFeedback).mockResolvedValue({ feedback: [] } as never);
  vi.mocked(api.listTaskArtifactChecks).mockResolvedValue({ checks: [] } as never);
  vi.mocked(api.listTaskArtifactAcceptances).mockResolvedValue({ acceptances: [] } as never);
  vi.mocked(api.claimTaskArtifactVersion).mockResolvedValue(artifactResponse() as never);

  const store = useTaskArtifactStore.getState();
  const response = await store.claimFromMessage({
    conversationId,
    turnId: 'turn-1',
    messageId: 'msg-1',
    adoptedAttachmentRefs: ['oss/material/tw-d3.png'],
  });
  expect(response.artifact?.artifactId).toBe('art-1');

  await store.openPanel(conversationId, 'art-1');
  expect(useTaskArtifactStore.getState().selectedVersionId).toBe('ver-1');
  expect(useTaskArtifactStore.getState().bodyByVersion['ver-1']).toBe('# Site study');

  const claimed = await store.claimedMessageIds(conversationId);
  expect(claimed.has('msg-1')).toBe(true);
  expect(api.claimTaskArtifactVersion).toHaveBeenCalledWith(expect.objectContaining({
    conversationId,
    sourceMessageId: 'msg-1',
    origin: 'ARTIFACT_VERSION_ORIGIN_AGENT_OUTPUT',
    adoptedAttachmentRefs: ['oss/material/tw-d3.png'],
  }));
});

it('coalesces concurrent detail and body requests for the same target', async () => {
  vi.mocked(api.listTaskArtifacts).mockResolvedValue({ artifacts: [] } as never);
  vi.mocked(api.listTaskArtifactVersions).mockResolvedValue({
    versions: [artifactResponse().version],
  } as never);
  vi.mocked(api.listTaskArtifactFeedback).mockResolvedValue({ feedback: [] } as never);
  vi.mocked(api.listTaskArtifactChecks).mockResolvedValue({ checks: [] } as never);
  vi.mocked(api.listTaskArtifactAcceptances).mockResolvedValue({ acceptances: [] } as never);
  vi.mocked(api.getTaskArtifactVersionBody).mockResolvedValue({
    version: artifactResponse().version,
    body: '# Site study',
  } as never);

  const store = useTaskArtifactStore.getState();
  vi.mocked(api.listTaskArtifactVersions).mockClear();
  const firstDetail = store.loadDetail('art-1');
  const joinedDetail = store.loadDetail('art-1');
  expect(api.listTaskArtifactVersions).toHaveBeenCalledTimes(1);
  await Promise.all([firstDetail, joinedDetail]);

  let resolvePendingBody: (value: unknown) => void = () => undefined;
  vi.mocked(api.getTaskArtifactVersionBody).mockImplementation(
    ((versionId: string) => {
      if (versionId === 'ver-pending') {
        return new Promise((resolve) => {
          resolvePendingBody = resolve;
        });
      }
      return Promise.resolve({
        version: { ...artifactResponse().version, versionId },
        body: `body-${versionId}`,
      });
    }) as never,
  );

  vi.mocked(api.getTaskArtifactVersionBody).mockClear();
  const firstBody = store.selectVersion('ver-pending');
  const joinedBody = store.selectVersion('ver-pending');
  expect(api.getTaskArtifactVersionBody).toHaveBeenCalledTimes(1);
  expect(api.getTaskArtifactVersionBody).toHaveBeenCalledWith('ver-pending');
  resolvePendingBody({
    version: { ...artifactResponse().version, versionId: 'ver-pending' },
    body: 'pending body',
  });
  await Promise.all([firstBody, joinedBody]);
  expect(useTaskArtifactStore.getState().bodyByVersion['ver-pending']).toBe('pending body');
});

it('records structural/human checks and accepts only the current version', async () => {
  vi.mocked(api.listTaskArtifacts).mockResolvedValue({ artifacts: [] } as never);
  vi.mocked(api.listTaskArtifactVersions).mockResolvedValue({ versions: [] } as never);
  vi.mocked(api.listTaskArtifactFeedback).mockResolvedValue({ feedback: [] } as never);
  vi.mocked(api.listTaskArtifactChecks).mockResolvedValue({ checks: [] } as never);
  vi.mocked(api.listTaskArtifactAcceptances).mockResolvedValue({ acceptances: [] } as never);
  vi.mocked(api.recordTaskArtifactCheck)
    .mockResolvedValueOnce({
      check: { checkId: 'chk-struct', result: 1, checkType: 1 },
    } as never)
    .mockResolvedValueOnce({
      check: { checkId: 'chk-human', result: 1, checkType: 2 },
    } as never);
  vi.mocked(api.acceptTaskArtifactVersion).mockResolvedValue({
    acceptance: { acceptanceId: 'acc-1', artifactId: 'art-1', versionId: 'ver-1', current: true },
  } as never);

  const store = useTaskArtifactStore.getState();
  const structural = await store.recordStructuralCheck('art-1', 'ver-1', '# body\nline');
  expect(structural.checkId).toBe('chk-struct');
  expect(api.recordTaskArtifactCheck).toHaveBeenNthCalledWith(1, expect.objectContaining({
    checkType: 'ARTIFACT_CHECK_TYPE_STRUCTURAL',
    result: 'ARTIFACT_CHECK_RESULT_PASSED',
  }));

  const human = await store.recordHumanReview('art-1', 'ver-1', true);
  expect(human.checkId).toBe('chk-human');

  const accepted = await store.acceptCurrent('art-1', 'ver-1');
  expect(accepted.acceptance?.current).toBe(true);
});

it('re-reads current version and throws ArtifactStaleBaseError on a 409 human edit', async () => {
  // The editor loaded ver-1; another revision advanced current to ver-2.
  const conflict = Object.assign(
    new Error('artifact base version is stale; current_version_id=ver-2'),
    { code: 'CONFLICT' },
  );
  vi.mocked(api.claimTaskArtifactVersion).mockRejectedValueOnce(conflict as never);

  // Readback returns the artifact now pointing at ver-2.
  vi.mocked(api.listTaskArtifacts).mockResolvedValue({
    artifacts: [{ ...artifactResponse().artifact, currentVersionId: 'ver-2', currentSeq: 2 }],
  } as never);
  vi.mocked(api.listTaskArtifactVersions).mockResolvedValue({
    versions: [
      artifactResponse().version,
      { ...artifactResponse().version, versionId: 'ver-2', seq: 2, parentVersionId: 'ver-1' },
    ],
  } as never);
  vi.mocked(api.getTaskArtifactVersionBody).mockResolvedValue({
    version: { ...artifactResponse().version, versionId: 'ver-2', seq: 2 },
    body: '# Site study (revised)',
  } as never);

  const store = useTaskArtifactStore.getState();
  vi.mocked(api.claimTaskArtifactVersion).mockClear();
  vi.mocked(api.listTaskArtifacts).mockClear();
  vi.mocked(api.listTaskArtifactVersions).mockClear();
  let caught: unknown;
  try {
    await store.saveHumanEdit({
      conversationId,
      artifactId: 'art-1',
      expectedBaseVersionId: 'ver-1',
      body: 'my conflicting edit',
    });
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(ArtifactStaleBaseError);
  expect((caught as ArtifactStaleBaseError).currentVersionId).toBe('ver-2');

  // Exactly one claim attempt; no fabricated success version.
  expect(api.claimTaskArtifactVersion).toHaveBeenCalledTimes(1);
  // The store re-read both the artifact list and its detail (current version).
  expect(api.listTaskArtifacts).toHaveBeenCalled();
  expect(api.listTaskArtifactVersions).toHaveBeenCalledWith('art-1');
});
