import { afterEach, describe, expect, it } from 'vitest';
import {
  buildAtelierArtifactPreviewHostSurface,
  clearAtelierArtifactPreviewHostSessions,
  getAtelierArtifactPreviewHostSession,
  handleAtelierArtifactPreviewHostUiRequest,
  recordAtelierArtifactPreviewHostSession,
  renderAtelierDiffPreviewHostRuntime,
  renderAtelierImagePreviewHostRuntime,
  renderAtelierMarkdownPreviewHostRuntime,
  renderAtelierWebPreviewHostRuntime,
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
      surface: {
        surfaceKind: 'host_sandbox_visual_surface',
        rendererKind: 'metadata',
        rendererOwner: 'desktop_host',
        rendererMode: 'host_sandbox_manifest',
        rawBodyExposedToApplet: false,
        appletRenderable: false,
      },
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
        surface: {
          surfaceKind: 'host_sandbox_visual_surface',
          rendererKind: 'metadata',
          rawBodyExposedToApplet: false,
          appletRenderable: false,
        },
        recordedAt: 1234,
      },
    });
    expect(getAtelierArtifactPreviewHostSession('atelier-preview:task-1:artifact-1')).toMatchObject({
      rendererOwner: 'desktop_host',
      rendererMode: 'host_sandbox_manifest',
      rendererStatus: 'rendered',
    });
  });

  it('builds Host-owned renderer surfaces for rich preview kinds without applet-renderable raw bodies', () => {
    for (const kind of ['markdown', 'web', 'image', 'diff'] as const) {
      const surface = buildAtelierArtifactPreviewHostSurface({
        kind,
        rendererSessionId: `atelier-preview:task-1:${kind}`,
        rendererOwner: 'desktop_host',
        rendererMode: 'host_sandbox_manifest',
        sandboxRef: `atelier-sandbox://task-1/${kind}/preview`,
        bodyRef: `artifact://task-1/${kind}/body`,
      });

      expect(surface).toMatchObject({
        surfaceKind: 'host_sandbox_visual_surface',
        rendererKind: kind,
        rendererOwner: 'desktop_host',
        rendererMode: 'host_sandbox_manifest',
        rawBodyExposedToApplet: false,
        appletRenderable: false,
        sandboxPolicy: {
          allowScripts: false,
          allowNetwork: false,
          allowExternalNavigation: false,
          allowFileAccess: false,
          allowPatchApply: false,
        },
      });
      expect(JSON.stringify(surface)).not.toContain('iframe');
      expect(JSON.stringify(surface)).not.toContain('url');
      expect(JSON.stringify(surface)).not.toContain('src');
    }
  });

  it('renders markdown through Host-owned metadata-only runtime evidence without exposing raw body', () => {
    const surface = buildAtelierArtifactPreviewHostSurface({
      kind: 'markdown',
      rendererSessionId: 'atelier-preview:task-1:artifact-1',
      rendererOwner: 'desktop_host',
      rendererMode: 'host_sandbox_manifest',
      sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
      bodyRef: 'artifact://task-1/artifact-1/body',
    });

    const result = renderAtelierMarkdownPreviewHostRuntime({
      surface,
      safeText: [
        '# Gate report',
        '- failed check',
        '```',
        'safe code',
        '```',
        '<script>alert(1)</script>',
        '<img src="https://example.invalid/x.png">',
        '![diagram](https://example.invalid/diagram.png)',
        '[external](https://example.invalid)',
      ].join('\n'),
    });

    expect(result).toMatchObject({
      ok: true,
      rendererKind: 'markdown',
      rendererOwner: 'desktop_host',
      rendererMode: 'host_sandbox_manifest',
      surfaceKind: 'host_sandbox_visual_surface',
      rawBodyExposedToApplet: false,
      appletRenderable: false,
      sourceLineCount: 9,
      renderedLineCount: 9,
      renderedBlockKinds: ['heading', 'list', 'code', 'paragraph'],
      blockedScriptTagCount: 2,
      blockedImageRefCount: 1,
      blockedLinkRefCount: 1,
      sandboxPolicy: {
        allowScripts: false,
        allowNetwork: false,
        allowExternalNavigation: false,
        allowFileAccess: false,
        allowPatchApply: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain('Gate report');
    expect(JSON.stringify(result)).not.toContain('safe code');
    expect(JSON.stringify(result)).not.toContain('https://example.invalid');
  });

  it('rejects markdown runtime rendering for non-markdown surfaces', () => {
    const surface = buildAtelierArtifactPreviewHostSurface({
      kind: 'image',
      rendererSessionId: 'atelier-preview:task-1:artifact-1',
      rendererOwner: 'desktop_host',
      rendererMode: 'host_sandbox_manifest',
      sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
      bodyRef: 'artifact://task-1/artifact-1/body',
    });

    expect(renderAtelierMarkdownPreviewHostRuntime({
      surface,
      safeText: '# Should not render',
    })).toMatchObject({
      ok: false,
      reason: 'Atelier markdown Host renderer requires a markdown preview surface.',
      rawBodyExposedToApplet: false,
      appletRenderable: false,
    });
  });

  it('renders diff through Host-owned metadata-only runtime evidence without exposing raw patch text', () => {
    const surface = buildAtelierArtifactPreviewHostSurface({
      kind: 'diff',
      rendererSessionId: 'atelier-preview:task-1:artifact-1',
      rendererOwner: 'desktop_host',
      rendererMode: 'host_sandbox_manifest',
      sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
      bodyRef: 'artifact://task-1/artifact-1/body',
    });

    const result = renderAtelierDiffPreviewHostRuntime({
      surface,
      safeText: [
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1,2 +1,3 @@',
        '-const stale = true;',
        '+const current = true;',
        '+const verified = true;',
        ' context',
        'Binary files a/logo.png and b/logo.png differ',
      ].join('\n'),
    });

    expect(result).toMatchObject({
      ok: true,
      rendererKind: 'diff',
      rendererOwner: 'desktop_host',
      rendererMode: 'host_sandbox_manifest',
      surfaceKind: 'host_sandbox_visual_surface',
      rawDiffExposedToApplet: false,
      appletRenderable: false,
      patchApplyAllowed: false,
      sourceLineCount: 9,
      fileCount: 2,
      hunkCount: 1,
      additionCount: 2,
      deletionCount: 1,
      binaryPatchCount: 1,
      sandboxPolicy: {
        allowScripts: false,
        allowNetwork: false,
        allowExternalNavigation: false,
        allowFileAccess: false,
        allowPatchApply: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain('stale');
    expect(JSON.stringify(result)).not.toContain('current');
    expect(JSON.stringify(result)).not.toContain('src/a.ts');
    expect(JSON.stringify(result)).not.toContain('logo.png');
  });

  it('rejects diff runtime rendering for non-diff surfaces', () => {
    const surface = buildAtelierArtifactPreviewHostSurface({
      kind: 'markdown',
      rendererSessionId: 'atelier-preview:task-1:artifact-1',
      rendererOwner: 'desktop_host',
      rendererMode: 'host_sandbox_manifest',
      sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
      bodyRef: 'artifact://task-1/artifact-1/body',
    });

    expect(renderAtelierDiffPreviewHostRuntime({
      surface,
      safeText: 'diff --git a/a b/a',
    })).toMatchObject({
      ok: false,
      reason: 'Atelier diff Host renderer requires a diff preview surface.',
      rawDiffExposedToApplet: false,
      appletRenderable: false,
      patchApplyAllowed: false,
    });
  });

  it('renders web previews through Host-owned metadata-only runtime evidence without exposing raw HTML', () => {
    const surface = buildAtelierArtifactPreviewHostSurface({
      kind: 'web',
      rendererSessionId: 'atelier-preview:task-1:artifact-1',
      rendererOwner: 'desktop_host',
      rendererMode: 'host_sandbox_manifest',
      sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
      bodyRef: 'artifact://task-1/artifact-1/body',
    });

    const result = renderAtelierWebPreviewHostRuntime({
      surface,
      safeHtml: [
        '<section onclick="steal()">',
        '<script>alert(1)</script>',
        '<iframe src="https://example.invalid/frame"></iframe>',
        '<a href="file:///tmp/leak">leak</a>',
        '<img src="data:image/png;base64,raw">',
        '</section>',
      ].join('\n'),
    });

    expect(result).toMatchObject({
      ok: true,
      rendererKind: 'web',
      rendererOwner: 'desktop_host',
      rendererMode: 'host_sandbox_manifest',
      surfaceKind: 'host_sandbox_visual_surface',
      rawHtmlExposedToApplet: false,
      appletRenderable: false,
      sourceLineCount: 6,
      blockedScriptTagCount: 2,
      blockedIframeTagCount: 2,
      blockedExternalUrlCount: 3,
      blockedInlineEventHandlerCount: 1,
      sandboxPolicy: {
        allowScripts: false,
        allowNetwork: false,
        allowExternalNavigation: false,
        allowFileAccess: false,
        allowPatchApply: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain('steal');
    expect(JSON.stringify(result)).not.toContain('example.invalid');
    expect(JSON.stringify(result)).not.toContain('file:///tmp');
    expect(JSON.stringify(result)).not.toContain('data:image');
  });

  it('rejects web runtime rendering for non-web surfaces', () => {
    const surface = buildAtelierArtifactPreviewHostSurface({
      kind: 'markdown',
      rendererSessionId: 'atelier-preview:task-1:artifact-1',
      rendererOwner: 'desktop_host',
      rendererMode: 'host_sandbox_manifest',
      sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
      bodyRef: 'artifact://task-1/artifact-1/body',
    });

    expect(renderAtelierWebPreviewHostRuntime({
      surface,
      safeHtml: '<script>alert(1)</script>',
    })).toMatchObject({
      ok: false,
      reason: 'Atelier web Host renderer requires a web preview surface.',
      rawHtmlExposedToApplet: false,
      appletRenderable: false,
    });
  });

  it('renders image previews through Host-owned metadata-only runtime evidence without exposing raw image bytes', () => {
    const surface = buildAtelierArtifactPreviewHostSurface({
      kind: 'image',
      rendererSessionId: 'atelier-preview:task-1:artifact-1',
      rendererOwner: 'desktop_host',
      rendererMode: 'host_sandbox_manifest',
      sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
      bodyRef: 'artifact://task-1/artifact-1/body',
    });

    const result = renderAtelierImagePreviewHostRuntime({
      surface,
      metadata: {
        mime: 'image/png',
        size: 2048,
        sha256: 'sha256:imagehash',
        width: 640,
        height: 480,
      },
    });

    expect(result).toMatchObject({
      ok: true,
      rendererKind: 'image',
      rendererOwner: 'desktop_host',
      rendererMode: 'host_sandbox_manifest',
      surfaceKind: 'host_sandbox_visual_surface',
      rawImageBytesExposedToApplet: false,
      appletRenderable: false,
      mime: 'image/png',
      size: 2048,
      sha256: 'sha256:imagehash',
      width: 640,
      height: 480,
      forbiddenRawFields: ['path', 'url', 'src', 'base64', 'bytes'],
      sandboxPolicy: {
        allowScripts: false,
        allowNetwork: false,
        allowExternalNavigation: false,
        allowFileAccess: false,
        allowPatchApply: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain('data:image');
    expect(JSON.stringify(result)).not.toContain('/tmp/');
  });

  it('rejects image runtime rendering for non-image surfaces', () => {
    const surface = buildAtelierArtifactPreviewHostSurface({
      kind: 'diff',
      rendererSessionId: 'atelier-preview:task-1:artifact-1',
      rendererOwner: 'desktop_host',
      rendererMode: 'host_sandbox_manifest',
      sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
      bodyRef: 'artifact://task-1/artifact-1/body',
    });

    expect(renderAtelierImagePreviewHostRuntime({
      surface,
      metadata: {
        mime: 'image/png',
        size: 2048,
        sha256: 'sha256:imagehash',
      },
    })).toMatchObject({
      ok: false,
      reason: 'Atelier image Host renderer requires an image preview surface.',
      rawImageBytesExposedToApplet: false,
      appletRenderable: false,
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
