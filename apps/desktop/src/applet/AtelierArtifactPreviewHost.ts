import type { AppletHostUiRequest } from './lynx-host-element';
import atelierProjectionContract from '../../../applets/atelier/contracts/atelier-projection.contract.json';

const ATELIER_PREVIEW_ACTION = 'openAtelierArtifactPreview';
const ATELIER_ARTIFACT_SANDBOX_REF_SHAPE = atelierProjectionContract.artifactPreview.sandboxRefShape;
const ATELIER_ARTIFACT_BODY_REF_SHAPE = atelierProjectionContract.artifactPreview.bodyRefShape;
const ATELIER_ARTIFACT_PREVIEW_HINTS = atelierProjectionContract.artifactPreview.allowedPreviewHints;
const ATELIER_REQUIRED_RENDERER_CAPABILITIES =
  atelierProjectionContract.methodPayloads['atelier.artifact.preview.open'].requiredRendererCapabilities;
const FORBIDDEN_RENDER_FIELDS = [
  'url',
  'src',
  'href',
  'iframe',
  'html',
  'image',
  'file',
  'path',
  'execute',
  'run',
  'openExternalUrl',
] as const;

type AtelierArtifactRendererKind = 'metadata' | 'markdown' | 'web' | 'image' | 'diff';

export interface AtelierArtifactPreviewHostSurface {
  surfaceKind: 'host_sandbox_visual_surface';
  rendererKind: AtelierArtifactRendererKind;
  rendererSessionId: string;
  rendererOwner: 'desktop_host';
  rendererMode: 'host_sandbox_manifest';
  sandboxRef: string;
  bodyRef: string;
  sandboxPolicy: {
    allowScripts: boolean;
    allowNetwork: boolean;
    allowExternalNavigation: boolean;
    allowFileAccess: boolean;
    allowPatchApply: boolean;
  };
  rawBodyExposedToApplet: false;
  appletRenderable: false;
}

export interface AtelierArtifactPreviewHostSession {
  taskId: string;
  artifactId: string;
  sandboxRef: string;
  bodyRef: string;
  rendererSessionId: string;
  rendererOwner: 'desktop_host';
  rendererMode: 'host_sandbox_manifest';
  rendererStatus: 'prepared_not_opened' | 'rendered';
  rendererCapabilities: string[];
  surface: AtelierArtifactPreviewHostSurface;
  recordedAt: number;
}

export interface AtelierMarkdownPreviewHostRuntimeResult {
  ok: boolean;
  rendererKind: 'markdown';
  rendererOwner: 'desktop_host';
  rendererMode: 'host_sandbox_manifest';
  surfaceKind: 'host_sandbox_visual_surface';
  rawBodyExposedToApplet: false;
  appletRenderable: false;
  sourceLineCount: number;
  renderedLineCount: number;
  renderedBlockKinds: Array<'heading' | 'list' | 'code' | 'paragraph'>;
  blockedRawHtmlTagCount: number;
  blockedImageRefCount: number;
  blockedLinkRefCount: number;
  blockedScriptTagCount: number;
  sandboxPolicy: AtelierArtifactPreviewHostSurface['sandboxPolicy'];
  reason: string;
}

export interface AtelierDiffPreviewHostRuntimeResult {
  ok: boolean;
  rendererKind: 'diff';
  rendererOwner: 'desktop_host';
  rendererMode: 'host_sandbox_manifest';
  surfaceKind: 'host_sandbox_visual_surface';
  rawDiffExposedToApplet: false;
  appletRenderable: false;
  patchApplyAllowed: false;
  sourceLineCount: number;
  fileCount: number;
  hunkCount: number;
  additionCount: number;
  deletionCount: number;
  binaryPatchCount: number;
  sandboxPolicy: AtelierArtifactPreviewHostSurface['sandboxPolicy'];
  reason: string;
}

export interface AtelierWebPreviewHostRuntimeResult {
  ok: boolean;
  rendererKind: 'web';
  rendererOwner: 'desktop_host';
  rendererMode: 'host_sandbox_manifest';
  surfaceKind: 'host_sandbox_visual_surface';
  rawHtmlExposedToApplet: false;
  appletRenderable: false;
  sourceLineCount: number;
  blockedScriptTagCount: number;
  blockedIframeTagCount: number;
  blockedExternalUrlCount: number;
  blockedInlineEventHandlerCount: number;
  sandboxPolicy: AtelierArtifactPreviewHostSurface['sandboxPolicy'];
  reason: string;
}

