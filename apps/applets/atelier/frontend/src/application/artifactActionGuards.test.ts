import { describe, expect, it } from 'vitest';
import type { AtelierArtifactProjection } from '../domain/projection';
import {
  buildAtelierArtifactBodyFetchIntent,
  buildAtelierArtifactPreviewOpenIntent,
  isCanonicalAtelierArtifactBodyRef,
  isCanonicalAtelierSandboxRef,
  isCurrentAtelierArtifactRequest,
} from './artifactActionGuards';

function artifact(overrides: Partial<AtelierArtifactProjection> = {}): AtelierArtifactProjection {
  return {
    id: 'artifact-1',
    name: 'Artifact',
    bodyRef: 'artifact://task-1/artifact-1/body',
    bodyHash: 'sha256:abc',
    previewTarget: {
      sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
      bodyRef: 'artifact://task-1/artifact-1/body',
      mode: 'sandbox_manifest',
    },
    ...overrides,
  };
}

describe('artifact action guards', () => {
  it('builds canonical artifact body fetch intents without exposing body data', () => {
    expect(buildAtelierArtifactBodyFetchIntent({
      taskId: ' task-1 ',
      artifact: artifact({ id: ' artifact-1 ' }),
      pendingKey: '',
    })).toEqual({
      status: 'ready',
      intent: {
        key: 'task-1:artifact-1',
        taskId: 'task-1',
        artifactId: 'artifact-1',
        bodyRef: 'artifact://task-1/artifact-1/body',
        expectedHash: 'sha256:abc',
      },
    });
  });

  it('blocks body fetch when identity fields are missing or another fetch is pending', () => {
    expect(buildAtelierArtifactBodyFetchIntent({ taskId: '', artifact: artifact(), pendingKey: '' })).toEqual({ status: 'blocked' });
    expect(buildAtelierArtifactBodyFetchIntent({ taskId: 'task-1', artifact: artifact({ id: '' }), pendingKey: '' })).toEqual({ status: 'blocked' });
    expect(buildAtelierArtifactBodyFetchIntent({ taskId: 'task-1', artifact: artifact(), pendingKey: 'task-1:artifact-1' })).toEqual({ status: 'blocked' });
  });

  it('rejects non-canonical artifact body refs before Host invoke', () => {
    expect(isCanonicalAtelierArtifactBodyRef('artifact://task-1/artifact-1/body')).toBe(true);
    expect(isCanonicalAtelierArtifactBodyRef('artifact://task 1/artifact-1/body')).toBe(false);
    expect(isCanonicalAtelierArtifactBodyRef('artifact://task-1/artifact-1/raw')).toBe(false);
    expect(buildAtelierArtifactBodyFetchIntent({
      taskId: 'task-1',
      artifact: artifact({ bodyRef: 'artifact://task 1/artifact-1/body' }),
      pendingKey: '',
    })).toEqual({ status: 'invalid' });
  });

  it('builds preview-open intents from generated ref and mode taxonomy', () => {
    expect(buildAtelierArtifactPreviewOpenIntent({
      taskId: ' task-1 ',
      artifact: artifact({
        id: ' artifact-1 ',
        previewTarget: {
          sandboxRef: ' atelier-sandbox://task-1/artifact-1/preview ',
          bodyRef: ' artifact://task-1/artifact-1/body ',
          mode: '',
          kind: 'web',
        },
      }),
      pendingKey: '',
    })).toEqual({
      status: 'ready',
      intent: {
        key: 'task-1:artifact-1',
        taskId: 'task-1',
        artifactId: 'artifact-1',
        sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
        bodyRef: 'artifact://task-1/artifact-1/body',
        kind: 'web',
        mode: 'sandbox_manifest',
      },
    });
  });

  it('rejects malformed preview targets and falls back to artifact body ref only when preview body ref is absent', () => {
    expect(isCanonicalAtelierSandboxRef('atelier-sandbox://task-1/artifact-1/preview')).toBe(true);
    expect(isCanonicalAtelierSandboxRef('atelier-sandbox://task-1/artifact 1/preview')).toBe(false);
    expect(buildAtelierArtifactPreviewOpenIntent({
      taskId: 'task-1',
      artifact: artifact({ previewTarget: { sandboxRef: 'atelier-sandbox://task-1/artifact 1/preview', bodyRef: 'artifact://task-1/artifact-1/body', mode: 'sandbox_manifest' } }),
      pendingKey: '',
    })).toEqual({ status: 'invalid' });
    expect(buildAtelierArtifactPreviewOpenIntent({
      taskId: 'task-1',
      artifact: artifact({ previewTarget: { sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview', bodyRef: 'artifact://task-1/artifact-1/body', mode: 'raw_url' } }),
      pendingKey: '',
    })).toEqual({ status: 'invalid' });
    expect(buildAtelierArtifactPreviewOpenIntent({
      taskId: 'task-1',
      artifact: artifact({ previewTarget: { kind: 'html', sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview', bodyRef: 'artifact://task-1/artifact-1/body', mode: 'sandbox_manifest' } }),
      pendingKey: '',
    })).toEqual({ status: 'invalid' });
    expect(buildAtelierArtifactPreviewOpenIntent({
      taskId: 'task-1',
      artifact: artifact({ bodyRef: 'artifact://task-1/artifact-1/body', previewTarget: { sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview', mode: 'sandbox_manifest' } }),
      pendingKey: '',
    })).toMatchObject({
      status: 'ready',
      intent: { bodyRef: 'artifact://task-1/artifact-1/body' },
    });
  });

  it('accepts only current artifact request ownership tokens', () => {
    expect(isCurrentAtelierArtifactRequest({
      currentSeq: 2,
      requestSeq: 2,
      currentPendingKey: 'task-1:artifact-1',
      expectedPendingKey: 'task-1:artifact-1',
    })).toBe(true);
    expect(isCurrentAtelierArtifactRequest({
      currentSeq: 3,
      requestSeq: 2,
      currentPendingKey: 'task-1:artifact-1',
      expectedPendingKey: 'task-1:artifact-1',
    })).toBe(false);
    expect(isCurrentAtelierArtifactRequest({
      currentSeq: 2,
      requestSeq: 2,
      currentPendingKey: 'task-1:artifact-2',
      expectedPendingKey: 'task-1:artifact-1',
    })).toBe(false);
  });
});
