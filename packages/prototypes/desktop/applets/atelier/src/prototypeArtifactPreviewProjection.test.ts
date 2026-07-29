import { describe, expect, it } from 'vitest';
import {
  ATELIER_ARTIFACT_PREVIEW_OPEN_DEFAULT_MODE,
  ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_MODES,
  ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_OWNERS,
  ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_STATUSES,
  ATELIER_PROJECTION_CONTRACT,
  ATELIER_PROJECTION_DISPLAY_LIMITS,
} from './projection.contract.generated';
import {
  buildPrototypeArtifactBodyFetchIntent,
  buildPrototypeArtifactBodyFetchResponse,
  buildPrototypeArtifactPreviewRequestKey,
  buildPrototypeArtifactPreviewOpenIntent,
  buildPrototypeArtifactPreviewOpenResponse,
  derivePrototypeArtifactMetadataPreviewView,
  derivePrototypeArtifactPreviewCapabilityView,
  derivePrototypeArtifactTrayItemView,
  prototypeArtifactBodyFetchErrorStatus,
  prototypeArtifactLogTone,
  prototypeArtifactPreviewOpenErrorStatus,
  shouldApplyPrototypeArtifactPreviewResponse,
} from './prototypeArtifactPreviewProjection';
import type { Artifact } from './types';

function artifact(input: Partial<Artifact> = {}): Artifact {
  return {
    id: 'artifact-1',
    name: 'Artifact',
    kind: 'markdown',
    meta: 'Station metadata',
    ...input,
  };
}