export interface AtelierImagePreviewHostRuntimeResult {
  ok: boolean;
  rendererKind: 'image';
  rendererOwner: 'desktop_host';
  rendererMode: 'host_sandbox_manifest';
  surfaceKind: 'host_sandbox_visual_surface';
  rawImageBytesExposedToApplet: false;
  appletRenderable: false;
  mime: string;
  size: number;
  sha256: string;
  width?: number;
  height?: number;
  forbiddenRawFields: string[];
  sandboxPolicy: AtelierArtifactPreviewHostSurface['sandboxPolicy'];
  reason: string;
}

export interface AtelierArtifactPreviewHostResult {
  ok: boolean;
  accepted?: boolean;
  opened?: boolean;
  prepared?: boolean;
  taskId?: string;
  artifactId?: string;
  sandboxRef?: string;
  bodyRef?: string;
  kind?: string;
  mode?: string;
  rendererSessionId?: string;
  rendererOwner?: 'desktop_host';
  rendererMode?: 'host_sandbox_manifest';
  rendererStatus?: 'prepared_not_opened' | 'rendered';
  rendererCapabilities?: string[];
  surface?: AtelierArtifactPreviewHostSurface;
  session?: AtelierArtifactPreviewHostSession;
  reason?: string;
}

const previewSessions = new Map<string, AtelierArtifactPreviewHostSession>();

export function handleAtelierArtifactPreviewHostUiRequest(
  request: AppletHostUiRequest,
  options: { now?: () => number } = {},
): AtelierArtifactPreviewHostResult | null {
  if (request.action !== ATELIER_PREVIEW_ACTION) return null;
  const result = recordAtelierArtifactPreviewHostSession(request.params, options);
  return result;
}

export function recordAtelierArtifactPreviewHostSession(
  params: Record<string, unknown>,
  options: { now?: () => number } = {},
): AtelierArtifactPreviewHostResult {
  for (const key of FORBIDDEN_RENDER_FIELDS) {
    if (key in params) {
      return {
        ok: false,
        reason: `Atelier artifact preview Host adapter rejects raw render field: ${key}`,
      };
    }
  }

  const taskId = requiredString(params, 'taskId');
  const artifactId = requiredString(params, 'artifactId');
  const sandboxRef = requiredString(params, 'sandboxRef');
  const bodyRef = requiredString(params, 'bodyRef');
  const rendererSessionId = requiredString(params, 'rendererSessionId');
  const rendererOwner = requiredString(params, 'rendererOwner');
  const rendererMode = requiredString(params, 'rendererMode');
  const rendererStatus = requiredString(params, 'rendererStatus');
  const kind = optionalString(params, 'kind') || 'metadata';
  const mode = optionalString(params, 'mode') || 'sandbox_manifest';
  const rendererCapabilities = stringArray(params, 'rendererCapabilities');

  if (!taskId || !artifactId || !sandboxRef || !bodyRef || !rendererSessionId) {
    return { ok: false, reason: 'Atelier artifact preview Host adapter requires task/artifact/session refs' };
  }
  if (!isAtelierArtifactRef(sandboxRef, ATELIER_ARTIFACT_SANDBOX_REF_SHAPE)) {
    return { ok: false, reason: 'Atelier artifact preview Host adapter only accepts canonical atelier-sandbox:// refs' };
  }
  if (!isAtelierArtifactRef(bodyRef, ATELIER_ARTIFACT_BODY_REF_SHAPE)) {
    return { ok: false, reason: 'Atelier artifact preview Host adapter only accepts canonical artifact:// body refs' };
  }
  if (!rendererSessionId.startsWith('atelier-preview:')) {
    return { ok: false, reason: 'Atelier artifact preview Host adapter only accepts atelier-preview sessions' };
  }
  if (rendererOwner !== 'desktop_host') {
    return { ok: false, reason: 'Atelier artifact preview Host adapter only accepts desktop_host ownership' };
  }
  if (rendererMode !== 'host_sandbox_manifest') {
    return { ok: false, reason: 'Atelier artifact preview Host adapter only accepts host_sandbox_manifest mode' };
  }
  if (mode !== 'sandbox_manifest') {
    return { ok: false, reason: 'Atelier artifact preview Host adapter only accepts sandbox_manifest mode' };
  }
  if (rendererStatus !== 'prepared_not_opened' && rendererStatus !== 'rendered') {
    return { ok: false, reason: 'Atelier artifact preview Host adapter only accepts prepared_not_opened or rendered sessions' };
  }
  if (rendererCapabilities.length === 0) {
    return { ok: false, reason: 'Atelier artifact preview Host adapter requires renderer capabilities' };
  }
  if (!ATELIER_REQUIRED_RENDERER_CAPABILITIES.every((capability) => rendererCapabilities.includes(capability))) {
    return { ok: false, reason: 'Atelier artifact preview Host adapter requires contract renderer capabilities' };
  }
  const surface = buildAtelierArtifactPreviewHostSurface({
    kind,
    rendererSessionId,
    rendererOwner,
    rendererMode,
    sandboxRef,
    bodyRef,
  });

  const session: AtelierArtifactPreviewHostSession = {
    taskId,
    artifactId,
    sandboxRef,
    bodyRef,
    rendererSessionId,
    rendererOwner,
    rendererMode,
    rendererStatus,
    rendererCapabilities,
    surface,
    recordedAt: options.now?.() ?? Date.now(),
  };
  previewSessions.set(rendererSessionId, session);
  return {
    ok: true,
    accepted: true,
    opened: rendererStatus === 'rendered',
    prepared: true,
    taskId,
    artifactId,
    sandboxRef,
    bodyRef,
    kind,
    mode,
    rendererSessionId,
    rendererOwner,
    rendererMode,
    rendererStatus,
    rendererCapabilities,
    surface,
    reason: rendererStatus === 'rendered'
      ? 'Desktop Host rendered a validated Atelier sandbox preview surface.'
      : 'Desktop Host prepared a validated Atelier sandbox preview renderer session.',
    session,
  };
}

