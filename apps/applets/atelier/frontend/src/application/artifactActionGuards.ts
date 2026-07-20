import type { AtelierArtifactProjection } from '../domain/projection';
import {
  ATELIER_ARTIFACT_BODY_REF_SHAPE,
  ATELIER_ARTIFACT_PREVIEW_OPEN_DEFAULT_MODE,
  ATELIER_ARTIFACT_PREVIEW_OPEN_MODES,
  ATELIER_ARTIFACT_PREVIEW_TARGET_KINDS,
  ATELIER_ARTIFACT_SANDBOX_REF_SHAPE,
} from '../domain/projection.contract.generated';

interface ArtifactRefShape {
  scheme: string;
  pathSegments: number;
  terminalSegment: string;
}

export interface AtelierArtifactBodyFetchIntent {
  key: string;
  taskId: string;
  artifactId: string;
  bodyRef: string;
  expectedHash?: string;
}

export interface AtelierArtifactPreviewOpenIntent {
  key: string;
  taskId: string;
  artifactId: string;
  sandboxRef: string;
  bodyRef: string;
  kind?: string;
  mode: string;
}

export type AtelierArtifactActionIntentResult<T> =
  | { status: 'ready'; intent: T }
  | { status: 'blocked' }
  | { status: 'invalid' };

export function buildAtelierArtifactBodyFetchIntent(input: {
  taskId: string;
  artifact: AtelierArtifactProjection;
  pendingKey: string;
}): AtelierArtifactActionIntentResult<AtelierArtifactBodyFetchIntent> {
  const taskId = input.taskId.trim();
  const artifactId = input.artifact.id.trim();
  const bodyRef = input.artifact.bodyRef?.trim() ?? '';
  const key = `${taskId}:${artifactId}`;
  if (!taskId || !artifactId || !bodyRef || input.pendingKey) return { status: 'blocked' };
  if (!isCanonicalAtelierArtifactBodyRef(bodyRef)) return { status: 'invalid' };
  return {
    status: 'ready',
    intent: {
      key,
      taskId,
      artifactId,
      bodyRef,
      expectedHash: input.artifact.bodyHash,
    },
  };
}

export function buildAtelierArtifactPreviewOpenIntent(input: {
  taskId: string;
  artifact: AtelierArtifactProjection;
  pendingKey: string;
}): AtelierArtifactActionIntentResult<AtelierArtifactPreviewOpenIntent> {
  const taskId = input.taskId.trim();
  const artifactId = input.artifact.id.trim();
  const previewTarget = input.artifact.previewTarget;
  const sandboxRef = previewTarget?.sandboxRef?.trim() ?? '';
  const bodyRef = previewTarget?.bodyRef?.trim() || input.artifact.bodyRef?.trim() || '';
  const mode = previewTarget?.mode?.trim() || ATELIER_ARTIFACT_PREVIEW_OPEN_DEFAULT_MODE;
  const kind = previewTarget?.kind?.trim();
  const key = `${taskId}:${artifactId}`;
  if (!taskId || !artifactId || !sandboxRef || !bodyRef || input.pendingKey) return { status: 'blocked' };
  if (
    !isCanonicalAtelierSandboxRef(sandboxRef) ||
    !isCanonicalAtelierArtifactBodyRef(bodyRef) ||
    !isAtelierArtifactPreviewOpenMode(mode) ||
    !isAtelierArtifactPreviewTargetKind(kind)
  ) {
    return { status: 'invalid' };
  }
  return {
    status: 'ready',
    intent: {
      key,
      taskId,
      artifactId,
      sandboxRef,
      bodyRef,
      ...(kind ? { kind } : {}),
      mode,
    },
  };
}

export function isCurrentAtelierArtifactRequest(input: {
  currentSeq: number;
  requestSeq: number;
  currentPendingKey: string;
  expectedPendingKey: string;
}): boolean {
  return input.currentSeq === input.requestSeq && input.currentPendingKey === input.expectedPendingKey;
}

export function isCanonicalAtelierArtifactBodyRef(value: string): boolean {
  return isCanonicalAtelierArtifactRef(value, ATELIER_ARTIFACT_BODY_REF_SHAPE);
}

export function isCanonicalAtelierSandboxRef(value: string): boolean {
  return isCanonicalAtelierArtifactRef(value, ATELIER_ARTIFACT_SANDBOX_REF_SHAPE);
}

function isCanonicalAtelierArtifactRef(value: string, shape: ArtifactRefShape): boolean {
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

function isAtelierArtifactPreviewOpenMode(value: string): boolean {
  return (ATELIER_ARTIFACT_PREVIEW_OPEN_MODES as readonly string[]).includes(value);
}

function isAtelierArtifactPreviewTargetKind(value: string | undefined): boolean {
  return value === undefined || value === '' || (ATELIER_ARTIFACT_PREVIEW_TARGET_KINDS as readonly string[]).includes(value);
}