describe('prototypeArtifactPreviewProjection', () => {
  it('marks active tray artifacts and keeps diff cards metadata-only without synthetic patch stats', () => {
    expect(derivePrototypeArtifactTrayItemView({
      artifact: artifact({ id: 'diff-1', kind: 'diff' }),
      openId: 'diff-1',
    })).toEqual({
      glyph: '⊟',
      active: true,
      metadataBadge: 'metadata-only',
    });
  });

  it('uses generated artifact path display limits for metadata preview paths', () => {
    const limit = ATELIER_PROJECTION_DISPLAY_LIMITS.artifactPaths;
    const paths = Array.from({ length: limit + 2 }, (_, index) => `src/file-${index}.ts`);

    expect(derivePrototypeArtifactMetadataPreviewView(artifact({ kind: 'diff', paths }))).toMatchObject({
      visiblePaths: paths.slice(0, limit),
      hiddenPathCount: 2,
      showPaths: true,
    });
  });

  it('does not synthesize safe body or sandbox refs when Station projection omits them', () => {
    expect(derivePrototypeArtifactPreviewCapabilityView(artifact())).toEqual({
      bodyRef: '',
      previewSandboxRef: '',
      previewBodyRef: '',
      canFetchSafeBody: false,
      canOpenSandboxPreview: false,
    });
  });

  it('projects Host safe text and sandbox manifest affordances from Station metadata only', () => {
    expect(derivePrototypeArtifactPreviewCapabilityView(artifact({
      bodyRef: 'artifact://task-1/artifact-1/body',
      previewTarget: {
        mode: 'sandbox_manifest',
        sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
        bodyRef: 'artifact://task-1/artifact-1/body',
      },
    }))).toMatchObject({
      bodyRef: 'artifact://task-1/artifact-1/body',
      previewSandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
      previewBodyRef: 'artifact://task-1/artifact-1/body',
      canFetchSafeBody: true,
      canOpenSandboxPreview: true,
    });
  });

  it('maps mock console log levels to display tones without proving real Run runtime logs', () => {
    expect(prototypeArtifactLogTone('error')).toBe('danger');
    expect(prototypeArtifactLogTone('warn')).toBe('warning');
    expect(prototypeArtifactLogTone('info')).toBe('muted');
    expect(prototypeArtifactLogTone('debug')).toBe('default');
  });

  it('keys preview requests by Station-projected artifact refs and rejects stale responses', () => {
    const currentKey = buildPrototypeArtifactPreviewRequestKey({
      taskId: ' task-1 ',
      artifact: artifact({
        id: 'artifact-1',
        bodyHash: 'sha256:new',
        bodyRef: 'artifact://task-1/artifact-1/body-new',
        previewTarget: {
          kind: 'web',
          mode: 'sandbox_manifest',
          sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview-new',
          bodyRef: 'artifact://task-1/artifact-1/body-new',
        },
      }),
    });
    const staleKey = buildPrototypeArtifactPreviewRequestKey({
      taskId: 'task-1',
      artifact: artifact({
        id: 'artifact-1',
        bodyHash: 'sha256:old',
        bodyRef: 'artifact://task-1/artifact-1/body-old',
      }),
    });

    expect(currentKey).toContain('sha256:new');
    expect(currentKey).toContain('atelier-sandbox://task-1/artifact-1/preview-new');
    expect(shouldApplyPrototypeArtifactPreviewResponse({ currentRequestKey: currentKey, responseRequestKey: currentKey })).toBe(true);
    expect(shouldApplyPrototypeArtifactPreviewResponse({ currentRequestKey: currentKey, responseRequestKey: staleKey })).toBe(false);
    expect(shouldApplyPrototypeArtifactPreviewResponse({ currentRequestKey: currentKey, responseRequestKey: '' })).toBe(false);
  });

  it('normalizes preview request error copy without execution payloads', () => {
    expect(prototypeArtifactBodyFetchErrorStatus(new Error('body unavailable'))).toBe('body unavailable');
    expect(prototypeArtifactBodyFetchErrorStatus('opaque')).toBe('Artifact body fetch unavailable');
    expect(prototypeArtifactPreviewOpenErrorStatus(new Error('preview unavailable'))).toBe('preview unavailable');
    expect(prototypeArtifactPreviewOpenErrorStatus(undefined)).toBe('Artifact sandbox preview unavailable');
    expect([
      prototypeArtifactBodyFetchErrorStatus('opaque'),
      prototypeArtifactPreviewOpenErrorStatus(undefined),
    ].join(' ')).not.toMatch(/provider\.invoke|runtime\.execute|shell|gate\.run|file\.open/);
  });

  it('builds ref-only safe body fetch intents from Station projection metadata', () => {
    expect(buildPrototypeArtifactBodyFetchIntent({
      taskId: ' task-1 ',
      artifact: artifact({
        id: 'artifact-1',
        bodyHash: 'sha256:body',
        bodyRef: 'artifact://task-1/artifact-1/body',
      }),
    })).toEqual({
      status: 'fetchBody',
      input: {
        taskId: 'task-1',
        artifactId: 'artifact-1',
        bodyRef: 'artifact://task-1/artifact-1/body',
        expectedHash: 'sha256:body',
      },
    });
  });

  it('rejects safe body fetch intent when Station projection omits bodyRef', () => {
    expect(buildPrototypeArtifactBodyFetchIntent({
      taskId: 'task-1',
      artifact: artifact(),
    })).toEqual({
      status: 'invalid',
      reason: 'missing-station-body-ref',
    });
  });

  it('builds ref-only sandbox preview open intents without raw renderer fields', () => {
    const intent = buildPrototypeArtifactPreviewOpenIntent({
      taskId: ' task-1 ',
      artifact: artifact({
        id: 'artifact-1',
        kind: 'web',
        previewTarget: {
          kind: 'web',
          mode: 'sandbox_manifest',
          sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
          bodyRef: 'artifact://task-1/artifact-1/body',
        },
      }),
    });

    expect(intent).toEqual({
      status: 'openPreview',
      input: {
        taskId: 'task-1',
        artifactId: 'artifact-1',
        sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
        bodyRef: 'artifact://task-1/artifact-1/body',
        kind: 'web',
        mode: 'sandbox_manifest',
      },
    });
    expect(JSON.stringify(intent)).not.toMatch(/iframe|html|src|url|file|path|execute|run/);
  });

  it('rejects sandbox preview open intent when Station projection omits preview refs', () => {
    expect(buildPrototypeArtifactPreviewOpenIntent({
      taskId: 'task-1',
      artifact: artifact({ previewTarget: { kind: 'web' } }),
    })).toEqual({
      status: 'invalid',
      reason: 'missing-station-preview-target',
    });
    expect(buildPrototypeArtifactPreviewOpenIntent({
      taskId: 'task-1',
      artifact: artifact({
        previewTarget: {
          kind: 'html',
          mode: 'sandbox_manifest',
          sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
          bodyRef: 'artifact://task-1/artifact-1/body',
        },
      }),
    })).toEqual({
      status: 'invalid',
      reason: 'missing-station-preview-target',
    });
  });

  it('builds prototype safe body responses from Station-projected safe text metadata', () => {
    expect(buildPrototypeArtifactBodyFetchResponse({
      request: {
        taskId: 'task-1',
        artifactId: 'artifact-1',
        bodyRef: 'artifact://task-1/artifact-1/body',
        expectedHash: 'sha256:body',
      },
      artifact: artifact({
        bodyKind: 'markdown',
        markdown: 'Safe projected markdown',
      } as Partial<Artifact>),
    })).toEqual({
      taskId: 'task-1',
      artifactId: 'artifact-1',
      bodyRef: 'artifact://task-1/artifact-1/body',
      bodyKind: 'markdown',
      bodyHash: 'sha256:body',
      bodySize: new TextEncoder().encode('Safe projected markdown').length,
      text: 'Safe projected markdown',
      truncated: false,
      retentionStatus: 'active',
    });
  });

  it('uses diff path refs as prototype safe text without exposing patch apply affordances', () => {
    const response = buildPrototypeArtifactBodyFetchResponse({
      request: {
        taskId: 'task-1',
        artifactId: 'diff-1',
        bodyRef: 'artifact://task-1/diff-1/body',
      },
      artifact: artifact({
        id: 'diff-1',
        kind: 'diff',
        paths: ['src/a.ts', 'src/b.ts'],
      }),
    });

    expect(response).toMatchObject({
      bodyKind: 'diff',
      bodyHash: 'sha256:prototype',
      text: 'src/a.ts\nsrc/b.ts',
      truncated: false,
      retentionStatus: 'active',
    });
    expect(JSON.stringify(response)).not.toMatch(/patch\.apply|runtime\.execute|provider\.invoke|shell/);
  });

  it('truncates prototype safe body responses by positive request maxBytes', () => {
    expect(buildPrototypeArtifactBodyFetchResponse({
      request: {
        taskId: 'task-1',
        artifactId: 'artifact-1',
        bodyRef: 'artifact://task-1/artifact-1/body',
        maxBytes: 4,
      },
      artifact: artifact({
        markdown: 'abcdef',
      } as Partial<Artifact>),
    })).toMatchObject({
      bodySize: 6,
      text: 'abcd',
      truncated: true,
    });
  });

  it('falls back to bounded prototype safe text when artifact metadata is missing', () => {
    expect(buildPrototypeArtifactBodyFetchResponse({
      request: {
        taskId: 'task-1',
        artifactId: 'missing-artifact',
        bodyRef: 'artifact://task-1/missing-artifact/body',
        maxBytes: 0,
      },
    })).toMatchObject({
      bodyKind: 'markdown',
      bodyHash: 'sha256:prototype',
      text: 'Prototype artifact body is exposed as safe text through Host capability.',
      truncated: false,
      retentionStatus: 'active',
    });
  });

  it('builds Host sandbox preview responses from generated renderer contract metadata', () => {
    const response = buildPrototypeArtifactPreviewOpenResponse({
      taskId: 'task-1',
      artifactId: 'artifact-1',
      sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
      bodyRef: 'artifact://task-1/artifact-1/body',
      kind: 'web',
    });

    expect(response).toEqual({
      accepted: true,
      opened: true,
      prepared: true,
      taskId: 'task-1',
      artifactId: 'artifact-1',
      sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
      bodyRef: 'artifact://task-1/artifact-1/body',
      kind: 'web',
      mode: ATELIER_ARTIFACT_PREVIEW_OPEN_DEFAULT_MODE,
      rendererSessionId: 'atelier-preview:task-1:artifact-1',
      rendererOwner: ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_OWNERS[0],
      rendererMode: ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_MODES[0],
      rendererStatus: ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_STATUSES.includes('rendered')
        ? 'rendered'
        : ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_STATUSES[0],
      rendererCapabilities: [
        'sandbox_manifest_validation',
        'artifact_body_binding',
        'host_owned_renderer_session',
        ...ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].requiredRendererCapabilities,
      ],
      reason: 'Prototype records the Host-owned sandbox renderer surface descriptor; official applet still does not iframe/img/html-render artifact bodies.',
    });

    const structuredPayload = {
      ...response,
      reason: undefined,
    };
    expect(JSON.stringify(structuredPayload)).not.toMatch(/rawUrl|iframeSrc|htmlSource|filePath|patch\.apply|runtime\.execute|provider\.invoke|shell/);
  });
});