export function getAtelierArtifactPreviewHostSession(
  rendererSessionId: string,
): AtelierArtifactPreviewHostSession | undefined {
  return previewSessions.get(rendererSessionId);
}

export function clearAtelierArtifactPreviewHostSessions(): void {
  previewSessions.clear();
}

export function renderAtelierMarkdownPreviewHostRuntime(input: {
  surface: AtelierArtifactPreviewHostSurface;
  safeText: string;
}): AtelierMarkdownPreviewHostRuntimeResult {
  if (input.surface.rendererKind !== 'markdown') {
    return {
      ok: false,
      rendererKind: 'markdown',
      rendererOwner: 'desktop_host',
      rendererMode: 'host_sandbox_manifest',
      surfaceKind: 'host_sandbox_visual_surface',
      rawBodyExposedToApplet: false,
      appletRenderable: false,
      sourceLineCount: 0,
      renderedLineCount: 0,
      renderedBlockKinds: [],
      blockedRawHtmlTagCount: 0,
      blockedImageRefCount: 0,
      blockedLinkRefCount: 0,
      blockedScriptTagCount: 0,
      sandboxPolicy: rendererSandboxPolicy('markdown'),
      reason: 'Atelier markdown Host renderer requires a markdown preview surface.',
    };
  }

  const lines = input.safeText.split(/\r?\n/);
  const renderedBlockKinds = new Set<AtelierMarkdownPreviewHostRuntimeResult['renderedBlockKinds'][number]>();
  let renderedLineCount = 0;
  let blockedRawHtmlTagCount = 0;
  let blockedImageRefCount = 0;
  let blockedLinkRefCount = 0;
  let blockedScriptTagCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    renderedLineCount += 1;
    if (/^#{1,6}\s+/.test(trimmed)) {
      renderedBlockKinds.add('heading');
    } else if (/^[-*]\s+/.test(trimmed)) {
      renderedBlockKinds.add('list');
    } else if (/^```/.test(trimmed) || /^ {4}/.test(line)) {
      renderedBlockKinds.add('code');
    } else {
      renderedBlockKinds.add('paragraph');
    }
    blockedRawHtmlTagCount += countMatches(trimmed, /<\/?[a-z][^>]*>/gi);
    blockedImageRefCount += countMatches(trimmed, /!\[[^\]]*]\([^)]+\)/g);
    blockedLinkRefCount += countMatches(trimmed, /(?<!!)\[[^\]]+]\([^)]+\)/g);
    blockedScriptTagCount += countMatches(trimmed, /<\/?script\b[^>]*>/gi);
  }

  return {
    ok: true,
    rendererKind: 'markdown',
    rendererOwner: 'desktop_host',
    rendererMode: 'host_sandbox_manifest',
    surfaceKind: 'host_sandbox_visual_surface',
    rawBodyExposedToApplet: false,
    appletRenderable: false,
    sourceLineCount: lines.length,
    renderedLineCount,
    renderedBlockKinds: Array.from(renderedBlockKinds),
    blockedRawHtmlTagCount,
    blockedImageRefCount,
    blockedLinkRefCount,
    blockedScriptTagCount,
    sandboxPolicy: input.surface.sandboxPolicy,
    reason: 'Desktop Host rendered a controlled metadata-only markdown preview surface.',
  };
}

export function renderAtelierDiffPreviewHostRuntime(input: {
  surface: AtelierArtifactPreviewHostSurface;
  safeText: string;
}): AtelierDiffPreviewHostRuntimeResult {
  if (input.surface.rendererKind !== 'diff') {
    return {
      ok: false,
      rendererKind: 'diff',
      rendererOwner: 'desktop_host',
      rendererMode: 'host_sandbox_manifest',
      surfaceKind: 'host_sandbox_visual_surface',
      rawDiffExposedToApplet: false,
      appletRenderable: false,
      patchApplyAllowed: false,
      sourceLineCount: 0,
      fileCount: 0,
      hunkCount: 0,
      additionCount: 0,
      deletionCount: 0,
      binaryPatchCount: 0,
      sandboxPolicy: rendererSandboxPolicy('diff'),
      reason: 'Atelier diff Host renderer requires a diff preview surface.',
    };
  }

  const lines = input.safeText.split(/\r?\n/);
  let fileCount = 0;
  let hunkCount = 0;
  let additionCount = 0;
  let deletionCount = 0;
  let binaryPatchCount = 0;

  for (const line of lines) {
    if (/^diff --git\s+/.test(line) || /^\+\+\+\s+/.test(line)) {
      fileCount += 1;
    }
    if (/^@@\s+/.test(line)) {
      hunkCount += 1;
    }
    if (/^\+/.test(line) && !/^\+\+\+/.test(line)) {
      additionCount += 1;
    }
    if (/^-/.test(line) && !/^---/.test(line)) {
      deletionCount += 1;
    }
    if (/^Binary files\s+/.test(line)) {
      binaryPatchCount += 1;
    }
  }

  return {
    ok: true,
    rendererKind: 'diff',
    rendererOwner: 'desktop_host',
    rendererMode: 'host_sandbox_manifest',
    surfaceKind: 'host_sandbox_visual_surface',
    rawDiffExposedToApplet: false,
    appletRenderable: false,
    patchApplyAllowed: false,
    sourceLineCount: lines.length,
    fileCount,
    hunkCount,
    additionCount,
    deletionCount,
    binaryPatchCount,
    sandboxPolicy: input.surface.sandboxPolicy,
    reason: 'Desktop Host rendered a controlled metadata-only diff preview surface.',
  };
}

export function renderAtelierWebPreviewHostRuntime(input: {
  surface: AtelierArtifactPreviewHostSurface;
  safeHtml: string;
}): AtelierWebPreviewHostRuntimeResult {
  if (input.surface.rendererKind !== 'web') {
    return {
      ok: false,
      rendererKind: 'web',
      rendererOwner: 'desktop_host',
      rendererMode: 'host_sandbox_manifest',
      surfaceKind: 'host_sandbox_visual_surface',
      rawHtmlExposedToApplet: false,
      appletRenderable: false,
      sourceLineCount: 0,
      blockedScriptTagCount: 0,
      blockedIframeTagCount: 0,
      blockedExternalUrlCount: 0,
      blockedInlineEventHandlerCount: 0,
      sandboxPolicy: rendererSandboxPolicy('web'),
      reason: 'Atelier web Host renderer requires a web preview surface.',
    };
  }

  const html = input.safeHtml;
  return {
    ok: true,
    rendererKind: 'web',
    rendererOwner: 'desktop_host',
    rendererMode: 'host_sandbox_manifest',
    surfaceKind: 'host_sandbox_visual_surface',
    rawHtmlExposedToApplet: false,
    appletRenderable: false,
    sourceLineCount: html.split(/\r?\n/).length,
    blockedScriptTagCount: countMatches(html, /<\/?script\b[^>]*>/gi),
    blockedIframeTagCount: countMatches(html, /<\/?iframe\b[^>]*>/gi),
    blockedExternalUrlCount: countMatches(html, /\b(?:src|href)=["'](?:https?:|file:|data:)[^"']*["']/gi),
    blockedInlineEventHandlerCount: countMatches(html, /\son[a-z]+=["'][^"']*["']/gi),
    sandboxPolicy: input.surface.sandboxPolicy,
    reason: 'Desktop Host rendered a controlled metadata-only web preview surface.',
  };
}

export function renderAtelierImagePreviewHostRuntime(input: {
  surface: AtelierArtifactPreviewHostSurface;
  metadata: {
    mime: string;
    size: number;
    sha256: string;
    width?: number;
    height?: number;
  };
}): AtelierImagePreviewHostRuntimeResult {
  if (input.surface.rendererKind !== 'image') {
    return {
      ok: false,
      rendererKind: 'image',
      rendererOwner: 'desktop_host',
      rendererMode: 'host_sandbox_manifest',
      surfaceKind: 'host_sandbox_visual_surface',
      rawImageBytesExposedToApplet: false,
      appletRenderable: false,
      mime: '',
      size: 0,
      sha256: '',
      forbiddenRawFields: ['path', 'url', 'src', 'base64', 'bytes'],
      sandboxPolicy: rendererSandboxPolicy('image'),
      reason: 'Atelier image Host renderer requires an image preview surface.',
    };
  }

  return {
    ok: true,
    rendererKind: 'image',
    rendererOwner: 'desktop_host',
    rendererMode: 'host_sandbox_manifest',
    surfaceKind: 'host_sandbox_visual_surface',
    rawImageBytesExposedToApplet: false,
    appletRenderable: false,
    mime: input.metadata.mime,
    size: input.metadata.size,
    sha256: input.metadata.sha256,
    width: input.metadata.width,
    height: input.metadata.height,
    forbiddenRawFields: ['path', 'url', 'src', 'base64', 'bytes'],
    sandboxPolicy: input.surface.sandboxPolicy,
    reason: 'Desktop Host rendered a controlled metadata-only image preview surface.',
  };
}

export function buildAtelierArtifactPreviewHostSurface(input: {
  kind?: string;
  rendererSessionId: string;
  rendererOwner: 'desktop_host';
  rendererMode: 'host_sandbox_manifest';
  sandboxRef: string;
  bodyRef: string;
}): AtelierArtifactPreviewHostSurface {
  const rendererKind = normalizeAtelierArtifactRendererKind(input.kind);
  return {
    surfaceKind: 'host_sandbox_visual_surface',
    rendererKind,
    rendererSessionId: input.rendererSessionId,
    rendererOwner: input.rendererOwner,
    rendererMode: input.rendererMode,
    sandboxRef: input.sandboxRef,
    bodyRef: input.bodyRef,
    sandboxPolicy: rendererSandboxPolicy(rendererKind),
    rawBodyExposedToApplet: false,
    appletRenderable: false,
  };
}

function requiredString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAtelierArtifactRendererKind(kind: string | undefined): AtelierArtifactRendererKind {
  if (kind === 'metadata_only') return 'metadata';
  if (
    kind === 'metadata' ||
    kind === 'markdown' ||
    kind === 'web' ||
    kind === 'image' ||
    kind === 'diff'
  ) {
    return kind;
  }
  return 'metadata';
}

function rendererSandboxPolicy(kind: AtelierArtifactRendererKind): AtelierArtifactPreviewHostSurface['sandboxPolicy'] {
  if (!ATELIER_ARTIFACT_PREVIEW_HINTS.includes(kind) && kind !== 'metadata') {
    throw new Error(`Unsupported Atelier artifact renderer kind: ${kind}`);
  }
  return {
    allowScripts: false,
    allowNetwork: false,
    allowExternalNavigation: false,
    allowFileAccess: false,
    allowPatchApply: false,
  };
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = requiredString(params, key);
  return value || undefined;
}

function stringArray(params: Record<string, unknown>, key: string): string[] {
  const value = params[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
}

function isAtelierArtifactRef(
  value: string,
  shape: { scheme: string; pathSegments: number; terminalSegment: string },
): boolean {
  if (/\s/.test(value)) return false;
  try {
    const uri = new URL(value);
    const path = uri.pathname.split('/').filter(Boolean);
    return (
      uri.protocol.slice(0, -1) === shape.scheme &&
      uri.hostname.trim().length > 0 &&
      path.length === shape.pathSegments &&
      path[path.length - 1] === shape.terminalSegment &&
      path.slice(0, -1).every((segment) => segment.trim().length > 0)
    );
  } catch {
    return false;
  }
}
