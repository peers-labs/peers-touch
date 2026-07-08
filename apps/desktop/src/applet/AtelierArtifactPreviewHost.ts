import type { AppletHostUiRequest } from './lynx-host-element';
import atelierProjectionContract from '../../../applets/atelier/contracts/atelier-projection.contract.json';

const ATELIER_PREVIEW_ACTION = 'openAtelierArtifactPreview';
const ATELIER_ARTIFACT_SANDBOX_REF_SHAPE = atelierProjectionContract.artifactPreview.sandboxRefShape;
const ATELIER_ARTIFACT_BODY_REF_SHAPE = atelierProjectionContract.artifactPreview.bodyRefShape;
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
  recordedAt: number;
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

function requiredString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  return typeof value === 'string' ? value.trim() : '';
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
