import { afterEach, describe, expect, it } from 'vitest';
import {
  clearAtelierArtifactPreviewHostSessions,
  getAtelierArtifactPreviewHostSession,
  handleAtelierArtifactPreviewHostUiRequest,
  recordAtelierArtifactPreviewHostSession,
} from './AtelierArtifactPreviewHost';

describe('AtelierArtifactPreviewHost', () => {
  afterEach(() => {
    clearAtelierArtifactPreviewHostSessions();
  });

  it('records Host-owned sandbox renderer sessions without raw render targets', () => {
    const result = handleAtelierArtifactPreviewHostUiRequest({
      action: 'openAtelierArtifactPreview',
      returnsResult: false,
      params: {
        taskId: 'task-1',
        artifactId: 'artifact-1',
        sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
        bodyRef: 'artifact://task-1/artifact-1/body',
        rendererSessionId: 'atelier-preview:task-1:artifact-1',
        rendererOwner: 'desktop_host',
        rendererMode: 'host_sandbox_manifest',
        rendererStatus: 'rendered',
        rendererCapabilities: ['host_owned_renderer_session', 'host_visual_renderer_surface'],
      },
    }, { now: () => 1234 });

    expect(result).toMatchObject({
      ok: true,
      accepted: true,
      opened: true,
      prepared: true,
      rendererStatus: 'rendered',
      rendererCapabilities: ['host_owned_renderer_session', 'host_visual_renderer_surface'],
      session: {
        taskId: 'task-1',
        artifactId: 'artifact-1',
        sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
        bodyRef: 'artifact://task-1/artifact-1/body',
        rendererSessionId: 'atelier-preview:task-1:artifact-1',
        rendererOwner: 'desktop_host',
        rendererMode: 'host_sandbox_manifest',
        rendererStatus: 'rendered',
        rendererCapabilities: ['host_owned_renderer_session', 'host_visual_renderer_surface'],
        recordedAt: 1234,
      },
    });
    expect(getAtelierArtifactPreviewHostSession('atelier-preview:task-1:artifact-1')).toMatchObject({
      rendererOwner: 'desktop_host',
      rendererMode: 'host_sandbox_manifest',
      rendererStatus: 'rendered',
    });
  });

  it('rejects raw render fields and non-Host preview modes', () => {
    expect(recordAtelierArtifactPreviewHostSession({
      taskId: 'task-1',
      artifactId: 'artifact-1',
      sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
      bodyRef: 'artifact://task-1/artifact-1/body',
      rendererSessionId: 'atelier-preview:task-1:artifact-1',
      rendererOwner: 'desktop_host',
      rendererMode: 'host_sandbox_manifest',
      rendererStatus: 'rendered',
      rendererCapabilities: ['host_owned_renderer_session'],
      url: 'https://example.invalid/raw-preview',
    })).toEqual({
      ok: false,
      reason: 'Atelier artifact preview Host adapter rejects raw render field: url',
    });

    expect(recordAtelierArtifactPreviewHostSession({
      taskId: 'task-1',
      artifactId: 'artifact-1',
      sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
      bodyRef: 'artifact://task-1/artifact-1/body',
      rendererSessionId: 'atelier-preview:task-1:artifact-1',
      rendererOwner: 'desktop_host',
      rendererMode: 'iframe',
      rendererStatus: 'rendered',
      rendererCapabilities: ['host_owned_renderer_session'],
    })).toEqual({
      ok: false,
      reason: 'Atelier artifact preview Host adapter only accepts host_sandbox_manifest mode',
    });

    expect(getAtelierArtifactPreviewHostSession('atelier-preview:task-1:artifact-1')).toBeUndefined();
  });

  it('rejects preview sessions missing contract-required renderer capabilities', () => {
    expect(recordAtelierArtifactPreviewHostSession({
      taskId: 'task-1',
      artifactId: 'artifact-1',
      sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
      bodyRef: 'artifact://task-1/artifact-1/body',
      rendererSessionId: 'atelier-preview:task-1:artifact-1',
      rendererOwner: 'desktop_host',
      rendererMode: 'host_sandbox_manifest',
      rendererStatus: 'rendered',
      rendererCapabilities: ['host_owned_renderer_session'],
    })).toEqual({
      ok: false,
      reason: 'Atelier artifact preview Host adapter requires contract renderer capabilities',
    });

    expect(getAtelierArtifactPreviewHostSession('atelier-preview:task-1:artifact-1')).toBeUndefined();
  });

    it('rejects non-canonical sandbox and body refs', () => {
      expect(recordAtelierArtifactPreviewHostSession({
        taskId: 'task-1',
        artifactId: 'artifact-1',
        sandboxRef: 'atelier-sandbox://task 1/artifact-1/preview',
        bodyRef: 'artifact://task-1/artifact-1/body',
        rendererSessionId: 'atelier-preview:task-1:artifact-1',
        rendererOwner: 'desktop_host',
        rendererMode: 'host_sandbox_manifest',
        rendererStatus: 'rendered',
        rendererCapabilities: ['host_owned_renderer_session'],
      })).toEqual({
        ok: false,
        reason: 'Atelier artifact preview Host adapter only accepts canonical atelier-sandbox:// refs',
      });

      expect(recordAtelierArtifactPreviewHostSession({
        taskId: 'task-1',
        artifactId: 'artifact-1',
        sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
        bodyRef: 'artifact://task-1/artifact 1/body',
        rendererSessionId: 'atelier-preview:task-1:artifact-1',
        rendererOwner: 'desktop_host',
        rendererMode: 'host_sandbox_manifest',
        rendererStatus: 'rendered',
        rendererCapabilities: ['host_owned_renderer_session'],
      })).toEqual({
        ok: false,
        reason: 'Atelier artifact preview Host adapter only accepts canonical artifact:// body refs',
      });

      expect(getAtelierArtifactPreviewHostSession('atelier-preview:task-1:artifact-1')).toBeUndefined();
    });

  it('ignores unrelated Host UI commands', () => {
    expect(handleAtelierArtifactPreviewHostUiRequest({
      action: 'showToast',
      params: { text: 'Hello' },
      returnsResult: false,
    })).toBeNull();
  });
});
