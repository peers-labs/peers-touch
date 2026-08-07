#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('tooling/acceptance/evidence/applets/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-artifact-renderer-controlled-gate.json');
const hostSourcePath = 'apps/desktop/src/applet/AtelierArtifactPreviewHost.ts';
const hostTestPath = 'apps/desktop/src/applet/AtelierArtifactPreviewHost.test.ts';
const rendererKinds = ['markdown', 'web', 'image', 'diff'];
const claimBoundary = {
  readiness: 'NOT_READY',
  proves: [
    'Desktop Host adapter builds controlled host_sandbox_visual_surface descriptors for markdown/web/image/diff preview kinds',
    'Desktop Host markdown renderer runtime consumes safe text and returns metadata-only render evidence without exposing raw body text',
    'Desktop Host diff renderer runtime consumes safe diff text and returns metadata-only render evidence without exposing raw patch text or enabling patch apply',
    'Desktop Host web renderer runtime consumes safe HTML and returns metadata-only render evidence without exposing raw HTML or enabling scripts/network/navigation',
    'Desktop Host image renderer runtime consumes Host-owned image metadata and returns metadata-only render evidence without exposing raw bytes/path/url/base64',
    'Desktop Host artifact preview renderer policy keeps scripts, network, external navigation, file access, and patch apply disabled',
    'Desktop Host artifact preview renderer surfaces remain Host-owned and not applet-renderable',
  ],
  doesNotProve: [
    'real iframe/image/html/diff rendering in a live Desktop webview',
    'real artifact blob fetch from Station storage',
    'real Console Logs runtime stream',
    'real attachment Host Storage runtime',
    'complete Host + Station + applet E2E',
  ],
};

mkdirSync(evidenceDir, { recursive: true });

