import {
  ATELIER_ARTIFACT_PREVIEW_OPEN_DEFAULT_MODE,
  ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_MODES,
  ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_OWNERS,
  ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_STATUSES,
  ATELIER_ARTIFACT_PREVIEW_TARGET_KINDS,
  ATELIER_PROJECTION_CONTRACT,
  ATELIER_PROJECTION_DISPLAY_LIMITS,
} from './projection.contract.generated';
import type {
  FetchArtifactBodyInput,
  FetchArtifactBodyResponse,
  OpenArtifactPreviewInput,
  OpenArtifactPreviewResponse,
} from './runtime';
import type { Artifact } from './types';

export type PrototypeArtifactLogTone = 'danger' | 'warning' | 'muted' | 'default';
export type PrototypeArtifactPreviewIntentStatus = 'fetchBody' | 'openPreview' | 'invalid';

export interface PrototypeArtifactTrayItemView {
  glyph: string;
  active: boolean;
  metadataBadge: string;
}

export interface PrototypeArtifactMetadataPreviewView {
  glyph: string;
  visiblePaths: string[];
  hiddenPathCount: number;
  showPaths: boolean;
  showLogs: boolean;
  sizeLabel?: string;
}

export interface PrototypeArtifactPreviewCapabilityView {
  bodyRef: string;
  previewSandboxRef: string;
  previewBodyRef: string;
  canFetchSafeBody: boolean;
  canOpenSandboxPreview: boolean;
}

export interface PrototypeArtifactPreviewRequestKeyInput {
  taskId: string;
  artifact: Artifact;
  capabilityView?: PrototypeArtifactPreviewCapabilityView;
}

export type PrototypeArtifactBodyFetchIntent =
  | {
      status: Extract<PrototypeArtifactPreviewIntentStatus, 'fetchBody'>;
      input: FetchArtifactBodyInput;
    }
  | {
      status: Extract<PrototypeArtifactPreviewIntentStatus, 'invalid'>;
      reason: string;
    };

export type PrototypeArtifactPreviewOpenIntent =
  | {
      status: Extract<PrototypeArtifactPreviewIntentStatus, 'openPreview'>;
      input: OpenArtifactPreviewInput;
    }
  | {
      status: Extract<PrototypeArtifactPreviewIntentStatus, 'invalid'>;
      reason: string;
    };

const ARTIFACT_KIND_GLYPH: Record<Artifact['kind'], string> = {
  markdown: '📄',
  web: '🌐',
  image: '🖼',
  diff: '⊟',
};

export function derivePrototypeArtifactTrayItemView(input: {
  artifact: Artifact;
  openId?: string;
}): PrototypeArtifactTrayItemView {
  return {
    glyph: ARTIFACT_KIND_GLYPH[input.artifact.kind],
    active: input.artifact.id === input.openId,
    metadataBadge: input.artifact.kind === 'diff' ? 'metadata-only' : '',
  };
}

export function derivePrototypeArtifactMetadataPreviewView(
  artifact: Artifact,
): PrototypeArtifactMetadataPreviewView {
  const visiblePaths = (artifact.paths ?? []).slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.artifactPaths);

  return {
    glyph: ARTIFACT_KIND_GLYPH[artifact.kind],
    visiblePaths,
    hiddenPathCount: Math.max(0, (artifact.paths?.length ?? 0) - visiblePaths.length),
    showPaths: visiblePaths.length > 0,
    showLogs: Boolean(artifact.logs?.length),
    sizeLabel: artifact.size,
  };
}

export function derivePrototypeArtifactPreviewCapabilityView(
  artifact: Artifact,
): PrototypeArtifactPreviewCapabilityView {
  const bodyRef = artifact.bodyRef ?? '';
  const previewSandboxRef = artifact.previewTarget?.sandboxRef ?? '';
  const previewBodyRef = artifact.previewTarget?.bodyRef ?? '';

  return {
    bodyRef,
    previewSandboxRef,
    previewBodyRef,
    canFetchSafeBody: Boolean(bodyRef),
    canOpenSandboxPreview: Boolean(previewSandboxRef && previewBodyRef),
  };
}

export function prototypeArtifactLogTone(level: string): PrototypeArtifactLogTone {
  if (level === 'error') return 'danger';
  if (level === 'warn') return 'warning';
  if (level === 'info') return 'muted';
  return 'default';
}

export function buildPrototypeArtifactPreviewRequestKey(input: PrototypeArtifactPreviewRequestKeyInput): string {
  const capabilityView = input.capabilityView ?? derivePrototypeArtifactPreviewCapabilityView(input.artifact);
  const previewTarget = input.artifact.previewTarget;
  return [
    input.taskId.trim(),
    input.artifact.id,
    input.artifact.bodyHash ?? '',
    capabilityView.bodyRef,
    capabilityView.previewBodyRef,
    capabilityView.previewSandboxRef,
    previewTarget?.kind ?? '',
    previewTarget?.mode ?? '',
  ].join('|');
}

export function shouldApplyPrototypeArtifactPreviewResponse(input: {
  currentRequestKey: string;
  responseRequestKey: string;
}): boolean {
  return Boolean(input.responseRequestKey) && input.currentRequestKey === input.responseRequestKey;
}

