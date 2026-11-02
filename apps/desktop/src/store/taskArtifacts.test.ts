import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { api } from '../services/desktop_api';
import { useTaskArtifactStore } from './taskArtifacts';

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
  }));
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