function runVitest() {
  const result = spawnSync(
    'pnpm',
    ['--dir', 'apps/desktop', 'exec', 'vitest', 'run', 'src/applet/AtelierArtifactPreviewHost.test.ts'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return {
    command: 'pnpm --dir apps/desktop exec vitest run src/applet/AtelierArtifactPreviewHost.test.ts',
    status: 'PASS',
    stdout: result.stdout,
  };
}

function assertSourceAnchors() {
  const source = readFileSync(hostSourcePath, 'utf8');
  const test = readFileSync(hostTestPath, 'utf8');
  for (const anchor of [
    'buildAtelierArtifactPreviewHostSurface',
    "surfaceKind: 'host_sandbox_visual_surface'",
    'rawBodyExposedToApplet: false',
    'appletRenderable: false',
    'renderAtelierMarkdownPreviewHostRuntime',
    'blockedScriptTagCount',
    'blockedImageRefCount',
    'blockedLinkRefCount',
    'renderAtelierDiffPreviewHostRuntime',
    'rawDiffExposedToApplet: false',
    'patchApplyAllowed: false',
    'binaryPatchCount',
    'renderAtelierWebPreviewHostRuntime',
    'rawHtmlExposedToApplet: false',
    'blockedIframeTagCount',
    'blockedExternalUrlCount',
    'blockedInlineEventHandlerCount',
    'renderAtelierImagePreviewHostRuntime',
    'rawImageBytesExposedToApplet: false',
    'forbiddenRawFields',
    'allowScripts: false',
    'allowNetwork: false',
    'allowExternalNavigation: false',
    'allowFileAccess: false',
    'allowPatchApply: false',
  ]) {
    assert.ok(source.includes(anchor), `${hostSourcePath} missing ${anchor}`);
  }
  for (const kind of rendererKinds) {
    assert.ok(test.includes(kind), `${hostTestPath} missing renderer kind ${kind}`);
  }
  assert.ok(
    test.includes('builds Host-owned renderer surfaces for rich preview kinds without applet-renderable raw bodies'),
    `${hostTestPath} missing rich renderer matrix test`,
  );
  assert.ok(
    test.includes('renders markdown through Host-owned metadata-only runtime evidence without exposing raw body'),
    `${hostTestPath} missing markdown runtime evidence test`,
  );
  assert.ok(
    test.includes('rejects markdown runtime rendering for non-markdown surfaces'),
    `${hostTestPath} missing markdown runtime fail-closed test`,
  );
  assert.ok(
    test.includes('renders diff through Host-owned metadata-only runtime evidence without exposing raw patch text'),
    `${hostTestPath} missing diff runtime evidence test`,
  );
  assert.ok(
    test.includes('rejects diff runtime rendering for non-diff surfaces'),
    `${hostTestPath} missing diff runtime fail-closed test`,
  );
  assert.ok(
    test.includes('renders web previews through Host-owned metadata-only runtime evidence without exposing raw HTML'),
    `${hostTestPath} missing web runtime evidence test`,
  );
  assert.ok(
    test.includes('rejects web runtime rendering for non-web surfaces'),
    `${hostTestPath} missing web runtime fail-closed test`,
  );
  assert.ok(
    test.includes('renders image previews through Host-owned metadata-only runtime evidence without exposing raw image bytes'),
    `${hostTestPath} missing image runtime evidence test`,
  );
  assert.ok(
    test.includes('rejects image runtime rendering for non-image surfaces'),
    `${hostTestPath} missing image runtime fail-closed test`,
  );
}

function rendererMatrix() {
  return rendererKinds.map((kind) => ({
    rendererKind: kind,
    surfaceKind: 'host_sandbox_visual_surface',
    rendererOwner: 'desktop_host',
    rendererMode: 'host_sandbox_manifest',
    sandboxPolicy: {
      allowScripts: false,
      allowNetwork: false,
      allowExternalNavigation: false,
      allowFileAccess: false,
      allowPatchApply: false,
    },
    rawBodyExposedToApplet: false,
    appletRenderable: false,
  }));
}

function markdownRuntimeEvidence() {
  return {
    rendererKind: 'markdown',
    rendererOwner: 'desktop_host',
    rendererMode: 'host_sandbox_manifest',
    surfaceKind: 'host_sandbox_visual_surface',
    safeTextInputOwner: 'desktop_host',
    rawBodyExposedToApplet: false,
    appletRenderable: false,
    metadataOnlyFields: [
      'sourceLineCount',
      'renderedLineCount',
      'renderedBlockKinds',
      'blockedRawHtmlTagCount',
      'blockedImageRefCount',
      'blockedLinkRefCount',
      'blockedScriptTagCount',
    ],
    sandboxPolicy: {
      allowScripts: false,
      allowNetwork: false,
      allowExternalNavigation: false,
      allowFileAccess: false,
      allowPatchApply: false,
    },
  };
}

function diffRuntimeEvidence() {
  return {
    rendererKind: 'diff',
    rendererOwner: 'desktop_host',
    rendererMode: 'host_sandbox_manifest',
    surfaceKind: 'host_sandbox_visual_surface',
    safeTextInputOwner: 'desktop_host',
    rawDiffExposedToApplet: false,
    appletRenderable: false,
    patchApplyAllowed: false,
    metadataOnlyFields: [
      'sourceLineCount',
      'fileCount',
      'hunkCount',
      'additionCount',
      'deletionCount',
      'binaryPatchCount',
    ],
    sandboxPolicy: {
      allowScripts: false,
      allowNetwork: false,
      allowExternalNavigation: false,
      allowFileAccess: false,
      allowPatchApply: false,
    },
  };
}

function webRuntimeEvidence() {
  return {
    rendererKind: 'web',
    rendererOwner: 'desktop_host',
    rendererMode: 'host_sandbox_manifest',
    surfaceKind: 'host_sandbox_visual_surface',
    safeHtmlInputOwner: 'desktop_host',
    rawHtmlExposedToApplet: false,
    appletRenderable: false,
    metadataOnlyFields: [
      'sourceLineCount',
      'blockedScriptTagCount',
      'blockedIframeTagCount',
      'blockedExternalUrlCount',
      'blockedInlineEventHandlerCount',
    ],
    sandboxPolicy: {
      allowScripts: false,
      allowNetwork: false,
      allowExternalNavigation: false,
      allowFileAccess: false,
      allowPatchApply: false,
    },
  };
}

function imageRuntimeEvidence() {
  return {
    rendererKind: 'image',
    rendererOwner: 'desktop_host',
    rendererMode: 'host_sandbox_manifest',
    surfaceKind: 'host_sandbox_visual_surface',
    metadataInputOwner: 'desktop_host',
    rawImageBytesExposedToApplet: false,
    appletRenderable: false,
    metadataOnlyFields: [
      'mime',
      'size',
      'sha256',
      'width',
      'height',
    ],
    forbiddenRawFields: ['path', 'url', 'src', 'base64', 'bytes'],
    sandboxPolicy: {
      allowScripts: false,
      allowNetwork: false,
      allowExternalNavigation: false,
      allowFileAccess: false,
      allowPatchApply: false,
    },
  };
}

try {
  assertSourceAnchors();
  const testRun = runVitest();
  const evidence = {
    ok: true,
    evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    gate: 'atelier-artifact-renderer-controlled-gate',
    source: 'desktop_host_adapter_unit_matrix',
    rendererMatrix: rendererMatrix(),
    markdownRuntimeEvidence: markdownRuntimeEvidence(),
    diffRuntimeEvidence: diffRuntimeEvidence(),
    webRuntimeEvidence: webRuntimeEvidence(),
    imageRuntimeEvidence: imageRuntimeEvidence(),
    testRun: {
      command: testRun.command,
      status: testRun.status,
    },
    claimBoundary,
    notCovered: claimBoundary.doesNotProve,
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`PASS Atelier artifact renderer controlled gate: ${evidencePath}`);
} catch (error) {
  const evidence = {
    ok: false,
    evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    gate: 'atelier-artifact-renderer-controlled-gate',
    claimBoundary,
    error: error instanceof Error ? error.message : String(error),
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.error(`FAIL Atelier artifact renderer controlled gate: ${evidence.error}`);
  process.exitCode = 1;
}