export function prototypeArtifactBodyFetchErrorStatus(error: unknown): string {
  return error instanceof Error ? error.message : 'Artifact body fetch unavailable';
}

export function prototypeArtifactPreviewOpenErrorStatus(error: unknown): string {
  return error instanceof Error ? error.message : 'Artifact sandbox preview unavailable';
}

export function buildPrototypeArtifactBodyFetchIntent(input: {
  taskId: string;
  artifact: Artifact;
  capabilityView?: PrototypeArtifactPreviewCapabilityView;
}): PrototypeArtifactBodyFetchIntent {
  const taskId = input.taskId.trim();
  const capabilityView = input.capabilityView ?? derivePrototypeArtifactPreviewCapabilityView(input.artifact);

  if (!taskId || !input.artifact.id || !capabilityView.canFetchSafeBody) {
    return {
      status: 'invalid',
      reason: 'missing-station-body-ref',
    };
  }

  return {
    status: 'fetchBody',
    input: {
      taskId,
      artifactId: input.artifact.id,
      bodyRef: capabilityView.bodyRef,
      expectedHash: input.artifact.bodyHash,
    },
  };
}

export function buildPrototypeArtifactPreviewOpenIntent(input: {
  taskId: string;
  artifact: Artifact;
  capabilityView?: PrototypeArtifactPreviewCapabilityView;
}): PrototypeArtifactPreviewOpenIntent {
  const taskId = input.taskId.trim();
  const capabilityView = input.capabilityView ?? derivePrototypeArtifactPreviewCapabilityView(input.artifact);
  const previewTarget = input.artifact.previewTarget;
  const kind = previewTarget?.kind?.trim();

  if (
    !taskId ||
    !input.artifact.id ||
    !previewTarget ||
    !capabilityView.canOpenSandboxPreview ||
    !isPrototypeArtifactPreviewTargetKind(kind)
  ) {
    return {
      status: 'invalid',
      reason: 'missing-station-preview-target',
    };
  }

  return {
    status: 'openPreview',
    input: {
      taskId,
      artifactId: input.artifact.id,
      sandboxRef: capabilityView.previewSandboxRef,
      bodyRef: capabilityView.previewBodyRef,
      ...(kind ? { kind } : {}),
      mode: previewTarget.mode ?? 'sandbox_manifest',
    },
  };
}

function isPrototypeArtifactPreviewTargetKind(value: string | undefined): boolean {
  return value === undefined || value === '' || (ATELIER_ARTIFACT_PREVIEW_TARGET_KINDS as readonly string[]).includes(value);
}

export function buildPrototypeArtifactBodyFetchResponse(input: {
  request: FetchArtifactBodyInput;
  artifact?: Artifact;
}): FetchArtifactBodyResponse {
  const artifact = input.artifact;
  const bodyKind = artifact?.bodyKind ?? (artifact?.kind === 'diff' ? 'diff' : 'markdown');
  const text = prototypeArtifactSafeText(artifact);
  const bodySize = new TextEncoder().encode(text).length;
  const maxBytes = input.request.maxBytes && input.request.maxBytes > 0 ? input.request.maxBytes : 64 * 1024;
  const truncated = bodySize > maxBytes;

  return {
    taskId: input.request.taskId,
    artifactId: input.request.artifactId,
    bodyRef: input.request.bodyRef,
    bodyKind,
    bodyHash: input.request.expectedHash ?? 'sha256:prototype',
    bodySize,
    text: truncated ? text.slice(0, maxBytes) : text,
    truncated,
    retentionStatus: 'active',
  };
}

export function buildPrototypeArtifactPreviewOpenResponse(
  input: OpenArtifactPreviewInput,
): OpenArtifactPreviewResponse {
  const requiredRendererCapabilities = ATELIER_PROJECTION_CONTRACT
    .methodPayloads['atelier.artifact.preview.open']
    .requiredRendererCapabilities;

  return {
    accepted: true,
    opened: true,
    prepared: true,
    taskId: input.taskId,
    artifactId: input.artifactId,
    sandboxRef: input.sandboxRef,
    bodyRef: input.bodyRef,
    kind: input.kind ?? 'metadata',
    mode: input.mode ?? ATELIER_ARTIFACT_PREVIEW_OPEN_DEFAULT_MODE,
    rendererSessionId: `atelier-preview:${input.taskId}:${input.artifactId}`,
    rendererOwner: ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_OWNERS[0],
    rendererMode: ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_MODES[0],
    rendererStatus: ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_STATUSES.includes('rendered')
      ? 'rendered'
      : ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_STATUSES[0],
    rendererCapabilities: [
      'sandbox_manifest_validation',
      'artifact_body_binding',
      'host_owned_renderer_session',
      ...requiredRendererCapabilities,
    ],
    reason: 'Prototype records the Host-owned sandbox renderer surface descriptor; official applet still does not iframe/img/html-render artifact bodies.',
  };
}

function prototypeArtifactSafeText(artifact: Artifact | undefined): string {
  const projectedText = artifact as
    | (Artifact & {
        markdown?: string;
        diff?: string;
        content?: string;
      })
    | undefined;

  return (
    projectedText?.markdown ??
    projectedText?.diff ??
    projectedText?.content ??
    artifact?.paths?.join('\n') ??
    'Prototype artifact body is exposed as safe text through Host capability.'
  );
}
