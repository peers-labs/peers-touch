import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const checkOnly = process.argv.includes('--check');

const contractPath = path.join(repoRoot, 'apps/applets/atelier/contracts/atelier-projection.contract.json');
const schemaPath = path.join(repoRoot, 'apps/applets/atelier/contracts/atelier-projection.schema.generated.json');
const tsPaths = [
  path.join(repoRoot, 'apps/applets/atelier/frontend/src/domain/projection.contract.generated.ts'),
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/projection.contract.generated.ts'),
];

const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
validateContract(contract);

const schema = buildSchema(contract);
const tsSource = buildTypeScript(contract);

const outputs = [
  [schemaPath, JSON.stringify(schema, null, 2) + '\n'],
  ...tsPaths.map((tsPath) => [tsPath, tsSource]),
];

let stale = false;
for (const [targetPath, content] of outputs) {
  const current = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
  if (current !== content) {
    stale = true;
    if (!checkOnly) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, content);
    }
  }
}

if (checkOnly && stale) {
  console.error('Atelier projection generated contract files are stale. Run `pnpm run atelier:projection-codegen`.');
  process.exit(1);
}

console.log(`${checkOnly ? 'PASS' : 'WROTE'} Atelier projection contract generated artifacts`);

function validateContract(value) {
  assertString(value.id, 'id');
  assertString(value.appletId, 'appletId');
  assertString(value.service, 'service');
  assertString(value.version, 'version');
  assertString(value.eventTopic, 'eventTopic');
  validateEventSubscription(value.eventSubscription);
  assertStringArray(value.methods, 'methods');
  assertStringArray(value.runtimeMethods, 'runtimeMethods');
  validateMethodIntents(value.methods, value.methodIntents);
  assertString(value.subscriptionMethod, 'subscriptionMethod');
  assertStringArray(value.gatewayActions, 'gatewayActions');
  assertStringArray(value.patchKinds, 'patchKinds');
  assertStringArray(value.snapshotRequiredFields, 'snapshotRequiredFields');
  assertStringArray(value.snapshotOptionalFields, 'snapshotOptionalFields');
  assertStringArray(value.eventRequiredFields, 'eventRequiredFields');
  assertStringArray(value.eventOptionalFields, 'eventOptionalFields');
  assertStringArray(value.replayFields, 'replayFields');
  if (!isRecord(value.methodPayloads)) {
    throw new Error('methodPayloads must be an object');
  }
  validateMethodGovernance(value.methodGovernance, value);
  validateCreateFromGoalPayload(value.methodPayloads['atelier.project.createFromGoal'], value.methodIntents['atelier.project.createFromGoal'], value.methodTransports['atelier.project.createFromGoal']);
  validateMessageSendPayload(value.methodPayloads['atelier.message.send'], value.methodIntents['atelier.message.send'], value.methodTransports['atelier.message.send']);
  validateEscalationResolvePayload(value.methodPayloads['atelier.escalation.resolve'], value.methodIntents['atelier.escalation.resolve'], value.methodTransports['atelier.escalation.resolve']);
  validateWorkspaceOpenPayload(value.methodPayloads['atelier.workspace.open'], value.methodIntents['atelier.workspace.open'], value.methodTransports['atelier.workspace.open']);
  validateArtifactPreviewOpenPayload(
    value.methodPayloads['atelier.artifact.preview.open'],
    value.methodIntents['atelier.artifact.preview.open'],
    value.methodTransports['atelier.artifact.preview.open'],
  );
  validateFeedbackSubmitPayload(value.methodPayloads['atelier.feedback.submit'], value.methodIntents['atelier.feedback.submit'], value.methodTransports['atelier.feedback.submit']);
  validateConfirmationPayload(value.methodPayloads['atelier.memory.confirmCandidate'], value.methodIntents['atelier.memory.confirmCandidate'], value.methodTransports['atelier.memory.confirmCandidate'], {
    method: 'atelier.memory.confirmCandidate',
    mode: 'station_memory_review',
    forbiddenActions: ['memory.write', 'invoke', 'execute', 'run'],
    booleans: {
      officialResponseGuardProven: true,
      prototypeBridgeResponseGuardProven: true,
      generatedConfirmationModeProven: true,
      sourceBlockBindingProven: true,
      nonSnapshotResponseGuardProven: true,
      requestCorrelationProven: true,
      stationIngressForbiddenFieldGuardProven: true,
      stationReferenceOnlyRequestProven: true,
      stationOwnedMemoryWriteProven: true,
      stationMemoryAuditEventProven: true,
      stationMemoryIdempotencyProven: true,
      stationNonCandidateRejectedProven: true,
      stationPlannerRiskVerifierMemoryRetrievalProven: true,
      stationPromptMemorySnapshotConsumptionProven: true,
      appletMemoryWriteExposed: false,
      appletProviderInvokeExposed: false,
      realMemoryWriteE2EProven: false,
      realPlannerVerifierConsumptionProven: false,
      realHostStationAppletE2EProven: false,
    },
  });
  validateConfirmationPayload(value.methodPayloads['atelier.feedback.confirmRerun'], value.methodIntents['atelier.feedback.confirmRerun'], value.methodTransports['atelier.feedback.confirmRerun'], {
    method: 'atelier.feedback.confirmRerun',
    mode: 'station_rerun_review',
    forbiddenActions: ['rerun', 'invoke', 'execute', 'run'],
    booleans: {
      officialResponseGuardProven: true,
      prototypeBridgeResponseGuardProven: true,
      generatedConfirmationModeProven: true,
      sourceBlockBindingProven: true,
      nonSnapshotResponseGuardProven: true,
      requestCorrelationProven: true,
      stationIngressForbiddenFieldGuardProven: true,
      stationReferenceOnlyRequestProven: true,
      stationOwnedRerunTaskCreationProven: true,
      stationRerunProviderPlanCloneProven: true,
      stationRerunAuditEventProven: true,
      stationRerunIdempotencyProven: true,
      stationNonRerunRejectedProven: true,
      appletRerunExecutionExposed: false,
      appletProviderInvokeExposed: false,
      realRerunTaskCreationE2EProven: false,
      realExecutorProviderRecoveryE2EProven: false,
      realHostStationAppletE2EProven: false,
    },
  });
  validateTaskLifecycle(value.taskLifecycle, value.methodPayloads, value.methodIntents, value.methodTransports);
  validateAgentRoleAuthority(value.agentRoleAuthority);
  validateNegotiationProjection(value.negotiationProjection);
  if (!isRecord(value.streamBlocks)) {
    throw new Error('streamBlocks must be an object');
  }
  assertStringArray(value.streamBlocks.allowedKinds, 'streamBlocks.allowedKinds');
  validateStreamBlockRequiredFields(value.streamBlocks);
  assertStringArray(value.streamBlocks.diffSummaryFields, 'streamBlocks.diffSummaryFields');
  validateViewSurface(value.viewSurface);
  validateProjectSurface(value.projectSurface);
  validateWorkbenchSurface(value.workbenchSurface);
  validateBudgetSurface(value.budgetSurface);
  validateProviderCapabilitiesPayload(value.methodPayloads['atelier.provider.capabilities']);
  if (!isRecord(value.artifactPreview)) {
    throw new Error('artifactPreview must be an object');
  }
  assertStringArray(value.artifactPreview.allowedPreviewHints, 'artifactPreview.allowedPreviewHints');
  assertStringArray(value.artifactPreview.allowedPreviewTargetKinds, 'artifactPreview.allowedPreviewTargetKinds');
  assertStringArray(value.artifactPreview.metadataFields, 'artifactPreview.metadataFields');
  assertStringArray(value.artifactPreview.previewTargetFields, 'artifactPreview.previewTargetFields');
  assertStringArray(value.artifactPreview.allowedPreviewTargetModes, 'artifactPreview.allowedPreviewTargetModes');
  assertStringArray(value.artifactPreview.allowedBodyRefSchemes, 'artifactPreview.allowedBodyRefSchemes');
  assertStringArray(value.artifactPreview.allowedSandboxRefSchemes, 'artifactPreview.allowedSandboxRefSchemes');
  validateArtifactRefShape(value.artifactPreview.bodyRefShape, value.artifactPreview.allowedBodyRefSchemes, 'artifactPreview.bodyRefShape');
  validateArtifactRefShape(value.artifactPreview.sandboxRefShape, value.artifactPreview.allowedSandboxRefSchemes, 'artifactPreview.sandboxRefShape');
  assertStringArray(value.artifactPreview.forbiddenBodyFields, 'artifactPreview.forbiddenBodyFields');
  validateArtifactPreviewControlledEvidence(value.artifactPreview);
  validateReadOnlyProjectionSurfaces(value.readOnlyProjectionSurfaces);
  validateDirectRunExecutionEvidence(value.directRunExecutionEvidence);
  validateArtifactBodyFetch(
    value.artifactBodyFetch,
    value.artifactPreview,
    value.workbenchSurface,
    value.methodPayloads['atelier.artifact.body.fetch'],
    value.methodIntents['atelier.artifact.body.fetch'],
    value.methodTransports['atelier.artifact.body.fetch'],
  );
  validateArtifactRendererSurface(value.artifactRendererSurface, value.methodPayloads['atelier.artifact.preview.open']);
  validateRuntimeLogStream(value.runtimeLogStream);
  validateHostStorageAttachment(value.hostStorageAttachment);
}

function validateArtifactRefShape(shape, allowedSchemes, name) {
  if (!isRecord(shape)) {
    throw new Error(`${name} must be an object`);
  }
  assertString(shape.scheme, `${name}.scheme`);
  assertString(shape.terminalSegment, `${name}.terminalSegment`);
  if (!Number.isInteger(shape.pathSegments) || shape.pathSegments < 1) {
    throw new Error(`${name}.pathSegments must be a positive integer`);
  }
  if (!allowedSchemes.includes(shape.scheme)) {
    throw new Error(`${name}.scheme must be included in allowed schemes`);
  }
}

function validateArtifactPreviewControlledEvidence(artifactPreview) {
  const controlledEvidence = artifactPreview.controlledEvidence;
  if (!isRecord(controlledEvidence)) {
    throw new Error('artifactPreview.controlledEvidence must describe controlled artifact preview evidence');
  }
  if (controlledEvidence.readiness !== 'controlled_local_upstream') {
    throw new Error('artifactPreview.controlledEvidence.readiness must be controlled_local_upstream');
  }
  if (controlledEvidence.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error('artifactPreview.controlledEvidence.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM');
  }
  const expectedGates = [
    'atelier:projection-contract-gate',
    'atelier:official-frontend-gate',
    'atelier:bridge-runtime-gate',
  ];
  assertStringArray(controlledEvidence.gates, 'artifactPreview.controlledEvidence.gates');
  if (JSON.stringify(controlledEvidence.gates) !== JSON.stringify(expectedGates)) {
    throw new Error('artifactPreview.controlledEvidence.gates must be atelier:projection-contract-gate, atelier:official-frontend-gate, atelier:bridge-runtime-gate');
  }
  const expectedEvidenceFiles = [
    'tooling/acceptance/evidence/applets/official-applet/atelier-official-frontend-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-bridge-runtime-gate.json',
  ];
  assertStringArray(controlledEvidence.evidenceFiles, 'artifactPreview.controlledEvidence.evidenceFiles');
  if (JSON.stringify(controlledEvidence.evidenceFiles) !== JSON.stringify(expectedEvidenceFiles)) {
    throw new Error('artifactPreview.controlledEvidence.evidenceFiles must match controlled artifact preview evidence files');
  }
  for (const field of [
    'allowedPreviewHints',
    'allowedPreviewTargetKinds',
    'metadataFields',
    'previewTargetFields',
    'allowedPreviewTargetModes',
    'allowedBodyRefSchemes',
    'allowedSandboxRefSchemes',
    'forbiddenBodyFields',
  ]) {
    assertStringArray(controlledEvidence[field], `artifactPreview.controlledEvidence.${field}`);
    if (JSON.stringify(controlledEvidence[field]) !== JSON.stringify(artifactPreview[field])) {
      throw new Error(`artifactPreview.controlledEvidence.${field} must match artifactPreview.${field}`);
    }
  }
  for (const field of ['bodyRefShape', 'sandboxRefShape']) {
    if (JSON.stringify(controlledEvidence[field]) !== JSON.stringify(artifactPreview[field])) {
      throw new Error(`artifactPreview.controlledEvidence.${field} must match artifactPreview.${field}`);
    }
  }
  for (const [field, expected] of Object.entries({
    metadataOnlyProjectionProven: true,
    canonicalRefShapeGuardProven: true,
    hostPreviewIntentOnly: true,
    rawBodyProjectionForbidden: true,
    appletRendererExposed: false,
    realHostVisualRendererProven: false,
    realArtifactBodyFetchE2EProven: false,
    realDesktopProductWindowUIProven: false,
    realHostStationAppletE2EProven: false,
  })) {
    if (controlledEvidence[field] !== expected) {
      throw new Error(`artifactPreview.controlledEvidence.${field} must be ${expected}`);
    }
  }
}

function validateHostStorageAttachment(hostStorageAttachment) {
  if (!isRecord(hostStorageAttachment)) {
    throw new Error('hostStorageAttachment must be an object');
  }
  assertString(hostStorageAttachment.readiness, 'hostStorageAttachment.readiness');
  if (hostStorageAttachment.readiness !== 'controlled_local_upstream') {
    throw new Error('hostStorageAttachment.readiness must be controlled_local_upstream until real Host Storage runtime is wired');
  }
  assertString(hostStorageAttachment.evidenceClass, 'hostStorageAttachment.evidenceClass');
  if (hostStorageAttachment.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error('hostStorageAttachment.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM');
  }
  assertString(hostStorageAttachment.owner, 'hostStorageAttachment.owner');
  if (hostStorageAttachment.owner !== 'desktop_host') {
    throw new Error('hostStorageAttachment.owner must be desktop_host');
  }
  assertString(hostStorageAttachment.stationIngress, 'hostStorageAttachment.stationIngress');
  if (hostStorageAttachment.stationIngress !== 'direct_run_input_snapshot') {
    throw new Error('hostStorageAttachment.stationIngress must be direct_run_input_snapshot');
  }
  if (!isRecord(hostStorageAttachment.refShape)) {
    throw new Error('hostStorageAttachment.refShape must be an object');
  }
  assertString(hostStorageAttachment.refShape.scheme, 'hostStorageAttachment.refShape.scheme');
  if (hostStorageAttachment.refShape.scheme !== 'host-storage') {
    throw new Error('hostStorageAttachment.refShape.scheme must be host-storage');
  }
  if (!Number.isInteger(hostStorageAttachment.refShape.pathSegments) || hostStorageAttachment.refShape.pathSegments < 1) {
    throw new Error('hostStorageAttachment.refShape.pathSegments must be a positive integer');
  }
  const expectedRequiredMetadataFields = ['hostStorageRef', 'mime', 'size', 'sha256'];
  assertStringArray(hostStorageAttachment.requiredMetadataFields, 'hostStorageAttachment.requiredMetadataFields');
  if (JSON.stringify(hostStorageAttachment.requiredMetadataFields) !== JSON.stringify(expectedRequiredMetadataFields)) {
    throw new Error('hostStorageAttachment.requiredMetadataFields must be hostStorageRef, mime, size, sha256');
  }
  const expectedForbiddenFields = [
    'path',
    'filePath',
    'url',
    'src',
    'body',
    'content',
    'base64',
    'bytes',
    'write',
    'writeIntent',
    'inputSnapshot',
    'input_snapshot',
  ];
  assertStringArray(hostStorageAttachment.forbiddenFields, 'hostStorageAttachment.forbiddenFields');
  if (JSON.stringify(hostStorageAttachment.forbiddenFields) !== JSON.stringify(expectedForbiddenFields)) {
    throw new Error('hostStorageAttachment.forbiddenFields must match the canonical raw/write forbidden attachment fields');
  }
  const expectedForbiddenMethods = [
    'atelier.attachment.upload',
    'attachment.upload',
    'HostStorage.write',
    'input_snapshot.write',
    'inputSnapshot.write',
  ];
  assertStringArray(hostStorageAttachment.forbiddenMethods, 'hostStorageAttachment.forbiddenMethods');
  if (JSON.stringify(hostStorageAttachment.forbiddenMethods) !== JSON.stringify(expectedForbiddenMethods)) {
    throw new Error('hostStorageAttachment.forbiddenMethods must match the canonical forbidden attachment methods');
  }
  if (!isRecord(hostStorageAttachment.controlledEvidence)) {
    throw new Error('hostStorageAttachment.controlledEvidence must describe controlled Host Storage attachment evidence');
  }
  if (hostStorageAttachment.controlledEvidence.readiness !== 'controlled_local_upstream') {
    throw new Error('hostStorageAttachment.controlledEvidence.readiness must be controlled_local_upstream');
  }
  if (hostStorageAttachment.controlledEvidence.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error('hostStorageAttachment.controlledEvidence.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM');
  }
  if (hostStorageAttachment.controlledEvidence.gate !== 'atelier:host-storage-attachment-controlled-gate') {
    throw new Error('hostStorageAttachment.controlledEvidence.gate must be atelier:host-storage-attachment-controlled-gate');
  }
  assertStringArray(hostStorageAttachment.controlledEvidence.evidenceFiles, 'hostStorageAttachment.controlledEvidence.evidenceFiles');
  if (!hostStorageAttachment.controlledEvidence.evidenceFiles.includes('tooling/acceptance/evidence/applets/official-applet/atelier-host-storage-attachment-controlled-gate.json')) {
    throw new Error('hostStorageAttachment.controlledEvidence.evidenceFiles must include Host Storage attachment evidence JSON');
  }
  if (hostStorageAttachment.controlledEvidence.source !== 'host_storage_controlled_harness') {
    throw new Error('hostStorageAttachment.controlledEvidence.source must be host_storage_controlled_harness');
  }
  if (hostStorageAttachment.controlledEvidence.refScheme !== hostStorageAttachment.refShape.scheme) {
    throw new Error('hostStorageAttachment.controlledEvidence.refScheme must match hostStorageAttachment.refShape.scheme');
  }
  assertStringArray(hostStorageAttachment.controlledEvidence.metadataFields, 'hostStorageAttachment.controlledEvidence.metadataFields');
  if (JSON.stringify(hostStorageAttachment.controlledEvidence.metadataFields) !== JSON.stringify(hostStorageAttachment.requiredMetadataFields)) {
    throw new Error('hostStorageAttachment.controlledEvidence.metadataFields must match hostStorageAttachment.requiredMetadataFields');
  }
  assertStringArray(hostStorageAttachment.controlledEvidence.rawInputRejectionCases, 'hostStorageAttachment.controlledEvidence.rawInputRejectionCases');
  for (const rawInputCase of ['path', 'url', 'body', 'base64', 'bytes']) {
    if (!hostStorageAttachment.controlledEvidence.rawInputRejectionCases.includes(rawInputCase)) {
      throw new Error(`hostStorageAttachment.controlledEvidence.rawInputRejectionCases must include ${rawInputCase}`);
    }
  }
  if (hostStorageAttachment.controlledEvidence.appletUploadExposed !== false) {
    throw new Error('hostStorageAttachment.controlledEvidence.appletUploadExposed must be false');
  }
  if (hostStorageAttachment.controlledEvidence.inputSnapshotWriteExposed !== false) {
    throw new Error('hostStorageAttachment.controlledEvidence.inputSnapshotWriteExposed must be false');
  }
  if (!isRecord(hostStorageAttachment.claimBoundary)) {
    throw new Error('hostStorageAttachment.claimBoundary must be an object');
  }
  assertStringArray(hostStorageAttachment.claimBoundary.doesNotProve, 'hostStorageAttachment.claimBoundary.doesNotProve');
  for (const requiredClaimBoundary of [
    'real Desktop Host Storage runtime',
    'real Host Storage upload',
    'Run input_snapshot write from applet',
    'attachment persistence E2E',
    'Desktop Host + Station + applet E2E',
  ]) {
    if (!hostStorageAttachment.claimBoundary.doesNotProve.includes(requiredClaimBoundary)) {
      throw new Error(`hostStorageAttachment.claimBoundary.doesNotProve must include ${requiredClaimBoundary}`);
    }
  }
}

function validateRuntimeLogStream(runtimeLogStream) {
  if (!isRecord(runtimeLogStream)) {
    throw new Error('runtimeLogStream must be an object');
  }
  assertString(runtimeLogStream.readiness, 'runtimeLogStream.readiness');
  if (runtimeLogStream.readiness !== 'controlled_local_upstream') {
    throw new Error('runtimeLogStream.readiness must be controlled_local_upstream until real runtime stream is wired');
  }
  assertString(runtimeLogStream.owner, 'runtimeLogStream.owner');
  if (runtimeLogStream.owner !== 'desktop_host') {
    throw new Error('runtimeLogStream.owner must be desktop_host');
  }
  assertString(runtimeLogStream.source, 'runtimeLogStream.source');
  if (runtimeLogStream.source !== 'host_sandbox_cdp') {
    throw new Error('runtimeLogStream.source must be host_sandbox_cdp');
  }
  assertString(runtimeLogStream.evidenceClass, 'runtimeLogStream.evidenceClass');
  if (runtimeLogStream.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error('runtimeLogStream.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM');
  }
  assertStringArray(runtimeLogStream.levels, 'runtimeLogStream.levels');
  if (JSON.stringify(runtimeLogStream.levels) !== JSON.stringify(['log', 'warn', 'error'])) {
    throw new Error('runtimeLogStream.levels must be log, warn, error');
  }
  assertStringArray(runtimeLogStream.forbiddenMethods, 'runtimeLogStream.forbiddenMethods');
  for (const forbiddenMethod of ['atelier.logs.subscribe', 'runtime.logs.subscribe', 'atelier.console.subscribe', 'console.logs.subscribe']) {
    if (!runtimeLogStream.forbiddenMethods.includes(forbiddenMethod)) {
      throw new Error(`runtimeLogStream.forbiddenMethods must include ${forbiddenMethod}`);
    }
  }
  assertStringArray(runtimeLogStream.forbiddenFields, 'runtimeLogStream.forbiddenFields');
  for (const forbiddenField of ['body', 'html', 'iframe', 'url', 'src', 'file', 'path', 'execute', 'run', 'shell']) {
    if (!runtimeLogStream.forbiddenFields.includes(forbiddenField)) {
      throw new Error(`runtimeLogStream.forbiddenFields must include ${forbiddenField}`);
    }
  }
  if (!isRecord(runtimeLogStream.controlledEvidence)) {
    throw new Error('runtimeLogStream.controlledEvidence must describe controlled runtime log stream evidence');
  }
  if (runtimeLogStream.controlledEvidence.readiness !== 'controlled_local_upstream') {
    throw new Error('runtimeLogStream.controlledEvidence.readiness must be controlled_local_upstream');
  }
  if (runtimeLogStream.controlledEvidence.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error('runtimeLogStream.controlledEvidence.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM');
  }
  if (runtimeLogStream.controlledEvidence.gate !== 'atelier:runtime-log-stream-controlled-gate') {
    throw new Error('runtimeLogStream.controlledEvidence.gate must be atelier:runtime-log-stream-controlled-gate');
  }
  assertStringArray(runtimeLogStream.controlledEvidence.evidenceFiles, 'runtimeLogStream.controlledEvidence.evidenceFiles');
  if (!runtimeLogStream.controlledEvidence.evidenceFiles.includes('tooling/acceptance/evidence/applets/official-applet/atelier-runtime-log-stream-controlled-gate.json')) {
    throw new Error('runtimeLogStream.controlledEvidence.evidenceFiles must include runtime log stream evidence JSON');
  }
  if (runtimeLogStream.controlledEvidence.source !== runtimeLogStream.source) {
    throw new Error('runtimeLogStream.controlledEvidence.source must match runtimeLogStream.source');
  }
  if (JSON.stringify(runtimeLogStream.controlledEvidence.orderedLevels) !== JSON.stringify(runtimeLogStream.levels)) {
    throw new Error('runtimeLogStream.controlledEvidence.orderedLevels must match runtimeLogStream.levels');
  }
  assertStringArray(runtimeLogStream.controlledEvidence.normalizedFields, 'runtimeLogStream.controlledEvidence.normalizedFields');
  for (const field of ['streamId', 'seq', 'level', 'message', 'source', 'evidenceClass']) {
    if (!runtimeLogStream.controlledEvidence.normalizedFields.includes(field)) {
      throw new Error(`runtimeLogStream.controlledEvidence.normalizedFields must include ${field}`);
    }
  }
  if (runtimeLogStream.controlledEvidence.appletSubscriptionExposed !== false) {
    throw new Error('runtimeLogStream.controlledEvidence.appletSubscriptionExposed must be false');
  }
  if (!isRecord(runtimeLogStream.claimBoundary)) {
    throw new Error('runtimeLogStream.claimBoundary must be an object');
  }
  assertStringArray(runtimeLogStream.claimBoundary.doesNotProve, 'runtimeLogStream.claimBoundary.doesNotProve');
  for (const gap of ['real Run runtime stream', 'applet log subscription capability', 'complete Host + Station + applet E2E']) {
    if (!runtimeLogStream.claimBoundary.doesNotProve.includes(gap)) {
      throw new Error(`runtimeLogStream.claimBoundary.doesNotProve must include ${gap}`);
    }
  }
}

function validateArtifactBodyFetch(artifactBodyFetch, artifactPreview, workbenchSurface, payload, intent, transport) {
  if (!isRecord(artifactBodyFetch)) {
    throw new Error('artifactBodyFetch must be an object');
  }
  assertString(artifactBodyFetch.readiness, 'artifactBodyFetch.readiness');
  if (artifactBodyFetch.readiness !== 'controlled_local_upstream') {
    throw new Error('artifactBodyFetch.readiness must remain controlled_local_upstream until real provider/executor artifact blob production is proven');
  }
  assertString(artifactBodyFetch.owner, 'artifactBodyFetch.owner');
  if (artifactBodyFetch.owner !== 'station') {
    throw new Error('artifactBodyFetch.owner must be station');
  }
  assertString(artifactBodyFetch.source, 'artifactBodyFetch.source');
  if (artifactBodyFetch.source !== 'agent_task_artifact_blobs') {
    throw new Error('artifactBodyFetch.source must be agent_task_artifact_blobs');
  }
  assertString(artifactBodyFetch.evidenceClass, 'artifactBodyFetch.evidenceClass');
  if (artifactBodyFetch.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error('artifactBodyFetch.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM');
  }
  assertString(artifactBodyFetch.transport, 'artifactBodyFetch.transport');
  if (artifactBodyFetch.transport !== 'service_binding') {
    throw new Error('artifactBodyFetch.transport must be service_binding');
  }
  assertString(artifactBodyFetch.method, 'artifactBodyFetch.method');
  if (artifactBodyFetch.method !== 'atelier.artifact.body.fetch') {
    throw new Error('artifactBodyFetch.method must be atelier.artifact.body.fetch');
  }
  validateArtifactRefShape(artifactBodyFetch.bodyRefShape, artifactPreview.allowedBodyRefSchemes, 'artifactBodyFetch.bodyRefShape');
  if (JSON.stringify(artifactBodyFetch.bodyRefShape) !== JSON.stringify(artifactPreview.bodyRefShape)) {
    throw new Error('artifactBodyFetch.bodyRefShape must match artifactPreview.bodyRefShape');
  }
  assertString(artifactBodyFetch.allowedBodyKindsFrom, 'artifactBodyFetch.allowedBodyKindsFrom');
  if (artifactBodyFetch.allowedBodyKindsFrom !== 'workbenchSurface.artifactBodyKinds') {
    throw new Error('artifactBodyFetch.allowedBodyKindsFrom must be workbenchSurface.artifactBodyKinds');
  }
  if (!Number.isInteger(artifactBodyFetch.defaultMaxBytes) || artifactBodyFetch.defaultMaxBytes <= 0) {
    throw new Error('artifactBodyFetch.defaultMaxBytes must be a positive integer');
  }
  assertStringArray(artifactBodyFetch.requiredSafetyChecks, 'artifactBodyFetch.requiredSafetyChecks');
  for (const check of ['actor_owned_task', 'canonical_body_ref', 'active_retention', 'not_expired', 'fetchable_text_kind', 'stored_hash_matches_body', 'expected_hash_matches_body', 'utf8_max_bytes_truncation']) {
    if (!artifactBodyFetch.requiredSafetyChecks.includes(check)) {
      throw new Error(`artifactBodyFetch.requiredSafetyChecks must include ${check}`);
    }
  }
  assertStringArray(artifactBodyFetch.forbiddenActions, 'artifactBodyFetch.forbiddenActions');
  if (JSON.stringify(artifactBodyFetch.forbiddenActions) !== JSON.stringify(payload.forbiddenActions)) {
    throw new Error('artifactBodyFetch.forbiddenActions must match methodPayloads.atelier.artifact.body.fetch.forbiddenActions');
  }
  if (JSON.stringify(payload.allowedBodyKinds) !== JSON.stringify(workbenchSurface.artifactBodyKinds)) {
    throw new Error('atelier.artifact.body.fetch.allowedBodyKinds must match workbenchSurface.artifactBodyKinds');
  }
  if (!isRecord(artifactBodyFetch.productWindowEvidence)) {
    throw new Error('artifactBodyFetch.productWindowEvidence must describe focused product-window body fetch evidence');
  }
  if (artifactBodyFetch.productWindowEvidence.readiness !== 'focused_real_product_path') {
    throw new Error('artifactBodyFetch.productWindowEvidence.readiness must be focused_real_product_path');
  }
  if (artifactBodyFetch.productWindowEvidence.evidenceClass !== 'REAL_PRODUCT_PATH') {
    throw new Error('artifactBodyFetch.productWindowEvidence.evidenceClass must be REAL_PRODUCT_PATH');
  }
  if (artifactBodyFetch.productWindowEvidence.gate !== 'applet:atelier-artifact-body-fetch-product-window-gate') {
    throw new Error('artifactBodyFetch.productWindowEvidence.gate must be applet:atelier-artifact-body-fetch-product-window-gate');
  }
  assertStringArray(artifactBodyFetch.productWindowEvidence.evidenceFiles, 'artifactBodyFetch.productWindowEvidence.evidenceFiles');
  for (const evidenceFile of [
    'tooling/acceptance/evidence/applets/official-applet/atelier-artifact-body-fetch-product-window-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-artifact-body-fetch-product-window-evidence.json',
  ]) {
    if (!artifactBodyFetch.productWindowEvidence.evidenceFiles.includes(evidenceFile)) {
      throw new Error(`artifactBodyFetch.productWindowEvidence.evidenceFiles must include ${evidenceFile}`);
    }
  }
  if (artifactBodyFetch.productWindowEvidence.telemetryEvent !== 'atelier.artifact.body.fetched') {
    throw new Error('artifactBodyFetch.productWindowEvidence.telemetryEvent must be atelier.artifact.body.fetched');
  }
  if (artifactBodyFetch.productWindowEvidence.metadataOnly !== true) {
    throw new Error('artifactBodyFetch.productWindowEvidence.metadataOnly must be true');
  }
  if (artifactBodyFetch.productWindowEvidence.rawTextExposedToEvidence !== false) {
    throw new Error('artifactBodyFetch.productWindowEvidence.rawTextExposedToEvidence must be false');
  }
  assertStringArray(artifactBodyFetch.productWindowEvidence.metadataFields, 'artifactBodyFetch.productWindowEvidence.metadataFields');
  for (const field of ['taskId', 'artifactId', 'bodyRef', 'bodyKind', 'bodyHash', 'bodySize', 'truncated', 'retentionStatus']) {
    if (!artifactBodyFetch.productWindowEvidence.metadataFields.includes(field)) {
      throw new Error(`artifactBodyFetch.productWindowEvidence.metadataFields must include ${field}`);
    }
  }
  validateArtifactBodyFetchControlledEvidence(artifactBodyFetch);
  validateArtifactBodyFetchPayloadControlledEvidence(artifactBodyFetch, payload, intent, transport);
  if (!isRecord(artifactBodyFetch.claimBoundary)) {
    throw new Error('artifactBodyFetch.claimBoundary must be an object');
  }
  assertStringArray(artifactBodyFetch.claimBoundary.doesNotProve, 'artifactBodyFetch.claimBoundary.doesNotProve');
  for (const gap of ['live Desktop webview renderer', 'real Station artifact blob production by provider/executor', 'complete Host + Station + applet E2E']) {
    if (!artifactBodyFetch.claimBoundary.doesNotProve.includes(gap)) {
      throw new Error(`artifactBodyFetch.claimBoundary.doesNotProve must include ${gap}`);
    }
  }
  if (artifactBodyFetch.claimBoundary.doesNotProve.includes('real Desktop product-window artifact body fetch')) {
    throw new Error('artifactBodyFetch.claimBoundary.doesNotProve must not list product-window body fetch after focused product-window evidence exists');
  }
}

function validateArtifactBodyFetchPayloadControlledEvidence(artifactBodyFetch, payload, intent, transport) {
  if (!isRecord(payload)) {
    throw new Error('methodPayloads.atelier.artifact.body.fetch must be an object');
  }
  if (!isRecord(intent)) {
    throw new Error('methodIntents.atelier.artifact.body.fetch must be an object');
  }
  if (!isRecord(transport)) {
    throw new Error('methodTransports.atelier.artifact.body.fetch must be an object');
  }
  const controlledEvidence = payload.controlledEvidence;
  if (!isRecord(controlledEvidence)) {
    throw new Error('methodPayloads.atelier.artifact.body.fetch.controlledEvidence must describe controlled artifact body fetch payload evidence');
  }
  if (controlledEvidence.readiness !== 'controlled_local_upstream') {
    throw new Error('methodPayloads.atelier.artifact.body.fetch.controlledEvidence.readiness must be controlled_local_upstream');
  }
  if (controlledEvidence.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error('methodPayloads.atelier.artifact.body.fetch.controlledEvidence.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM');
  }
  const expectedGates = [
    'atelier:artifact-body-fetch-controlled-gate',
    'applet:atelier-artifact-body-fetch-product-window-gate',
    'atelier:projection-contract-gate',
    'atelier:official-frontend-gate',
    'atelier:bridge-runtime-gate',
  ];
  assertStringArray(controlledEvidence.gates, 'methodPayloads.atelier.artifact.body.fetch.controlledEvidence.gates');
  if (JSON.stringify(controlledEvidence.gates) !== JSON.stringify(expectedGates)) {
    throw new Error('methodPayloads.atelier.artifact.body.fetch.controlledEvidence.gates must match artifact body fetch evidence gates');
  }
  const expectedEvidenceFiles = [
    'tooling/acceptance/evidence/applets/official-applet/atelier-artifact-body-fetch-controlled-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-artifact-body-fetch-product-window-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-artifact-body-fetch-product-window-evidence.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-official-frontend-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-bridge-runtime-gate.json',
  ];
  assertStringArray(controlledEvidence.evidenceFiles, 'methodPayloads.atelier.artifact.body.fetch.controlledEvidence.evidenceFiles');
  if (JSON.stringify(controlledEvidence.evidenceFiles) !== JSON.stringify(expectedEvidenceFiles)) {
    throw new Error('methodPayloads.atelier.artifact.body.fetch.controlledEvidence.evidenceFiles must match artifact body fetch evidence files');
  }
  if (controlledEvidence.method !== 'atelier.artifact.body.fetch') {
    throw new Error('methodPayloads.atelier.artifact.body.fetch.controlledEvidence.method must be atelier.artifact.body.fetch');
  }
  for (const field of ['intentOwner', 'intentKind', 'sideEffectClass', 'executionForbidden']) {
    if (controlledEvidence[field] !== intent[field]) {
      throw new Error(`methodPayloads.atelier.artifact.body.fetch.controlledEvidence.${field} must match methodIntents.atelier.artifact.body.fetch.${field}`);
    }
  }
  for (const field of ['transportKind', 'frontendCall', 'service', 'httpMethod', 'publicPath', 'stationPath', 'stationHandler', 'desktopGateway']) {
    if (controlledEvidence[field] !== transport[field]) {
      throw new Error(`methodPayloads.atelier.artifact.body.fetch.controlledEvidence.${field} must match methodTransports.atelier.artifact.body.fetch.${field}`);
    }
  }
  for (const field of ['requiredFields', 'optionalFields', 'responseFields', 'allowedBodyKinds', 'forbiddenActions']) {
    if (JSON.stringify(controlledEvidence[field]) !== JSON.stringify(payload[field])) {
      throw new Error(`methodPayloads.atelier.artifact.body.fetch.controlledEvidence.${field} must match payload.${field}`);
    }
  }
  for (const field of ['owner', 'source', 'bodyRefShape', 'allowedBodyKindsFrom', 'defaultMaxBytes', 'requiredSafetyChecks']) {
    if (JSON.stringify(controlledEvidence[field]) !== JSON.stringify(artifactBodyFetch[field])) {
      throw new Error(`methodPayloads.atelier.artifact.body.fetch.controlledEvidence.${field} must match artifactBodyFetch.${field}`);
    }
  }
  for (const [field, expected] of Object.entries({
    focusedProductWindowBodyFetchProven: true,
    metadataOnlyTelemetryProven: true,
    rawTextExposedToEvidence: false,
    stationSafetyChecksProven: true,
    officialResponseGuardProven: true,
    prototypeBridgeResponseGuardProven: true,
    appletRawBodyReadExposed: false,
    appletFilePathUrlOpenExposed: false,
    realProviderExecutorArtifactBlobProductionProven: false,
    realLiveDesktopWebviewRendererProven: false,
    realHostStationAppletE2EProven: false,
  })) {
    if (controlledEvidence[field] !== expected) {
      throw new Error(`methodPayloads.atelier.artifact.body.fetch.controlledEvidence.${field} must be ${expected}`);
    }
  }
}

function validateArtifactBodyFetchControlledEvidence(artifactBodyFetch) {
  const controlledEvidence = artifactBodyFetch.controlledEvidence;
  if (!isRecord(controlledEvidence)) {
    throw new Error('artifactBodyFetch.controlledEvidence must describe controlled artifact body fetch evidence');
  }
  if (controlledEvidence.readiness !== 'controlled_local_upstream') {
    throw new Error('artifactBodyFetch.controlledEvidence.readiness must be controlled_local_upstream');
  }
  if (controlledEvidence.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error('artifactBodyFetch.controlledEvidence.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM');
  }
  const expectedGates = [
    'atelier:artifact-body-fetch-controlled-gate',
    'applet:atelier-artifact-body-fetch-product-window-gate',
    'atelier:projection-contract-gate',
  ];
  assertStringArray(controlledEvidence.gates, 'artifactBodyFetch.controlledEvidence.gates');
  if (JSON.stringify(controlledEvidence.gates) !== JSON.stringify(expectedGates)) {
    throw new Error('artifactBodyFetch.controlledEvidence.gates must match controlled and focused product-window body fetch evidence gates');
  }
  const expectedEvidenceFiles = [
    'tooling/acceptance/evidence/applets/official-applet/atelier-artifact-body-fetch-controlled-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-artifact-body-fetch-product-window-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-artifact-body-fetch-product-window-evidence.json',
  ];
  assertStringArray(controlledEvidence.evidenceFiles, 'artifactBodyFetch.controlledEvidence.evidenceFiles');
  if (JSON.stringify(controlledEvidence.evidenceFiles) !== JSON.stringify(expectedEvidenceFiles)) {
    throw new Error('artifactBodyFetch.controlledEvidence.evidenceFiles must match controlled and focused product-window body fetch evidence files');
  }
  for (const field of ['owner', 'source', 'transport', 'method', 'allowedBodyKindsFrom', 'defaultMaxBytes']) {
    if (JSON.stringify(controlledEvidence[field]) !== JSON.stringify(artifactBodyFetch[field])) {
      throw new Error(`artifactBodyFetch.controlledEvidence.${field} must match artifactBodyFetch.${field}`);
    }
  }
  for (const field of ['bodyRefShape', 'requiredSafetyChecks', 'forbiddenActions']) {
    if (JSON.stringify(controlledEvidence[field]) !== JSON.stringify(artifactBodyFetch[field])) {
      throw new Error(`artifactBodyFetch.controlledEvidence.${field} must match artifactBodyFetch.${field}`);
    }
  }
  for (const [field, expected] of Object.entries({
    focusedProductWindowBodyFetchProven: true,
    metadataOnlyTelemetryProven: true,
    rawTextExposedToEvidence: false,
    stationSafetyChecksProven: true,
    appletRawBodyReadExposed: false,
    appletFilePathUrlOpenExposed: false,
    realProviderExecutorArtifactBlobProductionProven: false,
    realLiveDesktopWebviewRendererProven: false,
    realHostStationAppletE2EProven: false,
  })) {
    if (controlledEvidence[field] !== expected) {
      throw new Error(`artifactBodyFetch.controlledEvidence.${field} must be ${expected}`);
    }
  }
}

function validateArtifactRendererSurface(artifactRendererSurface, payload) {
  if (!isRecord(artifactRendererSurface)) {
    throw new Error('artifactRendererSurface must be an object');
  }
  assertString(artifactRendererSurface.readiness, 'artifactRendererSurface.readiness');
  if (artifactRendererSurface.readiness !== 'controlled_local_upstream') {
    throw new Error('artifactRendererSurface.readiness must be controlled_local_upstream until live Desktop webview rendering is proven');
  }
  assertString(artifactRendererSurface.owner, 'artifactRendererSurface.owner');
  if (artifactRendererSurface.owner !== 'desktop_host') {
    throw new Error('artifactRendererSurface.owner must be desktop_host');
  }
  assertString(artifactRendererSurface.source, 'artifactRendererSurface.source');
  if (artifactRendererSurface.source !== 'desktop_host_adapter_unit_matrix') {
    throw new Error('artifactRendererSurface.source must be desktop_host_adapter_unit_matrix');
  }
  assertString(artifactRendererSurface.evidenceClass, 'artifactRendererSurface.evidenceClass');
  if (artifactRendererSurface.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error('artifactRendererSurface.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM');
  }
  assertString(artifactRendererSurface.surfaceKind, 'artifactRendererSurface.surfaceKind');
  if (artifactRendererSurface.surfaceKind !== 'host_sandbox_visual_surface') {
    throw new Error('artifactRendererSurface.surfaceKind must be host_sandbox_visual_surface');
  }
  assertStringArray(artifactRendererSurface.rendererKinds, 'artifactRendererSurface.rendererKinds');
  if (JSON.stringify(artifactRendererSurface.rendererKinds) !== JSON.stringify(['markdown', 'web', 'image', 'diff'])) {
    throw new Error('artifactRendererSurface.rendererKinds must be markdown, web, image, diff');
  }
  assertString(artifactRendererSurface.rendererOwner, 'artifactRendererSurface.rendererOwner');
  if (artifactRendererSurface.rendererOwner !== 'desktop_host') {
    throw new Error('artifactRendererSurface.rendererOwner must be desktop_host');
  }
  assertString(artifactRendererSurface.rendererMode, 'artifactRendererSurface.rendererMode');
  if (artifactRendererSurface.rendererMode !== 'host_sandbox_manifest') {
    throw new Error('artifactRendererSurface.rendererMode must be host_sandbox_manifest');
  }
  assertString(artifactRendererSurface.requiredRendererCapabilitiesFrom, 'artifactRendererSurface.requiredRendererCapabilitiesFrom');
  if (artifactRendererSurface.requiredRendererCapabilitiesFrom !== 'methodPayloads.atelier.artifact.preview.open.requiredRendererCapabilities') {
    throw new Error('artifactRendererSurface.requiredRendererCapabilitiesFrom must point at preview open requiredRendererCapabilities');
  }
  if (!payload.requiredRendererCapabilities?.includes('host_visual_renderer_surface')) {
    throw new Error('artifact preview open requiredRendererCapabilities must include host_visual_renderer_surface');
  }
  const expectedSandboxPolicy = {
    allowScripts: false,
    allowNetwork: false,
    allowExternalNavigation: false,
    allowFileAccess: false,
    allowPatchApply: false,
  };
  if (JSON.stringify(artifactRendererSurface.sandboxPolicy) !== JSON.stringify(expectedSandboxPolicy)) {
    throw new Error('artifactRendererSurface.sandboxPolicy must keep scripts/network/navigation/file/patch disabled');
  }
  if (artifactRendererSurface.rawBodyExposedToApplet !== false) {
    throw new Error('artifactRendererSurface.rawBodyExposedToApplet must be false');
  }
  if (artifactRendererSurface.appletRenderable !== false) {
    throw new Error('artifactRendererSurface.appletRenderable must be false');
  }
  assertStringArray(artifactRendererSurface.forbiddenFields, 'artifactRendererSurface.forbiddenFields');
  for (const forbiddenField of ['url', 'src', 'href', 'iframe', 'html', 'image', 'file', 'path', 'execute', 'run', 'openExternalUrl']) {
    if (!artifactRendererSurface.forbiddenFields.includes(forbiddenField)) {
      throw new Error(`artifactRendererSurface.forbiddenFields must include ${forbiddenField}`);
    }
  }
  if (!isRecord(artifactRendererSurface.controlledEvidence)) {
    throw new Error('artifactRendererSurface.controlledEvidence must describe controlled artifact renderer evidence');
  }
  if (artifactRendererSurface.controlledEvidence.readiness !== 'controlled_local_upstream') {
    throw new Error('artifactRendererSurface.controlledEvidence.readiness must be controlled_local_upstream');
  }
  if (artifactRendererSurface.controlledEvidence.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error('artifactRendererSurface.controlledEvidence.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM');
  }
  if (artifactRendererSurface.controlledEvidence.gate !== 'atelier:artifact-renderer-controlled-gate') {
    throw new Error('artifactRendererSurface.controlledEvidence.gate must be atelier:artifact-renderer-controlled-gate');
  }
  assertStringArray(artifactRendererSurface.controlledEvidence.evidenceFiles, 'artifactRendererSurface.controlledEvidence.evidenceFiles');
  if (!artifactRendererSurface.controlledEvidence.evidenceFiles.includes('tooling/acceptance/evidence/applets/official-applet/atelier-artifact-renderer-controlled-gate.json')) {
    throw new Error('artifactRendererSurface.controlledEvidence.evidenceFiles must include artifact renderer evidence JSON');
  }
  if (artifactRendererSurface.controlledEvidence.source !== artifactRendererSurface.source) {
    throw new Error('artifactRendererSurface.controlledEvidence.source must match artifactRendererSurface.source');
  }
  if (artifactRendererSurface.controlledEvidence.surfaceKind !== artifactRendererSurface.surfaceKind) {
    throw new Error('artifactRendererSurface.controlledEvidence.surfaceKind must match artifactRendererSurface.surfaceKind');
  }
  assertStringArray(artifactRendererSurface.controlledEvidence.rendererKinds, 'artifactRendererSurface.controlledEvidence.rendererKinds');
  if (JSON.stringify(artifactRendererSurface.controlledEvidence.rendererKinds) !== JSON.stringify(artifactRendererSurface.rendererKinds)) {
    throw new Error('artifactRendererSurface.controlledEvidence.rendererKinds must match artifactRendererSurface.rendererKinds');
  }
  assertStringArray(artifactRendererSurface.controlledEvidence.runtimeEvidenceBlocks, 'artifactRendererSurface.controlledEvidence.runtimeEvidenceBlocks');
  for (const block of ['markdownRuntimeEvidence', 'diffRuntimeEvidence', 'webRuntimeEvidence', 'imageRuntimeEvidence']) {
    if (!artifactRendererSurface.controlledEvidence.runtimeEvidenceBlocks.includes(block)) {
      throw new Error(`artifactRendererSurface.controlledEvidence.runtimeEvidenceBlocks must include ${block}`);
    }
  }
  assertStringArray(artifactRendererSurface.controlledEvidence.rawExposureFlags, 'artifactRendererSurface.controlledEvidence.rawExposureFlags');
  for (const flag of ['rawBodyExposedToApplet', 'rawDiffExposedToApplet', 'rawHtmlExposedToApplet', 'rawImageBytesExposedToApplet']) {
    if (!artifactRendererSurface.controlledEvidence.rawExposureFlags.includes(flag)) {
      throw new Error(`artifactRendererSurface.controlledEvidence.rawExposureFlags must include ${flag}`);
    }
  }
  if (artifactRendererSurface.controlledEvidence.appletRenderable !== false) {
    throw new Error('artifactRendererSurface.controlledEvidence.appletRenderable must be false');
  }
  if (artifactRendererSurface.controlledEvidence.liveWebviewProven !== false) {
    throw new Error('artifactRendererSurface.controlledEvidence.liveWebviewProven must be false');
  }
  if (!isRecord(artifactRendererSurface.claimBoundary)) {
    throw new Error('artifactRendererSurface.claimBoundary must be an object');
  }
  assertStringArray(artifactRendererSurface.claimBoundary.doesNotProve, 'artifactRendererSurface.claimBoundary.doesNotProve');
  for (const gap of ['real iframe/image/html/diff rendering in a live Desktop webview', 'real artifact blob fetch from Station storage', 'complete Host + Station + applet E2E']) {
    if (!artifactRendererSurface.claimBoundary.doesNotProve.includes(gap)) {
      throw new Error(`artifactRendererSurface.claimBoundary.doesNotProve must include ${gap}`);
    }
  }
}

function validateReadOnlyProjectionSurfaces(readOnlyProjectionSurfaces) {
  if (!isRecord(readOnlyProjectionSurfaces)) {
    throw new Error('readOnlyProjectionSurfaces must be an object');
  }
  const expectedSurfaces = {
    project_health: {
      displayFields: [
        'project.state',
        'completion',
        'openBlockers',
        'residualRisks',
        'milestones',
        'memoryCandidates',
        'policy.rules',
        'defects',
      ],
      forbiddenActions: [
        'project.accept',
        'project.waive',
        'project.mutate',
        'predicate.evaluate',
        'memory.write',
        'policy.override',
        'defect.accept',
        'defect.reject',
      ],
    },
    task_graph: {
      displayFields: [
        'rootTaskIds',
        'tasks',
        'edges',
        'parallelPolicy',
        'artifactIds',
        'gateIds',
      ],
      forbiddenActions: [
        'taskGraph.schedule',
        'taskGraph.execute',
        'taskGraph.replan',
        'taskGraph.diff.apply',
        'taskGraph.merge',
        'integrator.run',
        'node.reorder',
      ],
    },
  };
  for (const [surfaceId, expected] of Object.entries(expectedSurfaces)) {
    const surface = readOnlyProjectionSurfaces[surfaceId];
    if (!isRecord(surface)) {
      throw new Error(`readOnlyProjectionSurfaces.${surfaceId} must be an object`);
    }
    assertString(surface.owner, `readOnlyProjectionSurfaces.${surfaceId}.owner`);
    if (surface.owner !== 'station') {
      throw new Error(`readOnlyProjectionSurfaces.${surfaceId}.owner must be station`);
    }
    assertString(surface.surfaceKind, `readOnlyProjectionSurfaces.${surfaceId}.surfaceKind`);
    if (surface.surfaceKind !== 'read_only_projection') {
      throw new Error(`readOnlyProjectionSurfaces.${surfaceId}.surfaceKind must be read_only_projection`);
    }
    if (surface.projectionOnly !== true) {
      throw new Error(`readOnlyProjectionSurfaces.${surfaceId}.projectionOnly must be true`);
    }
    assertStringArray(surface.displayFields, `readOnlyProjectionSurfaces.${surfaceId}.displayFields`);
    if (JSON.stringify(surface.displayFields) !== JSON.stringify(expected.displayFields)) {
      throw new Error(`readOnlyProjectionSurfaces.${surfaceId}.displayFields must match the canonical read-only projection display fields`);
    }
    assertStringArray(surface.forbiddenActions, `readOnlyProjectionSurfaces.${surfaceId}.forbiddenActions`);
    if (JSON.stringify(surface.forbiddenActions) !== JSON.stringify(expected.forbiddenActions)) {
      throw new Error(`readOnlyProjectionSurfaces.${surfaceId}.forbiddenActions must match the canonical forbidden mutation surface`);
    }
    if (surfaceId === 'task_graph') {
      validateTaskGraphEvidenceRefResolution(surface.evidenceRefResolution, `readOnlyProjectionSurfaces.${surfaceId}.evidenceRefResolution`);
    }
    validateReadOnlyProjectionSurfaceControlledEvidence(surfaceId, surface, expected);
  }
}

function validateTaskGraphEvidenceRefResolution(evidenceRefResolution, name) {
  if (!isRecord(evidenceRefResolution)) {
    throw new Error(`${name} must describe TaskGraph evidence ref resolution policy`);
  }
  for (const [field, expectedValue] of Object.entries({
    scope: 'current_workspace_projection_index',
    artifactRefIds: 'workspace.artifacts[*].id',
    gateRefIds: 'workspace.gates[*].id',
    unresolvedPolicy: 'display_unresolved',
    unresolvedLabel: '(unresolved)',
  })) {
    if (evidenceRefResolution[field] !== expectedValue) {
      throw new Error(`${name}.${field} must be ${expectedValue}`);
    }
  }
  for (const [field, expectedValue] of Object.entries({
    hiddenRefCountSeparateFromUnresolvedCount: true,
    readOnlyProjectionOnly: true,
    appletMayResolveMissingRefs: false,
    appletMayFetchRawArtifactBody: false,
    appletMayRunGates: false,
    realStationProducerProven: false,
  })) {
    if (evidenceRefResolution[field] !== expectedValue) {
      throw new Error(`${name}.${field} must be ${expectedValue}`);
    }
  }
}

function validateReadOnlyProjectionSurfaceControlledEvidence(surfaceId, surface, expected) {
  const controlledEvidence = surface.controlledEvidence;
  if (!isRecord(controlledEvidence)) {
    throw new Error(`readOnlyProjectionSurfaces.${surfaceId}.controlledEvidence must describe controlled read-only projection evidence`);
  }
  if (controlledEvidence.readiness !== 'controlled_local_upstream') {
    throw new Error(`readOnlyProjectionSurfaces.${surfaceId}.controlledEvidence.readiness must be controlled_local_upstream`);
  }
  if (controlledEvidence.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error(`readOnlyProjectionSurfaces.${surfaceId}.controlledEvidence.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM`);
  }
  const expectedGates = ['atelier:official-frontend-gate', 'atelier:bridge-runtime-gate'];
  assertStringArray(controlledEvidence.gates, `readOnlyProjectionSurfaces.${surfaceId}.controlledEvidence.gates`);
  if (JSON.stringify(controlledEvidence.gates) !== JSON.stringify(expectedGates)) {
    throw new Error(`readOnlyProjectionSurfaces.${surfaceId}.controlledEvidence.gates must be atelier:official-frontend-gate, atelier:bridge-runtime-gate`);
  }
  const expectedEvidenceFiles = [
    'tooling/acceptance/evidence/applets/official-applet/atelier-official-frontend-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-bridge-runtime-gate.json',
  ];
  assertStringArray(controlledEvidence.evidenceFiles, `readOnlyProjectionSurfaces.${surfaceId}.controlledEvidence.evidenceFiles`);
  if (JSON.stringify(controlledEvidence.evidenceFiles) !== JSON.stringify(expectedEvidenceFiles)) {
    throw new Error(`readOnlyProjectionSurfaces.${surfaceId}.controlledEvidence.evidenceFiles must match the controlled read-only projection evidence files`);
  }
  if (controlledEvidence.surfaceId !== surfaceId) {
    throw new Error(`readOnlyProjectionSurfaces.${surfaceId}.controlledEvidence.surfaceId must be ${surfaceId}`);
  }
  assertStringArray(controlledEvidence.displayFields, `readOnlyProjectionSurfaces.${surfaceId}.controlledEvidence.displayFields`);
  if (JSON.stringify(controlledEvidence.displayFields) !== JSON.stringify(expected.displayFields)) {
    throw new Error(`readOnlyProjectionSurfaces.${surfaceId}.controlledEvidence.displayFields must match displayFields`);
  }
  if (surfaceId === 'task_graph') {
    validateTaskGraphEvidenceRefResolution(
      controlledEvidence.evidenceRefResolution,
      `readOnlyProjectionSurfaces.${surfaceId}.controlledEvidence.evidenceRefResolution`,
    );
    if (JSON.stringify(controlledEvidence.evidenceRefResolution) !== JSON.stringify(surface.evidenceRefResolution)) {
      throw new Error(`readOnlyProjectionSurfaces.${surfaceId}.controlledEvidence.evidenceRefResolution must match evidenceRefResolution`);
    }
  }
  assertStringArray(controlledEvidence.forbiddenActions, `readOnlyProjectionSurfaces.${surfaceId}.controlledEvidence.forbiddenActions`);
  if (JSON.stringify(controlledEvidence.forbiddenActions) !== JSON.stringify(expected.forbiddenActions)) {
    throw new Error(`readOnlyProjectionSurfaces.${surfaceId}.controlledEvidence.forbiddenActions must match forbiddenActions`);
  }
  const commonExpected = {
    readOnlyProjection: true,
    realHostStationAppletE2EProven: false,
  };
  const surfaceExpected =
    surfaceId === 'project_health'
      ? {
          appletProjectMutationExposed: false,
          appletPredicateEvaluationExposed: false,
          appletMemoryWriteExposed: false,
          appletPolicyOverrideExposed: false,
          appletDefectLifecycleMutationExposed: false,
          realProjectGovernanceLifecycleProven: false,
          realAcceptancePredicateRuntimeProven: false,
          realPolicyEngineProven: false,
          realDefectGovernanceLifecycleProven: false,
        }
      : {
          appletTaskGraphScheduleExecuteExposed: false,
          appletTaskGraphReplanExposed: false,
          appletTaskGraphDiffApplyExposed: false,
          appletTaskGraphMergeExposed: false,
          appletIntegratorRunExposed: false,
          appletNodeReorderExposed: false,
          realTaskGraphProductionRuntimeProven: false,
          realIntegratorMergeRuntimeProven: false,
          realArtifactGateProductionProven: false,
        };
  for (const [field, expectedValue] of Object.entries({ ...commonExpected, ...surfaceExpected })) {
    if (controlledEvidence[field] !== expectedValue) {
      throw new Error(`readOnlyProjectionSurfaces.${surfaceId}.controlledEvidence.${field} must be ${expectedValue}`);
    }
  }
}

function validateDirectRunExecutionEvidence(directRunExecutionEvidence) {
  if (!isRecord(directRunExecutionEvidence)) {
    throw new Error('directRunExecutionEvidence must be an object');
  }
  assertString(directRunExecutionEvidence.owner, 'directRunExecutionEvidence.owner');
  if (directRunExecutionEvidence.owner !== 'station') {
    throw new Error('directRunExecutionEvidence.owner must be station');
  }
  assertString(directRunExecutionEvidence.surfaceKind, 'directRunExecutionEvidence.surfaceKind');
  if (directRunExecutionEvidence.surfaceKind !== 'read_only_execution_evidence') {
    throw new Error('directRunExecutionEvidence.surfaceKind must be read_only_execution_evidence');
  }
  if (directRunExecutionEvidence.projectionOnly !== true) {
    throw new Error('directRunExecutionEvidence.projectionOnly must be true');
  }
  assertString(directRunExecutionEvidence.source, 'directRunExecutionEvidence.source');
  if (directRunExecutionEvidence.source !== 'agent_direct_runs + agent_task_runs + agent_task_events + agent_task_artifacts + agent_task_gate_results + agent_task_budget_usages') {
    throw new Error('directRunExecutionEvidence.source must list the canonical Station evidence tables');
  }
  const expectedDisplayFields = [
    'directRunId',
    'taskId',
    'providerId',
    'modelIntent',
    'state',
    'traceId',
    'artifactRefs',
    'gateRefs',
    'budgetUsage',
    'failureArtifactRef',
    'cliHandoffRef',
  ];
  assertStringArray(directRunExecutionEvidence.displayFields, 'directRunExecutionEvidence.displayFields');
  if (JSON.stringify(directRunExecutionEvidence.displayFields) !== JSON.stringify(expectedDisplayFields)) {
    throw new Error('directRunExecutionEvidence.displayFields must match the canonical Station evidence refs');
  }
  const expectedForbiddenActions = [
    'directRun.start',
    'directRun.resume',
    'directRun.cancel',
    'provider.invoke',
    'model.run',
    'cli.execute',
    'shell.execute',
    'trace.write',
    'artifact.write',
    'gate.run',
    'budget.write',
    'inputSnapshot.read',
    'inputSnapshot.write',
    'HostStorage.write',
  ];
  assertStringArray(directRunExecutionEvidence.forbiddenActions, 'directRunExecutionEvidence.forbiddenActions');
  if (JSON.stringify(directRunExecutionEvidence.forbiddenActions) !== JSON.stringify(expectedForbiddenActions)) {
    throw new Error('directRunExecutionEvidence.forbiddenActions must match the canonical applet-forbidden DirectRun execution actions');
  }
  if (!isRecord(directRunExecutionEvidence.claimBoundary)) {
    throw new Error('directRunExecutionEvidence.claimBoundary must be an object');
  }
  assertStringArray(directRunExecutionEvidence.claimBoundary.doesNotProve, 'directRunExecutionEvidence.claimBoundary.doesNotProve');
  for (const requiredClaimBoundary of [
    'real Desktop CodingProvider worker execution',
    'real provider/model quality',
    'real streaming reply UX',
    'complete Host + Station + applet E2E',
  ]) {
    if (!directRunExecutionEvidence.claimBoundary.doesNotProve.includes(requiredClaimBoundary)) {
      throw new Error(`directRunExecutionEvidence.claimBoundary.doesNotProve must include ${requiredClaimBoundary}`);
    }
  }
  validateDirectRunExecutionControlledEvidence(directRunExecutionEvidence, expectedDisplayFields, expectedForbiddenActions);
}

function validateDirectRunExecutionControlledEvidence(directRunExecutionEvidence, expectedDisplayFields, expectedForbiddenActions) {
  const controlledEvidence = directRunExecutionEvidence.controlledEvidence;
  if (!isRecord(controlledEvidence)) {
    throw new Error('directRunExecutionEvidence.controlledEvidence must describe controlled DirectRun execution evidence');
  }
  if (controlledEvidence.readiness !== 'controlled_local_upstream') {
    throw new Error('directRunExecutionEvidence.controlledEvidence.readiness must be controlled_local_upstream');
  }
  if (controlledEvidence.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error('directRunExecutionEvidence.controlledEvidence.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM');
  }
  if (controlledEvidence.gate !== 'atelier:direct-run-execution-evidence-controlled-gate') {
    throw new Error('directRunExecutionEvidence.controlledEvidence.gate must be atelier:direct-run-execution-evidence-controlled-gate');
  }
  const expectedEvidenceFiles = [
    'tooling/acceptance/evidence/applets/official-applet/atelier-direct-run-execution-evidence-controlled-gate.json',
  ];
  assertStringArray(controlledEvidence.evidenceFiles, 'directRunExecutionEvidence.controlledEvidence.evidenceFiles');
  if (JSON.stringify(controlledEvidence.evidenceFiles) !== JSON.stringify(expectedEvidenceFiles)) {
    throw new Error('directRunExecutionEvidence.controlledEvidence.evidenceFiles must match the controlled DirectRun execution evidence file');
  }
  if (controlledEvidence.source !== 'direct_run_execution_evidence_controlled_harness') {
    throw new Error('directRunExecutionEvidence.controlledEvidence.source must be direct_run_execution_evidence_controlled_harness');
  }
  assertStringArray(controlledEvidence.displayFields, 'directRunExecutionEvidence.controlledEvidence.displayFields');
  if (JSON.stringify(controlledEvidence.displayFields) !== JSON.stringify(expectedDisplayFields)) {
    throw new Error('directRunExecutionEvidence.controlledEvidence.displayFields must match directRunExecutionEvidence.displayFields');
  }
  assertStringArray(controlledEvidence.forbiddenActions, 'directRunExecutionEvidence.controlledEvidence.forbiddenActions');
  if (JSON.stringify(controlledEvidence.forbiddenActions) !== JSON.stringify(expectedForbiddenActions)) {
    throw new Error('directRunExecutionEvidence.controlledEvidence.forbiddenActions must match directRunExecutionEvidence.forbiddenActions');
  }
  for (const [field, expected] of Object.entries({
    readOnlyProjection: true,
    stationServiceProjectionProven: true,
    stationOwnedRecordSourceProven: true,
    metadataOnlyProjectionProven: true,
    appletProviderInvokeExposed: false,
    appletModelRunExposed: false,
    appletCliExecuteExposed: false,
    appletTraceWriteExposed: false,
    appletArtifactWriteExposed: false,
    appletGateRunExposed: false,
    appletBudgetWriteExposed: false,
    inputSnapshotReadWriteExposed: false,
    realDesktopCodingProviderWorkerProven: false,
    realProviderModelQualityProven: false,
    realStreamingReplyUXProven: false,
    realHostStationAppletE2EProven: false,
  })) {
    if (controlledEvidence[field] !== expected) {
      throw new Error(`directRunExecutionEvidence.controlledEvidence.${field} must be ${expected}`);
    }
  }
}

function validateCreateFromGoalPayload(payload, intent, transport) {
  if (!isRecord(payload)) {
    throw new Error('methodPayloads.atelier.project.createFromGoal must be an object');
  }
  assertStringArray(payload.requiredFields, 'methodPayloads.atelier.project.createFromGoal.requiredFields');
  assertStringArray(payload.optionalFields, 'methodPayloads.atelier.project.createFromGoal.optionalFields');
  assertStringArray(payload.allowedIntentPresets, 'methodPayloads.atelier.project.createFromGoal.allowedIntentPresets');
  if (!isRecord(payload.intentPresetMapping)) {
    throw new Error('methodPayloads.atelier.project.createFromGoal.intentPresetMapping must be an object');
  }
  for (const preset of payload.allowedIntentPresets) {
    const mapping = payload.intentPresetMapping[preset];
    if (!isRecord(mapping)) {
      throw new Error(`methodPayloads.atelier.project.createFromGoal.intentPresetMapping.${preset} must be an object`);
    }
    assertString(mapping.providerStrategyPreset, `methodPayloads.atelier.project.createFromGoal.intentPresetMapping.${preset}.providerStrategyPreset`);
    assertString(mapping.gatePlanPreset, `methodPayloads.atelier.project.createFromGoal.intentPresetMapping.${preset}.gatePlanPreset`);
  }
  assertStringArray(payload.allowedRunKinds, 'methodPayloads.atelier.project.createFromGoal.allowedRunKinds');
    assertString(payload.defaultRunKind, 'methodPayloads.atelier.project.createFromGoal.defaultRunKind');
    if (!payload.allowedRunKinds.includes(payload.defaultRunKind)) {
      throw new Error('methodPayloads.atelier.project.createFromGoal.defaultRunKind must be one of allowedRunKinds');
    }
  assertStringArray(payload.allowedDirectRunModels, 'methodPayloads.atelier.project.createFromGoal.allowedDirectRunModels');
    assertString(payload.defaultDirectRunModel, 'methodPayloads.atelier.project.createFromGoal.defaultDirectRunModel');
    if (!payload.allowedDirectRunModels.includes(payload.defaultDirectRunModel)) {
      throw new Error('methodPayloads.atelier.project.createFromGoal.defaultDirectRunModel must be one of allowedDirectRunModels');
    }
  assertStringArray(payload.allowedAgentFlowIds, 'methodPayloads.atelier.project.createFromGoal.allowedAgentFlowIds');
  assertString(payload.defaultAgentFlowId, 'methodPayloads.atelier.project.createFromGoal.defaultAgentFlowId');
  if (!payload.allowedAgentFlowIds.includes(payload.defaultAgentFlowId)) {
    throw new Error('methodPayloads.atelier.project.createFromGoal.defaultAgentFlowId must be one of allowedAgentFlowIds');
  }
  validateAgentFlowDescriptors(payload);
  validateCreateFromGoalControlledEvidence(payload, intent, transport);
}

function validateCreateFromGoalControlledEvidence(payload, intent, transport) {
  const controlledEvidence = payload.controlledEvidence;
  if (!isRecord(controlledEvidence)) {
    throw new Error('methodPayloads.atelier.project.createFromGoal.controlledEvidence must describe controlled create-from-goal evidence');
  }
  if (!isRecord(intent)) {
    throw new Error('methodIntents.atelier.project.createFromGoal must be an object');
  }
  if (!isRecord(transport)) {
    throw new Error('methodTransports.atelier.project.createFromGoal must be an object');
  }
  if (controlledEvidence.readiness !== 'controlled_local_upstream') {
    throw new Error('methodPayloads.atelier.project.createFromGoal.controlledEvidence.readiness must be controlled_local_upstream');
  }
  if (controlledEvidence.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error('methodPayloads.atelier.project.createFromGoal.controlledEvidence.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM');
  }
  const expectedGates = [
    'atelier:projection-contract-gate',
    'atelier:official-frontend-gate',
    'atelier:bridge-runtime-gate',
  ];
  assertStringArray(controlledEvidence.gates, 'methodPayloads.atelier.project.createFromGoal.controlledEvidence.gates');
  if (JSON.stringify(controlledEvidence.gates) !== JSON.stringify(expectedGates)) {
    throw new Error('methodPayloads.atelier.project.createFromGoal.controlledEvidence.gates must match create-from-goal evidence gates');
  }
  const expectedEvidenceFiles = [
    'tooling/acceptance/evidence/applets/official-applet/atelier-official-frontend-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-bridge-runtime-gate.json',
  ];
  assertStringArray(controlledEvidence.evidenceFiles, 'methodPayloads.atelier.project.createFromGoal.controlledEvidence.evidenceFiles');
  if (JSON.stringify(controlledEvidence.evidenceFiles) !== JSON.stringify(expectedEvidenceFiles)) {
    throw new Error('methodPayloads.atelier.project.createFromGoal.controlledEvidence.evidenceFiles must match create-from-goal evidence files');
  }
  if (controlledEvidence.method !== 'atelier.project.createFromGoal') {
    throw new Error('methodPayloads.atelier.project.createFromGoal.controlledEvidence.method must be atelier.project.createFromGoal');
  }
  for (const field of ['intentOwner', 'intentKind', 'sideEffectClass', 'executionForbidden']) {
    if (controlledEvidence[field] !== intent[field]) {
      throw new Error(`methodPayloads.atelier.project.createFromGoal.controlledEvidence.${field} must match methodIntents.atelier.project.createFromGoal.${field}`);
    }
  }
  for (const field of ['transportKind', 'frontendCall', 'service', 'httpMethod', 'publicPath', 'stationPath', 'stationHandler', 'desktopGateway']) {
    if (controlledEvidence[field] !== transport[field]) {
      throw new Error(`methodPayloads.atelier.project.createFromGoal.controlledEvidence.${field} must match methodTransports.atelier.project.createFromGoal.${field}`);
    }
  }
  for (const field of [
    'requiredFields',
    'optionalFields',
    'allowedIntentPresets',
    'allowedRunKinds',
    'defaultRunKind',
    'allowedDirectRunModels',
    'defaultDirectRunModel',
    'allowedAgentFlowIds',
    'defaultAgentFlowId',
  ]) {
    if (JSON.stringify(controlledEvidence[field]) !== JSON.stringify(payload[field])) {
      throw new Error(`methodPayloads.atelier.project.createFromGoal.controlledEvidence.${field} must match payload.${field}`);
    }
  }
  for (const [field, expected] of Object.entries({
    intentPresetMappingProven: true,
    agentFlowDescriptorGuardProven: true,
    directRunIntentGuardProven: true,
    stationRunTargetGuardProven: true,
    stationFlowIdMappingGuardProven: true,
    officialPayloadShapeGuardProven: true,
    prototypePayloadShapeGuardProven: true,
    appletProviderInvokeExposed: false,
    appletModelRunExposed: false,
    appletCliExecuteExposed: false,
    appletAgentOrchestrationExposed: false,
    realProviderRuntimeProven: false,
    realAgentRuntimeProven: false,
    realDirectRunE2EProven: false,
    realHostStationAppletE2EProven: false,
  })) {
    if (controlledEvidence[field] !== expected) {
      throw new Error(`methodPayloads.atelier.project.createFromGoal.controlledEvidence.${field} must be ${expected}`);
    }
  }
}

function validateAgentFlowDescriptors(payload) {
  if (!Array.isArray(payload.agentFlowDescriptors)) {
    throw new Error('methodPayloads.atelier.project.createFromGoal.agentFlowDescriptors must be an array');
  }
  const descriptorIds = [];
  for (const [index, descriptor] of payload.agentFlowDescriptors.entries()) {
    if (!isRecord(descriptor)) {
      throw new Error(`methodPayloads.atelier.project.createFromGoal.agentFlowDescriptors.${index} must be an object`);
    }
    assertString(descriptor.id, `methodPayloads.atelier.project.createFromGoal.agentFlowDescriptors.${index}.id`);
    assertString(descriptor.label, `methodPayloads.atelier.project.createFromGoal.agentFlowDescriptors.${index}.label`);
    assertString(descriptor.description, `methodPayloads.atelier.project.createFromGoal.agentFlowDescriptors.${index}.description`);
    if (!Number.isInteger(descriptor.batch) || ![1, 2].includes(descriptor.batch)) {
      throw new Error(`methodPayloads.atelier.project.createFromGoal.agentFlowDescriptors.${index}.batch must be 1 or 2`);
    }
    descriptorIds.push(descriptor.id);
  }
  if (JSON.stringify(descriptorIds) !== JSON.stringify(payload.allowedAgentFlowIds)) {
    throw new Error('methodPayloads.atelier.project.createFromGoal.agentFlowDescriptors ids must match allowedAgentFlowIds order');
  }
}

function validateArtifactPreviewOpenPayload(payload, intent, transport) {
  if (!isRecord(payload)) {
    throw new Error('methodPayloads.atelier.artifact.preview.open must be an object');
  }
  assertStringArray(payload.allowedModes, 'methodPayloads.atelier.artifact.preview.open.allowedModes');
  assertString(payload.defaultMode, 'methodPayloads.atelier.artifact.preview.open.defaultMode');
  if (!payload.allowedModes.includes(payload.defaultMode)) {
    throw new Error('methodPayloads.atelier.artifact.preview.open.defaultMode must be included in allowedModes');
  }
  assertStringArray(payload.allowedRendererOwner, 'methodPayloads.atelier.artifact.preview.open.allowedRendererOwner');
  assertStringArray(payload.allowedRendererMode, 'methodPayloads.atelier.artifact.preview.open.allowedRendererMode');
  assertStringArray(payload.allowedRendererStatus, 'methodPayloads.atelier.artifact.preview.open.allowedRendererStatus');
  assertStringArray(payload.requiredRendererCapabilities, 'methodPayloads.atelier.artifact.preview.open.requiredRendererCapabilities');
  if (!payload.requiredRendererCapabilities.includes('host_visual_renderer_surface')) {
    throw new Error('methodPayloads.atelier.artifact.preview.open.requiredRendererCapabilities must include host_visual_renderer_surface');
  }
  validateArtifactPreviewOpenPayloadControlledEvidence(payload, intent, transport);
}

function validateArtifactPreviewOpenPayloadControlledEvidence(payload, intent, transport) {
  if (!isRecord(intent)) {
    throw new Error('methodIntents.atelier.artifact.preview.open must be an object');
  }
  if (!isRecord(transport)) {
    throw new Error('methodTransports.atelier.artifact.preview.open must be an object');
  }
  const controlledEvidence = payload.controlledEvidence;
  if (!isRecord(controlledEvidence)) {
    throw new Error('methodPayloads.atelier.artifact.preview.open.controlledEvidence must describe controlled artifact preview open evidence');
  }
  if (controlledEvidence.readiness !== 'controlled_local_upstream') {
    throw new Error('methodPayloads.atelier.artifact.preview.open.controlledEvidence.readiness must be controlled_local_upstream');
  }
  if (controlledEvidence.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error('methodPayloads.atelier.artifact.preview.open.controlledEvidence.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM');
  }
  const expectedGates = [
    'atelier:projection-contract-gate',
    'atelier:official-frontend-gate',
    'atelier:bridge-runtime-gate',
  ];
  assertStringArray(controlledEvidence.gates, 'methodPayloads.atelier.artifact.preview.open.controlledEvidence.gates');
  if (JSON.stringify(controlledEvidence.gates) !== JSON.stringify(expectedGates)) {
    throw new Error('methodPayloads.atelier.artifact.preview.open.controlledEvidence.gates must match artifact preview open evidence gates');
  }
  const expectedEvidenceFiles = [
    'tooling/acceptance/evidence/applets/official-applet/atelier-official-frontend-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-bridge-runtime-gate.json',
  ];
  assertStringArray(controlledEvidence.evidenceFiles, 'methodPayloads.atelier.artifact.preview.open.controlledEvidence.evidenceFiles');
  if (JSON.stringify(controlledEvidence.evidenceFiles) !== JSON.stringify(expectedEvidenceFiles)) {
    throw new Error('methodPayloads.atelier.artifact.preview.open.controlledEvidence.evidenceFiles must match artifact preview open evidence files');
  }
  if (controlledEvidence.method !== 'atelier.artifact.preview.open') {
    throw new Error('methodPayloads.atelier.artifact.preview.open.controlledEvidence.method must be atelier.artifact.preview.open');
  }
  for (const field of ['intentOwner', 'intentKind', 'sideEffectClass', 'executionForbidden']) {
    if (controlledEvidence[field] !== intent[field]) {
      throw new Error(`methodPayloads.atelier.artifact.preview.open.controlledEvidence.${field} must match methodIntents.atelier.artifact.preview.open.${field}`);
    }
  }
  for (const field of ['transportKind', 'frontendCall', 'desktopGatewayAction', 'desktopHostHandler', 'hostSideEffect']) {
    if (controlledEvidence[field] !== transport[field]) {
      throw new Error(`methodPayloads.atelier.artifact.preview.open.controlledEvidence.${field} must match methodTransports.atelier.artifact.preview.open.${field}`);
    }
  }
  for (const field of [
    'requiredFields',
    'optionalFields',
    'responseFields',
    'allowedModes',
    'defaultMode',
    'allowedSandboxRefSchemes',
    'allowedRendererOwner',
    'allowedRendererMode',
    'allowedRendererStatus',
    'requiredRendererCapabilities',
    'hostSideEffects',
    'forbiddenActions',
  ]) {
    if (JSON.stringify(controlledEvidence[field]) !== JSON.stringify(payload[field])) {
      throw new Error(`methodPayloads.atelier.artifact.preview.open.controlledEvidence.${field} must match payload.${field}`);
    }
  }
  for (const [field, expected] of Object.entries({
    metadataOnlyProjectionProven: true,
    canonicalRefShapeGuardProven: true,
    hostPreviewIntentOnly: true,
    officialResponseGuardProven: true,
    prototypeBridgeResponseGuardProven: true,
    desktopGatewayHostIntentGuardProven: true,
    stalePreviewOpenGuardProven: true,
    rawBodyProjectionForbidden: true,
    appletRendererExposed: false,
    appletRawBodyReadExposed: false,
    appletFilePathUrlOpenExposed: false,
    realHostVisualRendererProven: false,
    realArtifactBodyFetchE2EProven: false,
    realDesktopProductWindowUIProven: false,
    realHostStationAppletE2EProven: false,
  })) {
    if (controlledEvidence[field] !== expected) {
      throw new Error(`methodPayloads.atelier.artifact.preview.open.controlledEvidence.${field} must be ${expected}`);
    }
  }
}

function validateMessageSendPayload(payload, intent, transport) {
  if (!isRecord(payload)) {
    throw new Error('methodPayloads.atelier.message.send must be an object');
  }
  const expectedRequiredFields = ['taskId', 'text'];
  assertStringArray(payload.requiredFields, 'methodPayloads.atelier.message.send.requiredFields');
  if (JSON.stringify(payload.requiredFields) !== JSON.stringify(expectedRequiredFields)) {
    throw new Error('methodPayloads.atelier.message.send.requiredFields must be taskId, text');
  }
  const expectedForbiddenAppletFields = ['run', 'attachments', 'inputSnapshot', 'input_snapshot'];
  assertStringArray(payload.forbiddenAppletFields, 'methodPayloads.atelier.message.send.forbiddenAppletFields');
  if (JSON.stringify(payload.forbiddenAppletFields) !== JSON.stringify(expectedForbiddenAppletFields)) {
    throw new Error('methodPayloads.atelier.message.send.forbiddenAppletFields must match applet text-only forbidden fields');
  }
  const expectedForbiddenActions = [
    'provider.invoke',
    'runtime.execute',
    'model.run',
    'run',
    'input_snapshot.write',
    'inputSnapshot.write',
    'attachment.upload',
    'HostStorage.write',
  ];
  assertStringArray(payload.forbiddenActions, 'methodPayloads.atelier.message.send.forbiddenActions');
  if (JSON.stringify(payload.forbiddenActions) !== JSON.stringify(expectedForbiddenActions)) {
    throw new Error('methodPayloads.atelier.message.send.forbiddenActions must match applet text-only forbidden actions');
  }
  validateMessageSendControlledEvidence(payload, intent, transport);
}

function validateMessageSendControlledEvidence(payload, intent, transport) {
  const controlledEvidence = payload.controlledEvidence;
  if (!isRecord(controlledEvidence)) {
    throw new Error('methodPayloads.atelier.message.send.controlledEvidence must describe controlled message send evidence');
  }
  if (!isRecord(intent)) {
    throw new Error('methodIntents.atelier.message.send must be an object');
  }
  if (!isRecord(transport)) {
    throw new Error('methodTransports.atelier.message.send must be an object');
  }
  if (controlledEvidence.readiness !== 'controlled_local_upstream') {
    throw new Error('methodPayloads.atelier.message.send.controlledEvidence.readiness must be controlled_local_upstream');
  }
  if (controlledEvidence.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error('methodPayloads.atelier.message.send.controlledEvidence.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM');
  }
  const expectedGates = [
    'atelier:projection-contract-gate',
    'atelier:official-frontend-gate',
    'atelier:bridge-runtime-gate',
    'atelier:message-send-ingress-controlled-gate',
  ];
  assertStringArray(controlledEvidence.gates, 'methodPayloads.atelier.message.send.controlledEvidence.gates');
  if (JSON.stringify(controlledEvidence.gates) !== JSON.stringify(expectedGates)) {
    throw new Error('methodPayloads.atelier.message.send.controlledEvidence.gates must match message send evidence gates');
  }
  const expectedEvidenceFiles = [
    'tooling/acceptance/evidence/applets/official-applet/atelier-official-frontend-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-bridge-runtime-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-message-send-ingress-controlled-gate.json',
  ];
  assertStringArray(controlledEvidence.evidenceFiles, 'methodPayloads.atelier.message.send.controlledEvidence.evidenceFiles');
  if (JSON.stringify(controlledEvidence.evidenceFiles) !== JSON.stringify(expectedEvidenceFiles)) {
    throw new Error('methodPayloads.atelier.message.send.controlledEvidence.evidenceFiles must match message send evidence files');
  }
  if (controlledEvidence.method !== 'atelier.message.send') {
    throw new Error('methodPayloads.atelier.message.send.controlledEvidence.method must be atelier.message.send');
  }
  for (const field of ['intentOwner', 'intentKind', 'sideEffectClass', 'executionForbidden']) {
    if (controlledEvidence[field] !== intent[field]) {
      throw new Error(`methodPayloads.atelier.message.send.controlledEvidence.${field} must match methodIntents.atelier.message.send.${field}`);
    }
  }
  for (const field of ['transportKind', 'frontendCall', 'service', 'httpMethod', 'publicPath', 'stationPath', 'stationHandler', 'desktopGateway']) {
    if (controlledEvidence[field] !== transport[field]) {
      throw new Error(`methodPayloads.atelier.message.send.controlledEvidence.${field} must match methodTransports.atelier.message.send.${field}`);
    }
  }
  for (const field of ['requiredFields', 'forbiddenAppletFields', 'forbiddenActions']) {
    if (JSON.stringify(controlledEvidence[field]) !== JSON.stringify(payload[field])) {
      throw new Error(`methodPayloads.atelier.message.send.controlledEvidence.${field} must match payload.${field}`);
    }
  }
  for (const [field, expected] of Object.entries({
    officialTextOnlyPayloadGuardProven: true,
    prototypeTextOnlyPayloadGuardProven: true,
    serviceBindingGuardProven: true,
    snapshotRefreshGuardProven: true,
    staleArtifactPreviewCleanupProven: true,
    stationIngressForbiddenFieldGuardProven: true,
    stationTextOnlyEventPayloadProven: true,
    appletRunIntentExposed: false,
    appletProviderInvokeExposed: false,
    appletRuntimeExecuteExposed: false,
    appletInputSnapshotWriteExposed: false,
    appletAttachmentUploadExposed: false,
    realAgentReplyE2EProven: false,
    realProviderExecutionProven: false,
    realRunInputSnapshotWriteProven: false,
    realHostStationAppletE2EProven: false,
  })) {
    if (controlledEvidence[field] !== expected) {
      throw new Error(`methodPayloads.atelier.message.send.controlledEvidence.${field} must be ${expected}`);
    }
  }
}

function validateEscalationResolvePayload(payload, intent, transport) {
  if (!isRecord(payload)) {
    throw new Error('methodPayloads.atelier.escalation.resolve must be an object');
  }
  const expectedRequiredFields = ['taskId', 'blockId', 'choice'];
  assertStringArray(payload.requiredFields, 'methodPayloads.atelier.escalation.resolve.requiredFields');
  if (JSON.stringify(payload.requiredFields) !== JSON.stringify(expectedRequiredFields)) {
    throw new Error('methodPayloads.atelier.escalation.resolve.requiredFields must be taskId, blockId, choice');
  }
  const expectedForbiddenActions = [
    'resume',
    'rerun',
    'execute',
    'run',
    'provider.invoke',
    'runtime.execute',
    'gate.rerun',
    'taskGraph.diff.apply',
    'memory.write',
    'input_snapshot.write',
    'inputSnapshot.write',
  ];
  assertStringArray(payload.forbiddenActions, 'methodPayloads.atelier.escalation.resolve.forbiddenActions');
  if (JSON.stringify(payload.forbiddenActions) !== JSON.stringify(expectedForbiddenActions)) {
    throw new Error('methodPayloads.atelier.escalation.resolve.forbiddenActions must match human decision resolve forbidden actions');
  }
  validateEscalationResolveControlledEvidence(payload, intent, transport);
}

function validateEscalationResolveControlledEvidence(payload, intent, transport) {
  const controlledEvidence = payload.controlledEvidence;
  if (!isRecord(controlledEvidence)) {
    throw new Error('methodPayloads.atelier.escalation.resolve.controlledEvidence must describe controlled escalation resolve evidence');
  }
  if (!isRecord(intent)) {
    throw new Error('methodIntents.atelier.escalation.resolve must be an object');
  }
  if (!isRecord(transport)) {
    throw new Error('methodTransports.atelier.escalation.resolve must be an object');
  }
  if (controlledEvidence.readiness !== 'controlled_local_upstream') {
    throw new Error('methodPayloads.atelier.escalation.resolve.controlledEvidence.readiness must be controlled_local_upstream');
  }
  if (controlledEvidence.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error('methodPayloads.atelier.escalation.resolve.controlledEvidence.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM');
  }
  const expectedGates = [
    'atelier:projection-contract-gate',
    'atelier:official-frontend-gate',
    'atelier:bridge-runtime-gate',
    'applet:atelier-decision-product-window-gate',
    'applet:atelier-live-resume-product-window-gate',
  ];
  assertStringArray(controlledEvidence.gates, 'methodPayloads.atelier.escalation.resolve.controlledEvidence.gates');
  if (JSON.stringify(controlledEvidence.gates) !== JSON.stringify(expectedGates)) {
    throw new Error('methodPayloads.atelier.escalation.resolve.controlledEvidence.gates must match escalation resolve evidence gates');
  }
  const expectedEvidenceFiles = [
    'tooling/acceptance/evidence/applets/official-applet/atelier-official-frontend-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-bridge-runtime-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-decision-product-window-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-live-resume-product-window-gate.json',
  ];
  assertStringArray(controlledEvidence.evidenceFiles, 'methodPayloads.atelier.escalation.resolve.controlledEvidence.evidenceFiles');
  if (JSON.stringify(controlledEvidence.evidenceFiles) !== JSON.stringify(expectedEvidenceFiles)) {
    throw new Error('methodPayloads.atelier.escalation.resolve.controlledEvidence.evidenceFiles must match escalation resolve evidence files');
  }
  if (controlledEvidence.method !== 'atelier.escalation.resolve') {
    throw new Error('methodPayloads.atelier.escalation.resolve.controlledEvidence.method must be atelier.escalation.resolve');
  }
  for (const field of ['intentOwner', 'intentKind', 'sideEffectClass', 'executionForbidden']) {
    if (controlledEvidence[field] !== intent[field]) {
      throw new Error(`methodPayloads.atelier.escalation.resolve.controlledEvidence.${field} must match methodIntents.atelier.escalation.resolve.${field}`);
    }
  }
  for (const field of ['transportKind', 'frontendCall', 'service', 'httpMethod', 'publicPath', 'stationPath', 'stationHandler', 'desktopGateway']) {
    if (controlledEvidence[field] !== transport[field]) {
      throw new Error(`methodPayloads.atelier.escalation.resolve.controlledEvidence.${field} must match methodTransports.atelier.escalation.resolve.${field}`);
    }
  }
  for (const field of ['requiredFields', 'forbiddenActions']) {
    if (JSON.stringify(controlledEvidence[field]) !== JSON.stringify(payload[field])) {
      throw new Error(`methodPayloads.atelier.escalation.resolve.controlledEvidence.${field} must match payload.${field}`);
    }
  }
  for (const [field, expected] of Object.entries({
    officialHumanChoiceResolveGuardProven: true,
    prototypeHumanChoiceResolveGuardProven: true,
    serviceBindingGuardProven: true,
    stationInterruptResolveRouteProven: true,
    focusedProductWindowDecisionResolveProven: true,
    focusedLiveResumeWaiterWakeProven: true,
    focusedLiveResumeProviderLoopProven: true,
    appletResumeExecutionExposed: false,
    appletRerunExecutionExposed: false,
    appletProviderInvokeExposed: false,
    appletRuntimeExecuteExposed: false,
    appletTaskGraphMutationExposed: false,
    appletMemoryWriteExposed: false,
    appletInputSnapshotWriteExposed: false,
    completeExecutorProviderRecoveryE2EProven: false,
    realHostStationAppletE2EProven: false,
  })) {
    if (controlledEvidence[field] !== expected) {
      throw new Error(`methodPayloads.atelier.escalation.resolve.controlledEvidence.${field} must be ${expected}`);
    }
  }
}

function validateFeedbackSubmitPayload(payload, intent, transport) {
  if (!isRecord(payload)) {
    throw new Error('methodPayloads.atelier.feedback.submit must be an object');
  }
  assertStringArray(payload.requiredFields, 'methodPayloads.atelier.feedback.submit.requiredFields');
  assertStringArray(payload.optionalFields, 'methodPayloads.atelier.feedback.submit.optionalFields');
  assertStringArray(payload.responseFields, 'methodPayloads.atelier.feedback.submit.responseFields');
  assertStringArray(payload.allowedSignals, 'methodPayloads.atelier.feedback.submit.allowedSignals');
  assertStringArray(payload.forbiddenActions, 'methodPayloads.atelier.feedback.submit.forbiddenActions');
  validateFeedbackSubmitControlledEvidence(payload, intent, transport);
}

function validateFeedbackSubmitControlledEvidence(payload, intent, transport) {
  const controlledEvidence = payload.controlledEvidence;
  if (!isRecord(controlledEvidence)) {
    throw new Error('methodPayloads.atelier.feedback.submit.controlledEvidence must describe controlled feedback submit evidence');
  }
  if (!isRecord(intent)) {
    throw new Error('methodIntents.atelier.feedback.submit must be an object');
  }
  if (!isRecord(transport)) {
    throw new Error('methodTransports.atelier.feedback.submit must be an object');
  }
  if (controlledEvidence.readiness !== 'controlled_local_upstream') {
    throw new Error('methodPayloads.atelier.feedback.submit.controlledEvidence.readiness must be controlled_local_upstream');
  }
  if (controlledEvidence.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error('methodPayloads.atelier.feedback.submit.controlledEvidence.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM');
  }
  const expectedGates = [
    'atelier:projection-contract-gate',
    'atelier:official-frontend-gate',
    'atelier:bridge-runtime-gate',
    'atelier:feedback-submit-ingress-controlled-gate',
    'atelier:feedback-memory-consumption-controlled-gate',
  ];
  assertStringArray(controlledEvidence.gates, 'methodPayloads.atelier.feedback.submit.controlledEvidence.gates');
  if (JSON.stringify(controlledEvidence.gates) !== JSON.stringify(expectedGates)) {
    throw new Error('methodPayloads.atelier.feedback.submit.controlledEvidence.gates must match feedback submit evidence gates');
  }
  const expectedEvidenceFiles = [
    'tooling/acceptance/evidence/applets/official-applet/atelier-official-frontend-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-bridge-runtime-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-feedback-submit-ingress-controlled-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-feedback-memory-consumption-controlled-gate.json',
  ];
  assertStringArray(controlledEvidence.evidenceFiles, 'methodPayloads.atelier.feedback.submit.controlledEvidence.evidenceFiles');
  if (JSON.stringify(controlledEvidence.evidenceFiles) !== JSON.stringify(expectedEvidenceFiles)) {
    throw new Error('methodPayloads.atelier.feedback.submit.controlledEvidence.evidenceFiles must match feedback submit evidence files');
  }
  if (controlledEvidence.method !== 'atelier.feedback.submit') {
    throw new Error('methodPayloads.atelier.feedback.submit.controlledEvidence.method must be atelier.feedback.submit');
  }
  for (const field of ['intentOwner', 'intentKind', 'sideEffectClass', 'executionForbidden']) {
    if (controlledEvidence[field] !== intent[field]) {
      throw new Error(`methodPayloads.atelier.feedback.submit.controlledEvidence.${field} must match methodIntents.atelier.feedback.submit.${field}`);
    }
  }
  for (const field of ['transportKind', 'frontendCall', 'service', 'httpMethod', 'publicPath', 'stationPath', 'stationHandler', 'desktopGateway']) {
    if (controlledEvidence[field] !== transport[field]) {
      throw new Error(`methodPayloads.atelier.feedback.submit.controlledEvidence.${field} must match methodTransports.atelier.feedback.submit.${field}`);
    }
  }
  for (const field of ['requiredFields', 'optionalFields', 'responseFields', 'allowedSignals', 'forbiddenActions']) {
    if (JSON.stringify(controlledEvidence[field]) !== JSON.stringify(payload[field])) {
      throw new Error(`methodPayloads.atelier.feedback.submit.controlledEvidence.${field} must match payload.${field}`);
    }
  }
  for (const [field, expected] of Object.entries({
    officialResponseGuardProven: true,
    prototypeBridgeResponseGuardProven: true,
    generatedSignalTaxonomyProven: true,
    policyHintGuardProven: true,
    sourceBlockBindingProven: true,
    nonSnapshotResponseGuardProven: true,
    stationIngressForbiddenFieldGuardProven: true,
    stationPolicyEventPayloadProven: true,
    stationPlannerRiskVerifierFeedPolicyProven: true,
    appletMemoryWriteExposed: false,
    appletRerunExecutionExposed: false,
    appletProviderInvokeExposed: false,
    realMemoryWriteE2EProven: false,
    realRerunTaskCreationE2EProven: false,
    realPlannerRiskVerifierFeedbackConsumptionProven: false,
    realHostStationAppletE2EProven: false,
  })) {
    if (controlledEvidence[field] !== expected) {
      throw new Error(`methodPayloads.atelier.feedback.submit.controlledEvidence.${field} must be ${expected}`);
    }
  }
}

function validateConfirmationPayload(payload, intent, transport, expected) {
  if (!isRecord(payload)) {
    throw new Error(`methodPayloads.${expected.method} must be an object`);
  }
  assertStringArray(payload.requiredFields, `methodPayloads.${expected.method}.requiredFields`);
  assertStringArray(payload.responseFields, `methodPayloads.${expected.method}.responseFields`);
  assertString(payload.allowedConfirmationMode, `methodPayloads.${expected.method}.allowedConfirmationMode`);
  if (payload.allowedConfirmationMode !== expected.mode) {
    throw new Error(`methodPayloads.${expected.method}.allowedConfirmationMode must be ${expected.mode}`);
  }
  assertStringArray(payload.forbiddenActions, `methodPayloads.${expected.method}.forbiddenActions`);
  if (JSON.stringify(payload.forbiddenActions) !== JSON.stringify(expected.forbiddenActions)) {
    throw new Error(`methodPayloads.${expected.method}.forbiddenActions must match confirmation forbidden actions`);
  }
  validateConfirmationControlledEvidence(payload, intent, transport, expected);
}

function validateConfirmationControlledEvidence(payload, intent, transport, expected) {
  const controlledEvidence = payload.controlledEvidence;
  if (!isRecord(controlledEvidence)) {
    throw new Error(`methodPayloads.${expected.method}.controlledEvidence must describe controlled confirmation evidence`);
  }
  if (!isRecord(intent)) {
    throw new Error(`methodIntents.${expected.method} must be an object`);
  }
  if (!isRecord(transport)) {
    throw new Error(`methodTransports.${expected.method} must be an object`);
  }
  if (controlledEvidence.readiness !== 'controlled_local_upstream') {
    throw new Error(`methodPayloads.${expected.method}.controlledEvidence.readiness must be controlled_local_upstream`);
  }
  if (controlledEvidence.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error(`methodPayloads.${expected.method}.controlledEvidence.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM`);
  }
  const expectedGates = [
    'atelier:projection-contract-gate',
    'atelier:official-frontend-gate',
    'atelier:bridge-runtime-gate',
    'atelier:confirmation-ingress-controlled-gate',
    'atelier:confirmation-outcome-controlled-gate',
  ];
  if (expected.method === 'atelier.memory.confirmCandidate') {
    expectedGates.push('atelier:feedback-memory-consumption-controlled-gate');
  }
  assertStringArray(controlledEvidence.gates, `methodPayloads.${expected.method}.controlledEvidence.gates`);
  if (JSON.stringify(controlledEvidence.gates) !== JSON.stringify(expectedGates)) {
    throw new Error(`methodPayloads.${expected.method}.controlledEvidence.gates must match confirmation evidence gates`);
  }
  const expectedEvidenceFiles = [
    'tooling/acceptance/evidence/applets/official-applet/atelier-official-frontend-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-bridge-runtime-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-confirmation-ingress-controlled-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-confirmation-outcome-controlled-gate.json',
  ];
  if (expected.method === 'atelier.memory.confirmCandidate') {
    expectedEvidenceFiles.push('tooling/acceptance/evidence/applets/official-applet/atelier-feedback-memory-consumption-controlled-gate.json');
  }
  assertStringArray(controlledEvidence.evidenceFiles, `methodPayloads.${expected.method}.controlledEvidence.evidenceFiles`);
  if (JSON.stringify(controlledEvidence.evidenceFiles) !== JSON.stringify(expectedEvidenceFiles)) {
    throw new Error(`methodPayloads.${expected.method}.controlledEvidence.evidenceFiles must match confirmation evidence files`);
  }
  if (controlledEvidence.method !== expected.method) {
    throw new Error(`methodPayloads.${expected.method}.controlledEvidence.method must be ${expected.method}`);
  }
  for (const field of ['intentOwner', 'intentKind', 'sideEffectClass', 'executionForbidden']) {
    if (controlledEvidence[field] !== intent[field]) {
      throw new Error(`methodPayloads.${expected.method}.controlledEvidence.${field} must match methodIntents.${expected.method}.${field}`);
    }
  }
  for (const field of ['transportKind', 'frontendCall', 'service', 'httpMethod', 'publicPath', 'stationPath', 'stationHandler', 'desktopGateway']) {
    if (controlledEvidence[field] !== transport[field]) {
      throw new Error(`methodPayloads.${expected.method}.controlledEvidence.${field} must match methodTransports.${expected.method}.${field}`);
    }
  }
  for (const field of ['requiredFields', 'responseFields', 'allowedConfirmationMode', 'forbiddenActions']) {
    if (JSON.stringify(controlledEvidence[field]) !== JSON.stringify(payload[field])) {
      throw new Error(`methodPayloads.${expected.method}.controlledEvidence.${field} must match payload.${field}`);
    }
  }
  for (const [field, value] of Object.entries(expected.booleans)) {
    if (controlledEvidence[field] !== value) {
      throw new Error(`methodPayloads.${expected.method}.controlledEvidence.${field} must be ${value}`);
    }
  }
}

function validateWorkspaceOpenPayload(payload, intent, transport) {
  if (!isRecord(payload)) {
    throw new Error('methodPayloads.atelier.workspace.open must be an object');
  }
  assertStringArray(payload.requiredFields, 'methodPayloads.atelier.workspace.open.requiredFields');
  assertStringArray(payload.optionalFields, 'methodPayloads.atelier.workspace.open.optionalFields');
  assertStringArray(payload.responseFields, 'methodPayloads.atelier.workspace.open.responseFields');
  assertStringArray(payload.allowedUriSchemes, 'methodPayloads.atelier.workspace.open.allowedUriSchemes');
  if (!isRecord(payload.uriShape)) {
    throw new Error('methodPayloads.atelier.workspace.open.uriShape must be an object');
  }
  assertString(payload.uriShape.scheme, 'methodPayloads.atelier.workspace.open.uriShape.scheme');
  assertString(payload.uriShape.host, 'methodPayloads.atelier.workspace.open.uriShape.host');
  assertString(payload.uriShape.workspaceQueryKey, 'methodPayloads.atelier.workspace.open.uriShape.workspaceQueryKey');
  if (!Number.isInteger(payload.uriShape.taskPathSegments) || payload.uriShape.taskPathSegments < 1) {
    throw new Error('methodPayloads.atelier.workspace.open.uriShape.taskPathSegments must be a positive integer');
  }
  if (!payload.allowedUriSchemes.includes(payload.uriShape.scheme)) {
    throw new Error('methodPayloads.atelier.workspace.open.uriShape.scheme must be included in allowedUriSchemes');
  }
  assertStringArray(payload.forbiddenActions, 'methodPayloads.atelier.workspace.open.forbiddenActions');
  validateWorkspaceOpenControlledEvidence(payload, intent, transport);
}

function validateWorkspaceOpenControlledEvidence(payload, intent, transport) {
  const controlledEvidence = payload.controlledEvidence;
  if (!isRecord(controlledEvidence)) {
    throw new Error('methodPayloads.atelier.workspace.open.controlledEvidence must describe controlled workspace open evidence');
  }
  if (!isRecord(intent)) {
    throw new Error('methodIntents.atelier.workspace.open must be an object');
  }
  if (!isRecord(transport)) {
    throw new Error('methodTransports.atelier.workspace.open must be an object');
  }
  if (controlledEvidence.readiness !== 'controlled_local_upstream') {
    throw new Error('methodPayloads.atelier.workspace.open.controlledEvidence.readiness must be controlled_local_upstream');
  }
  if (controlledEvidence.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error('methodPayloads.atelier.workspace.open.controlledEvidence.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM');
  }
  const expectedGates = [
    'atelier:projection-contract-gate',
    'atelier:official-frontend-gate',
    'atelier:bridge-runtime-gate',
    'atelier:workspace-open-controlled-gate',
  ];
  assertStringArray(controlledEvidence.gates, 'methodPayloads.atelier.workspace.open.controlledEvidence.gates');
  if (JSON.stringify(controlledEvidence.gates) !== JSON.stringify(expectedGates)) {
    throw new Error('methodPayloads.atelier.workspace.open.controlledEvidence.gates must match workspace open evidence gates');
  }
  const expectedEvidenceFiles = [
    'tooling/acceptance/evidence/applets/official-applet/atelier-official-frontend-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-bridge-runtime-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-workspace-open-controlled-gate.json',
  ];
  assertStringArray(controlledEvidence.evidenceFiles, 'methodPayloads.atelier.workspace.open.controlledEvidence.evidenceFiles');
  if (JSON.stringify(controlledEvidence.evidenceFiles) !== JSON.stringify(expectedEvidenceFiles)) {
    throw new Error('methodPayloads.atelier.workspace.open.controlledEvidence.evidenceFiles must match workspace open evidence files');
  }
  if (controlledEvidence.method !== 'atelier.workspace.open') {
    throw new Error('methodPayloads.atelier.workspace.open.controlledEvidence.method must be atelier.workspace.open');
  }
  for (const field of ['intentOwner', 'intentKind', 'sideEffectClass', 'executionForbidden']) {
    if (controlledEvidence[field] !== intent[field]) {
      throw new Error(`methodPayloads.atelier.workspace.open.controlledEvidence.${field} must match methodIntents.atelier.workspace.open.${field}`);
    }
  }
  for (const field of ['transportKind', 'frontendCall', 'desktopGatewayAction', 'desktopHostHandler', 'hostSideEffect']) {
    if (controlledEvidence[field] !== transport[field]) {
      throw new Error(`methodPayloads.atelier.workspace.open.controlledEvidence.${field} must match methodTransports.atelier.workspace.open.${field}`);
    }
  }
  for (const field of ['requiredFields', 'optionalFields', 'responseFields', 'allowedUriSchemes', 'uriShape', 'forbiddenActions']) {
    if (JSON.stringify(controlledEvidence[field]) !== JSON.stringify(payload[field])) {
      throw new Error(`methodPayloads.atelier.workspace.open.controlledEvidence.${field} must match payload.${field}`);
    }
  }
  for (const [field, expected] of Object.entries({
    hostIntentOnlyProven: true,
    officialResponseGuardProven: true,
    prototypeBridgeResponseGuardProven: true,
    requestCorrelationProven: true,
    generatedUriShapeGuardProven: true,
    desktopGatewayUriShapeProven: true,
    desktopGatewayRejectsNonContractUriProven: true,
    desktopGatewayNoNativeLaunchProven: true,
    appletFileShellExecuteExposed: false,
    appletOpenExternalUrlExposed: false,
    realIdeLaunchProven: false,
    realWorkspaceResolverProven: false,
    realSandboxRuntimeProven: false,
    realHostStationAppletE2EProven: false,
  })) {
    if (controlledEvidence[field] !== expected) {
      throw new Error(`methodPayloads.atelier.workspace.open.controlledEvidence.${field} must be ${expected}`);
    }
  }
}

function validateProviderCapabilitiesPayload(payload) {
  if (!isRecord(payload)) {
    throw new Error('methodPayloads.atelier.provider.capabilities must be an object');
  }
  assertStringArray(payload.allowedCapabilityScopes, 'methodPayloads.atelier.provider.capabilities.allowedCapabilityScopes');
  assertString(payload.capabilityScope, 'methodPayloads.atelier.provider.capabilities.capabilityScope');
  if (!payload.allowedCapabilityScopes.includes(payload.capabilityScope)) {
    throw new Error('methodPayloads.atelier.provider.capabilities.capabilityScope must be included in allowedCapabilityScopes');
  }
  if (payload.capabilityReadOnly !== true) {
    throw new Error('methodPayloads.atelier.provider.capabilities.capabilityReadOnly must be true');
  }
  assertStringArray(payload.forbiddenActions, 'methodPayloads.atelier.provider.capabilities.forbiddenActions');
  const expectedForbiddenActions = ['invoke', 'execute', 'run', 'action.execute', 'action.run', 'policy.override', 'rollback.execute'];
  if (JSON.stringify(payload.forbiddenActions) !== JSON.stringify(expectedForbiddenActions)) {
    throw new Error('methodPayloads.atelier.provider.capabilities.forbiddenActions must match provider capability discovery forbidden actions');
  }
  validateProviderCapabilitiesControlledEvidence(payload);
}

function validateProviderCapabilitiesControlledEvidence(payload) {
  const controlledEvidence = payload.controlledEvidence;
  if (!isRecord(controlledEvidence)) {
    throw new Error('methodPayloads.atelier.provider.capabilities.controlledEvidence must describe controlled provider capability discovery evidence');
  }
  if (controlledEvidence.readiness !== 'controlled_local_upstream') {
    throw new Error('methodPayloads.atelier.provider.capabilities.controlledEvidence.readiness must be controlled_local_upstream');
  }
  if (controlledEvidence.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error('methodPayloads.atelier.provider.capabilities.controlledEvidence.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM');
  }
  const expectedGates = ['atelier:projection-contract-gate', 'atelier:official-frontend-gate', 'atelier:bridge-runtime-gate'];
  assertStringArray(controlledEvidence.gates, 'methodPayloads.atelier.provider.capabilities.controlledEvidence.gates');
  if (JSON.stringify(controlledEvidence.gates) !== JSON.stringify(expectedGates)) {
    throw new Error('methodPayloads.atelier.provider.capabilities.controlledEvidence.gates must match provider capability discovery evidence gates');
  }
  const expectedEvidenceFiles = [
    'tooling/acceptance/evidence/applets/official-applet/atelier-official-frontend-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-bridge-runtime-gate.json',
  ];
  assertStringArray(controlledEvidence.evidenceFiles, 'methodPayloads.atelier.provider.capabilities.controlledEvidence.evidenceFiles');
  if (JSON.stringify(controlledEvidence.evidenceFiles) !== JSON.stringify(expectedEvidenceFiles)) {
    throw new Error('methodPayloads.atelier.provider.capabilities.controlledEvidence.evidenceFiles must match provider capability discovery evidence files');
  }
  if (controlledEvidence.method !== 'atelier.provider.capabilities') {
    throw new Error('methodPayloads.atelier.provider.capabilities.controlledEvidence.method must be atelier.provider.capabilities');
  }
  for (const field of ['optionalFields', 'responseFields', 'allowedCapabilityScopes', 'capabilityScope', 'capabilityReadOnly', 'forbiddenActions']) {
    if (JSON.stringify(controlledEvidence[field]) !== JSON.stringify(payload[field])) {
      throw new Error(`methodPayloads.atelier.provider.capabilities.controlledEvidence.${field} must match payload.${field}`);
    }
  }
  for (const [field, expected] of Object.entries({
    officialResponseGuardProven: true,
    prototypeBridgeResponseGuardProven: true,
    slashCommandInsertOnlyProven: true,
    appletProviderInvokeExposed: false,
    appletActionExecutionExposed: false,
    appletPolicyOverrideExposed: false,
    appletRollbackExecutionExposed: false,
    realProviderRuntimeProven: false,
    realActionProviderRuntimeProven: false,
    realHostStationAppletE2EProven: false,
  })) {
    if (controlledEvidence[field] !== expected) {
      throw new Error(`methodPayloads.atelier.provider.capabilities.controlledEvidence.${field} must be ${expected}`);
    }
  }
}

function buildSchema(source) {
  const artifactForbidden = Object.fromEntries(source.artifactPreview.forbiddenBodyFields.map((field) => [field, false]));
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'peers.atelier.projection.schema.generated.json',
    title: 'Atelier Projection Contract',
    description: 'Generated from atelier-projection.contract.json. Do not edit by hand.',
    type: 'object',
    required: source.eventRequiredFields,
    additionalProperties: false,
    properties: {
      id: { type: 'string', minLength: 1 },
      seq: { type: 'number', minimum: 0 },
      taskId: { type: 'string' },
      receivedAt: { type: 'string', minLength: 1 },
      patch: { $ref: '#/$defs/patch' },
    },
    $defs: {
      patch: {
        oneOf: source.patchKinds.map((kind) => ({ $ref: `#/$defs/${patchDefName(kind)}` })),
      },
      snapshotPatch: {
        type: 'object',
        required: ['kind', 'snapshot'],
        additionalProperties: false,
        properties: {
          kind: { const: 'snapshot' },
          snapshot: { $ref: '#/$defs/snapshot' },
        },
      },
      taskUpsertPatch: patchSchema('task.upsert', { task: { type: 'object' }, select: { type: 'boolean' } }, ['kind', 'task']),
      taskStatusPatch: patchSchema('task.status', { taskId: { type: 'string' }, status: { enum: source.taskLifecycle.states } }, ['kind', 'taskId', 'status']),
      streamAppendPatch: patchSchema('stream.append', { taskId: { type: 'string' }, blocks: { type: 'array', items: { type: 'object' } } }, ['kind', 'taskId', 'blocks']),
      decisionResolvedPatch: patchSchema('decision.resolved', { taskId: { type: 'string' }, blockId: { type: 'string' }, choice: { type: 'string' } }, ['kind', 'taskId', 'blockId', 'choice']),
      artifactUpsertPatch: patchSchema('artifact.upsert', { taskId: { type: 'string' }, artifact: { $ref: '#/$defs/artifact' } }, ['kind', 'taskId', 'artifact']),
      gateUpsertPatch: patchSchema('gate.upsert', { taskId: { type: 'string' }, gate: { type: 'object' } }, ['kind', 'taskId', 'gate']),
      contextReplacePatch: patchSchema('context.replace', { taskId: { type: 'string' }, context: { type: 'object' } }, ['kind', 'taskId', 'context']),
      todoReplacePatch: patchSchema('todo.replace', { taskId: { type: 'string' }, todos: { type: 'array', items: { type: 'object' } } }, ['kind', 'taskId', 'todos']),
      snapshot: {
        type: 'object',
        required: ['version', 'selectedTaskId', 'workspace'],
        additionalProperties: false,
        properties: {
          version: { const: source.version },
          selectedTaskId: { type: 'string' },
          workspace: { type: 'object' },
        },
      },
      artifact: {
        type: 'object',
        required: ['id'],
        additionalProperties: true,
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          kind: { type: 'string' },
          meta: { type: 'string' },
          previewHint: { enum: source.artifactPreview.allowedPreviewHints },
          bodyRef: { type: 'string' },
          bodyHash: { type: 'string' },
          bodySize: { type: 'string' },
          bodyKind: { type: 'string' },
          paths: { type: 'array', items: { type: 'string' } },
          size: { type: 'string' },
          previewTarget: { $ref: '#/$defs/artifactPreviewTarget' },
          ...artifactForbidden,
        },
      },
      artifactPreviewTarget: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { enum: source.artifactPreview.allowedPreviewTargetKinds },
          mode: { type: 'string' },
          label: { type: 'string' },
          sandboxRef: { type: 'string' },
          bodyRef: { type: 'string' },
        },
      },
    },
  };
}

function patchSchema(kind, properties, required) {
  return {
    type: 'object',
    required,
    additionalProperties: false,
    properties: {
      kind: { const: kind },
      ...properties,
    },
  };
}

function validateEventSubscription(eventSubscription) {
  if (!isRecord(eventSubscription)) {
    throw new Error('eventSubscription must be an object');
  }
  assertStringArray(eventSubscription.agentIdSourcePriority, 'eventSubscription.agentIdSourcePriority');
  assertStringArray(eventSubscription.taskIdSourcePriority, 'eventSubscription.taskIdSourcePriority');
  const expectedAgentIdSourcePriority = ['agentId', 'agentIds[0]'];
  if (JSON.stringify(eventSubscription.agentIdSourcePriority) !== JSON.stringify(expectedAgentIdSourcePriority)) {
    throw new Error('eventSubscription.agentIdSourcePriority must be agentId, agentIds[0]');
  }
  const expectedTaskIdSourcePriority = [
    'certificationCreatedSelectedTaskId',
    'explicitTaskId',
    'controllerSelectedTaskId',
    'snapshotSelectedTaskId',
    'snapshotFirstTaskId',
  ];
  if (JSON.stringify(eventSubscription.taskIdSourcePriority) !== JSON.stringify(expectedTaskIdSourcePriority)) {
    throw new Error('eventSubscription.taskIdSourcePriority must match the official projection stream task fallback order');
  }
  assertString(eventSubscription.defaultCursorSource, 'eventSubscription.defaultCursorSource');
  if (eventSubscription.defaultCursorSource !== 'workspace.replay[taskId].nextEventSeq') {
    throw new Error('eventSubscription.defaultCursorSource must be workspace.replay[taskId].nextEventSeq');
  }
  assertString(eventSubscription.cursorNumberPolicy, 'eventSubscription.cursorNumberPolicy');
  if (eventSubscription.cursorNumberPolicy !== 'safe_integer') {
    throw new Error('eventSubscription.cursorNumberPolicy must be safe_integer');
  }
  assertString(eventSubscription.zeroCursorPolicy, 'eventSubscription.zeroCursorPolicy');
  if (eventSubscription.zeroCursorPolicy !== 'omit') {
    throw new Error('eventSubscription.zeroCursorPolicy must be omit');
  }
  validateZeroCursorException(eventSubscription.zeroCursorException, 'eventSubscription.zeroCursorException');
  validateEventSubscriptionControlledEvidence(
    eventSubscription,
    expectedAgentIdSourcePriority,
    expectedTaskIdSourcePriority,
  );
}

function validateEventSubscriptionControlledEvidence(
  eventSubscription,
  expectedAgentIdSourcePriority,
  expectedTaskIdSourcePriority,
) {
  const controlledEvidence = eventSubscription.controlledEvidence;
  if (!isRecord(controlledEvidence)) {
    throw new Error('eventSubscription.controlledEvidence must describe controlled projection subscription evidence');
  }
  if (controlledEvidence.readiness !== 'controlled_local_upstream') {
    throw new Error('eventSubscription.controlledEvidence.readiness must be controlled_local_upstream');
  }
  if (controlledEvidence.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error('eventSubscription.controlledEvidence.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM');
  }
  const expectedGates = ['atelier:official-frontend-gate', 'atelier:bridge-runtime-gate'];
  assertStringArray(controlledEvidence.gates, 'eventSubscription.controlledEvidence.gates');
  if (JSON.stringify(controlledEvidence.gates) !== JSON.stringify(expectedGates)) {
    throw new Error('eventSubscription.controlledEvidence.gates must be atelier:official-frontend-gate, atelier:bridge-runtime-gate');
  }
  const expectedEvidenceFiles = [
    'tooling/acceptance/evidence/applets/official-applet/atelier-official-frontend-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-bridge-runtime-gate.json',
  ];
  assertStringArray(controlledEvidence.evidenceFiles, 'eventSubscription.controlledEvidence.evidenceFiles');
  if (JSON.stringify(controlledEvidence.evidenceFiles) !== JSON.stringify(expectedEvidenceFiles)) {
    throw new Error('eventSubscription.controlledEvidence.evidenceFiles must match controlled projection subscription evidence files');
  }
  if (controlledEvidence.eventTopic !== 'atelier.projection.event') {
    throw new Error('eventSubscription.controlledEvidence.eventTopic must be atelier.projection.event');
  }
  if (controlledEvidence.subscriptionMethod !== 'atelier.events.subscribe') {
    throw new Error('eventSubscription.controlledEvidence.subscriptionMethod must be atelier.events.subscribe');
  }
  assertStringArray(controlledEvidence.agentIdSourcePriority, 'eventSubscription.controlledEvidence.agentIdSourcePriority');
  if (JSON.stringify(controlledEvidence.agentIdSourcePriority) !== JSON.stringify(expectedAgentIdSourcePriority)) {
    throw new Error('eventSubscription.controlledEvidence.agentIdSourcePriority must match eventSubscription.agentIdSourcePriority');
  }
  assertStringArray(controlledEvidence.taskIdSourcePriority, 'eventSubscription.controlledEvidence.taskIdSourcePriority');
  if (JSON.stringify(controlledEvidence.taskIdSourcePriority) !== JSON.stringify(expectedTaskIdSourcePriority)) {
    throw new Error('eventSubscription.controlledEvidence.taskIdSourcePriority must match eventSubscription.taskIdSourcePriority');
  }
  if (controlledEvidence.defaultCursorSource !== 'workspace.replay[taskId].nextEventSeq') {
    throw new Error('eventSubscription.controlledEvidence.defaultCursorSource must be workspace.replay[taskId].nextEventSeq');
  }
  if (controlledEvidence.cursorNumberPolicy !== 'safe_integer') {
    throw new Error('eventSubscription.controlledEvidence.cursorNumberPolicy must be safe_integer');
  }
  if (controlledEvidence.zeroCursorPolicy !== 'omit') {
    throw new Error('eventSubscription.controlledEvidence.zeroCursorPolicy must be omit');
  }
  validateZeroCursorException(
    controlledEvidence.zeroCursorException,
    'eventSubscription.controlledEvidence.zeroCursorException',
  );
  for (const [field, expected] of Object.entries({
    hostEventBridgeRequired: true,
    missingHostEventBridgeFailsClosed: true,
    subscriptionRejectionTypedRecoveryProven: true,
    eventVsSnapshotFreshnessProven: true,
    releaseBeforeRejectCleanupProven: true,
    boundedRetryMatrixProven: true,
    realStationSseFailureMatrixProven: false,
    realCrossRestartE2EProven: false,
    realHostStationAppletE2EProven: false,
  })) {
    if (controlledEvidence[field] !== expected) {
      throw new Error(`eventSubscription.controlledEvidence.${field} must be ${expected}`);
    }
  }
}

function validateZeroCursorException(value, fieldName) {
  if (!isRecord(value)) {
    throw new Error(`${fieldName} must describe the product-window zero cursor exception`);
  }
  if (value.certificationMode !== 'product-window-e2e') {
    throw new Error(`${fieldName}.certificationMode must be product-window-e2e`);
  }
  if (value.explicitZeroCursorPolicy !== 'preserve') {
    throw new Error(`${fieldName}.explicitZeroCursorPolicy must be preserve`);
  }
}

function patchDefName(kind) {
  return `${kind.replace(/\.([a-z])/g, (_, char) => char.toUpperCase())}Patch`;
}

function buildTypeScript(source) {
  const json = JSON.stringify(
    {
      version: source.version,
      eventTopic: source.eventTopic,
      eventSubscription: source.eventSubscription,
      subscriptionMethod: source.subscriptionMethod,
      methods: source.methods,
      runtimeMethods: source.runtimeMethods,
      methodIntents: source.methodIntents,
      methodGovernance: source.methodGovernance,
      methodPayloads: source.methodPayloads,
      taskLifecycle: source.taskLifecycle,
      agentRoleAuthority: source.agentRoleAuthority,
      negotiationProjection: source.negotiationProjection,
      gatewayActions: source.gatewayActions,
      patchKinds: source.patchKinds,
      replayFields: source.replayFields,
      streamBlocks: source.streamBlocks,
      viewSurface: source.viewSurface,
      projectSurface: source.projectSurface,
      workbenchSurface: source.workbenchSurface,
      budgetSurface: source.budgetSurface,
      artifactPreview: source.artifactPreview,
      readOnlyProjectionSurfaces: source.readOnlyProjectionSurfaces,
      directRunExecutionEvidence: source.directRunExecutionEvidence,
      artifactBodyFetch: source.artifactBodyFetch,
      artifactRendererSurface: source.artifactRendererSurface,
      runtimeLogStream: source.runtimeLogStream,
      hostStorageAttachment: source.hostStorageAttachment,
    },
    null,
    2,
  );
  const projectSurfaceExports = `export const ATELIER_PROJECT_SURFACE = ATELIER_PROJECTION_CONTRACT.projectSurface;\nexport const ATELIER_PROJECT_STATES = ATELIER_PROJECTION_CONTRACT.projectSurface.projectStates;\nexport const ATELIER_MILESTONE_STATES = ATELIER_PROJECTION_CONTRACT.projectSurface.milestoneStates;\nexport const ATELIER_TASK_GRAPH_NODE_STATES = ATELIER_PROJECTION_CONTRACT.projectSurface.taskGraphNodeStates;\nexport const ATELIER_TASK_GRAPH_PARALLEL_POLICIES = ATELIER_PROJECTION_CONTRACT.projectSurface.taskGraphParallelPolicies;\nexport const ATELIER_DEPENDENCY_EDGE_TYPES = ATELIER_PROJECTION_CONTRACT.projectSurface.dependencyEdgeTypes;\nexport const ATELIER_BLOCKER_SEVERITIES = ATELIER_PROJECTION_CONTRACT.projectSurface.blockerSeverities;\nexport const ATELIER_BLOCKER_STATES = ATELIER_PROJECTION_CONTRACT.projectSurface.blockerStates;\nexport const ATELIER_RESIDUAL_RISK_STATES = ATELIER_PROJECTION_CONTRACT.projectSurface.residualRiskStates;\nexport const ATELIER_MEMORY_CANDIDATE_TYPES = ATELIER_PROJECTION_CONTRACT.projectSurface.memoryCandidateTypes;\nexport const ATELIER_MEMORY_CANDIDATE_SCOPES = ATELIER_PROJECTION_CONTRACT.projectSurface.memoryCandidateScopes;\nexport const ATELIER_MEMORY_CANDIDATE_FEEDS = ATELIER_PROJECTION_CONTRACT.projectSurface.memoryCandidateFeeds;\nexport type AtelierMemoryCandidateFeed = typeof ATELIER_MEMORY_CANDIDATE_FEEDS[number];\nexport const ATELIER_POLICY_RULE_SCOPES = ATELIER_PROJECTION_CONTRACT.projectSurface.policyRuleScopes;\nexport const ATELIER_DEFECT_SOURCES = ATELIER_PROJECTION_CONTRACT.projectSurface.defectSources;\nexport const ATELIER_DEFECT_STATES = ATELIER_PROJECTION_CONTRACT.projectSurface.defectStates;\nexport const ATELIER_PROJECTION_DISPLAY_LIMITS = ATELIER_PROJECTION_CONTRACT.projectSurface.projectionDisplayLimits;\n`;
    const workbenchSurfaceExports = `export const ATELIER_RECOVERY_KINDS = ATELIER_PROJECTION_CONTRACT.viewSurface.recovery.kinds;\nexport type AtelierRecoveryKind = typeof ATELIER_RECOVERY_KINDS[number];\nexport const ATELIER_WORKBENCH_SURFACE = ATELIER_PROJECTION_CONTRACT.workbenchSurface;\nexport const ATELIER_TASK_INTENT_PRESETS = ATELIER_PROJECTION_CONTRACT.workbenchSurface.taskIntentPresets;\nexport const ATELIER_DEFAULT_TASK_INTENT_PRESET = ATELIER_PROJECTION_CONTRACT.workbenchSurface.defaultTaskIntentPreset;\nexport const ATELIER_RUN_TARGET_KINDS = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].allowedRunKinds;\nexport type AtelierRunTargetKind = typeof ATELIER_RUN_TARGET_KINDS[number];\nexport const ATELIER_DEFAULT_RUN_TARGET_KIND = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].defaultRunKind;\nexport const ATELIER_DIRECT_RUN_MODELS = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].allowedDirectRunModels;\nexport type AtelierDirectRunModel = typeof ATELIER_DIRECT_RUN_MODELS[number];\nexport const ATELIER_DEFAULT_DIRECT_RUN_MODEL = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].defaultDirectRunModel;\nexport const ATELIER_AGENT_FLOW_IDS = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].allowedAgentFlowIds;\nexport type AtelierAgentFlowId = typeof ATELIER_AGENT_FLOW_IDS[number];\nexport const ATELIER_DEFAULT_AGENT_FLOW_ID = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].defaultAgentFlowId;\nexport const ATELIER_AGENT_FLOW_DESCRIPTORS = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].agentFlowDescriptors;\nexport type AtelierAgentFlowDescriptor = typeof ATELIER_AGENT_FLOW_DESCRIPTORS[number];\nexport const ATELIER_FEEDBACK_SIGNALS = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.feedback.submit'].allowedSignals;\nexport type AtelierFeedbackSignal = typeof ATELIER_FEEDBACK_SIGNALS[number];\nexport const ATELIER_MEMORY_CONFIRMATION_MODE = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.memory.confirmCandidate'].allowedConfirmationMode;\nexport const ATELIER_RERUN_CONFIRMATION_MODE = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.feedback.confirmRerun'].allowedConfirmationMode;\nexport const ATELIER_WORKSPACE_OPEN_URI_SCHEMES = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.workspace.open'].allowedUriSchemes;\nexport const ATELIER_WORKSPACE_OPEN_URI_SHAPE = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.workspace.open'].uriShape;\nexport const ATELIER_PROVIDER_CAPABILITY_SCOPES = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.provider.capabilities'].allowedCapabilityScopes;\nexport const ATELIER_PROVIDER_CAPABILITY_READ_ONLY = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.provider.capabilities'].capabilityReadOnly;\nexport const ATELIER_CREATE_FROM_GOAL_INTENT_PRESET_MAPPING = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].intentPresetMapping;\nexport const ATELIER_TODO_STATUSES = ATELIER_PROJECTION_CONTRACT.workbenchSurface.todoStatuses;\nexport const ATELIER_CONTEXT_FILE_GROUPS = ATELIER_PROJECTION_CONTRACT.workbenchSurface.contextFileGroups;\nexport const ATELIER_DEFAULT_CONTEXT_FILE_GROUP = ATELIER_PROJECTION_CONTRACT.workbenchSurface.defaultContextFileGroup;\nexport const ATELIER_TASK_ORGANIZER_MODES = ATELIER_PROJECTION_CONTRACT.workbenchSurface.taskOrganizerModes;\nexport type AtelierTaskOrganizerMode = typeof ATELIER_TASK_ORGANIZER_MODES[number]['id'];\nexport const ATELIER_DEFAULT_TASK_ORGANIZER_MODE = ATELIER_PROJECTION_CONTRACT.workbenchSurface.defaultTaskOrganizerMode;\nexport const ATELIER_ARTIFACT_KINDS = ATELIER_PROJECTION_CONTRACT.workbenchSurface.artifactKinds;\nexport const ATELIER_ARTIFACT_BODY_KINDS = ATELIER_PROJECTION_CONTRACT.workbenchSurface.artifactBodyKinds;\nexport const ATELIER_GATE_STATUSES = ATELIER_PROJECTION_CONTRACT.workbenchSurface.gateStatuses;\nexport const ATELIER_GATE_CHECK_STATUSES = ATELIER_PROJECTION_CONTRACT.workbenchSurface.gateCheckStatuses;\n`;
  const budgetSurfaceExports = `export const ATELIER_BUDGET_SURFACE = ATELIER_PROJECTION_CONTRACT.budgetSurface;\nexport const ATELIER_BUDGET_STATUSES = ATELIER_PROJECTION_CONTRACT.budgetSurface.budgetStatuses;\n`;
  const providerCapabilityExports = `export const ATELIER_METHOD_GOVERNANCE = ATELIER_PROJECTION_CONTRACT.methodGovernance;\nexport const ATELIER_PROVIDER_CAPABILITY_SCOPE = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.provider.capabilities'].capabilityScope;\nexport const ATELIER_ARTIFACT_PREVIEW_OPEN_DEFAULT_MODE = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].defaultMode;\nexport const ATELIER_ARTIFACT_PREVIEW_TARGET_KINDS = ATELIER_PROJECTION_CONTRACT.artifactPreview.allowedPreviewTargetKinds;\n`;
  return `// Generated from apps/applets/atelier/contracts/atelier-projection.contract.json.\n// Do not edit by hand. Run \`pnpm run atelier:projection-codegen\`.\n\nexport const ATELIER_PROJECTION_CONTRACT = ${json} as const;\n\nexport type AtelierProjectionVersion = typeof ATELIER_PROJECTION_CONTRACT.version;\nexport type AtelierProjectionPatchKind = typeof ATELIER_PROJECTION_CONTRACT.patchKinds[number];\nexport type AtelierArtifactPreviewHint = typeof ATELIER_PROJECTION_CONTRACT.artifactPreview.allowedPreviewHints[number];\nexport type AtelierTaskLifecycleStatus = typeof ATELIER_PROJECTION_CONTRACT.taskLifecycle.states[number];\nexport type AtelierViewStatus = typeof ATELIER_PROJECTION_CONTRACT.viewSurface.statuses[number];\nexport type AtelierEventStreamState = typeof ATELIER_PROJECTION_CONTRACT.viewSurface.eventStreamStates[number];\nexport type AtelierTypedRecoveryKind = typeof ATELIER_PROJECTION_CONTRACT.viewSurface.typedRecoveryKinds[number];\nexport type AtelierStatusNoticeKind = typeof ATELIER_PROJECTION_CONTRACT.viewSurface.statusNoticeKinds[number];\nexport type AtelierRecoveryTone = typeof ATELIER_PROJECTION_CONTRACT.viewSurface.recovery.tones[number];\nexport type AtelierPrototypeRecoverySeverity = typeof ATELIER_PROJECTION_CONTRACT.viewSurface.recovery.prototypeSeverityByStatus[AtelierViewStatus];\nexport type AtelierPrototypeRecoverySymbol = typeof ATELIER_PROJECTION_CONTRACT.viewSurface.recovery.prototypeSymbolByStatus[AtelierViewStatus];\nexport type AtelierBudgetStatus = typeof ATELIER_PROJECTION_CONTRACT.budgetSurface.budgetStatuses[number];\nexport type AtelierAgentRole = typeof ATELIER_PROJECTION_CONTRACT.agentRoleAuthority.roles[number];\n\nexport const ATELIER_PROJECTION_EVENT_TOPIC = ATELIER_PROJECTION_CONTRACT.eventTopic;\nexport const ATELIER_PROJECTION_SUBSCRIPTION_METHOD = ATELIER_PROJECTION_CONTRACT.subscriptionMethod;\nexport const ATELIER_METHOD_INTENTS = ATELIER_PROJECTION_CONTRACT.methodIntents;\nexport const ATELIER_TASK_LIFECYCLE = ATELIER_PROJECTION_CONTRACT.taskLifecycle;\nexport const ATELIER_TASK_LIFECYCLE_STATES = ATELIER_PROJECTION_CONTRACT.taskLifecycle.states;\nexport const ATELIER_AGENT_ROLE_AUTHORITY = ATELIER_PROJECTION_CONTRACT.agentRoleAuthority;\nexport const ATELIER_AGENT_ROLES = ATELIER_PROJECTION_CONTRACT.agentRoleAuthority.roles;\nexport const ATELIER_STREAM_BLOCK_KINDS = ATELIER_PROJECTION_CONTRACT.streamBlocks.allowedKinds;\nexport const ATELIER_STREAM_BLOCK_REQUIRED_FIELDS_BY_KIND = ATELIER_PROJECTION_CONTRACT.streamBlocks.requiredFieldsByKind;\nexport const ATELIER_DIFF_STREAM_SUMMARY_FIELDS = ATELIER_PROJECTION_CONTRACT.streamBlocks.diffSummaryFields;\nexport const ATELIER_VIEW_SURFACE = ATELIER_PROJECTION_CONTRACT.viewSurface;\nexport const ATELIER_VIEW_STATUSES = ATELIER_PROJECTION_CONTRACT.viewSurface.statuses;\nexport const ATELIER_EVENT_STREAM_STATES = ATELIER_PROJECTION_CONTRACT.viewSurface.eventStreamStates;\nexport const ATELIER_TYPED_RECOVERY_KINDS = ATELIER_PROJECTION_CONTRACT.viewSurface.typedRecoveryKinds;\nexport const ATELIER_STATUS_NOTICE_KINDS = ATELIER_PROJECTION_CONTRACT.viewSurface.statusNoticeKinds;\nexport const ATELIER_EMPTY_CTA_STATUS = ATELIER_PROJECTION_CONTRACT.viewSurface.emptyCtaStatus;\nexport const ATELIER_RECONCILING_EVENT_STREAM_STATE = ATELIER_PROJECTION_CONTRACT.viewSurface.reconcilingEventStreamState;\nexport const ATELIER_DEGRADED_EVENT_STREAM_STATES = ATELIER_PROJECTION_CONTRACT.viewSurface.degradedEventStreamStates;\nexport const ATELIER_RECOVERY_TONES = ATELIER_PROJECTION_CONTRACT.viewSurface.recovery.tones;\nexport const ATELIER_RECOVERY_TONE_BY_KIND = ATELIER_PROJECTION_CONTRACT.viewSurface.recovery.toneByKind;\nexport const ATELIER_RECOVERY_RETRYABLE_KINDS = ATELIER_PROJECTION_CONTRACT.viewSurface.recovery.retryableKinds;\nexport const ATELIER_PROTOTYPE_RECOVERY_SEVERITY_BY_STATUS = ATELIER_PROJECTION_CONTRACT.viewSurface.recovery.prototypeSeverityByStatus;\nexport const ATELIER_PROTOTYPE_RECOVERY_SYMBOL_BY_STATUS = ATELIER_PROJECTION_CONTRACT.viewSurface.recovery.prototypeSymbolByStatus;\nexport const ATELIER_STATUS_LABEL_KEY_BY_STATUS = ATELIER_PROJECTION_CONTRACT.viewSurface.recovery.statusLabelKeyByStatus;\n${projectSurfaceExports}${workbenchSurfaceExports}${budgetSurfaceExports}${providerCapabilityExports}export const ATELIER_ARTIFACT_PREVIEW_HINTS = ATELIER_PROJECTION_CONTRACT.artifactPreview.allowedPreviewHints;\nexport const ATELIER_ARTIFACT_METADATA_FIELDS = ATELIER_PROJECTION_CONTRACT.artifactPreview.metadataFields;\nexport const ATELIER_ARTIFACT_PREVIEW_TARGET_FIELDS = ATELIER_PROJECTION_CONTRACT.artifactPreview.previewTargetFields;\nexport const ATELIER_ARTIFACT_PREVIEW_TARGET_MODES = ATELIER_PROJECTION_CONTRACT.artifactPreview.allowedPreviewTargetModes;\nexport const ATELIER_ARTIFACT_BODY_REF_SCHEMES = ATELIER_PROJECTION_CONTRACT.artifactPreview.allowedBodyRefSchemes;\nexport const ATELIER_ARTIFACT_PREVIEW_TARGET_SANDBOX_REF_SCHEMES = ATELIER_PROJECTION_CONTRACT.artifactPreview.allowedSandboxRefSchemes;\nexport const ATELIER_ARTIFACT_BODY_REF_SHAPE = ATELIER_PROJECTION_CONTRACT.artifactPreview.bodyRefShape;\nexport const ATELIER_ARTIFACT_SANDBOX_REF_SHAPE = ATELIER_PROJECTION_CONTRACT.artifactPreview.sandboxRefShape;\nexport const ATELIER_ARTIFACT_PREVIEW_OPEN_MODES = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].allowedModes;\nexport const ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_OWNERS = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].allowedRendererOwner;\nexport const ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_MODES = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].allowedRendererMode;\nexport const ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_STATUSES = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].allowedRendererStatus;\nexport const ATELIER_ARTIFACT_FORBIDDEN_BODY_FIELDS = ATELIER_PROJECTION_CONTRACT.artifactPreview.forbiddenBodyFields;\nexport const ATELIER_RUNTIME_LOG_STREAM = ATELIER_PROJECTION_CONTRACT.runtimeLogStream;\nexport const ATELIER_RUNTIME_LOG_STREAM_LEVELS = ATELIER_PROJECTION_CONTRACT.runtimeLogStream.levels;\nexport const ATELIER_RUNTIME_LOG_STREAM_FORBIDDEN_METHODS = ATELIER_PROJECTION_CONTRACT.runtimeLogStream.forbiddenMethods;\nexport const ATELIER_RUNTIME_LOG_STREAM_FORBIDDEN_FIELDS = ATELIER_PROJECTION_CONTRACT.runtimeLogStream.forbiddenFields;\nexport const ATELIER_HOST_STORAGE_ATTACHMENT = ATELIER_PROJECTION_CONTRACT.hostStorageAttachment;\nexport const ATELIER_HOST_STORAGE_ATTACHMENT_REF_SHAPE = ATELIER_PROJECTION_CONTRACT.hostStorageAttachment.refShape;\nexport const ATELIER_HOST_STORAGE_ATTACHMENT_REQUIRED_METADATA_FIELDS = ATELIER_PROJECTION_CONTRACT.hostStorageAttachment.requiredMetadataFields;\nexport const ATELIER_HOST_STORAGE_ATTACHMENT_FORBIDDEN_FIELDS = ATELIER_PROJECTION_CONTRACT.hostStorageAttachment.forbiddenFields;\nexport const ATELIER_HOST_STORAGE_ATTACHMENT_FORBIDDEN_METHODS = ATELIER_PROJECTION_CONTRACT.hostStorageAttachment.forbiddenMethods;\n`;
}

function validateAgentRoleAuthority(agentRoleAuthority) {
  if (!isRecord(agentRoleAuthority)) {
    throw new Error('agentRoleAuthority must be an object');
  }
  const requiredRoles = ['goal_owner', 'architect', 'planner', 'risk', 'supervisor', 'executor', 'verifier', 'integrator', 'historian'];
  assertStringArray(agentRoleAuthority.roles, 'agentRoleAuthority.roles');
  if (JSON.stringify(agentRoleAuthority.roles) !== JSON.stringify(requiredRoles)) {
    throw new Error('agentRoleAuthority.roles must match the canonical Atelier agent roles');
  }
  const expectedRoleSets = {
    terminalSignoffRoles: ['goal_owner'],
    hardVetoRoles: ['risk'],
    acceptanceVetoRoles: ['verifier'],
    progressControlRoles: ['supervisor'],
    judgmentForbiddenRoles: ['executor'],
    mergeRoles: ['integrator'],
    memoryRecordRoles: ['historian'],
  };
  for (const [field, expected] of Object.entries(expectedRoleSets)) {
    assertStringArray(agentRoleAuthority[field], `agentRoleAuthority.${field}`);
    if (JSON.stringify(agentRoleAuthority[field]) !== JSON.stringify(expected)) {
      throw new Error(`agentRoleAuthority.${field} must be ${expected.join(', ')}`);
    }
    for (const role of agentRoleAuthority[field]) {
      if (!agentRoleAuthority.roles.includes(role)) {
        throw new Error(`agentRoleAuthority.${field}.${role} must be a canonical role`);
      }
    }
  }
  assertString(agentRoleAuthority.executionOwner, 'agentRoleAuthority.executionOwner');
  if (agentRoleAuthority.executionOwner !== 'station') {
    throw new Error('agentRoleAuthority.executionOwner must be station');
  }
  if (agentRoleAuthority.appletMayExecuteAuthority !== false) {
    throw new Error('agentRoleAuthority.appletMayExecuteAuthority must be false');
  }
  validateAgentRoleAuthorityControlledEvidence(agentRoleAuthority, requiredRoles, expectedRoleSets);
}

function validateAgentRoleAuthorityControlledEvidence(agentRoleAuthority, requiredRoles, expectedRoleSets) {
  const controlledEvidence = agentRoleAuthority.controlledEvidence;
  if (!isRecord(controlledEvidence)) {
    throw new Error('agentRoleAuthority.controlledEvidence must describe controlled authority evidence');
  }
  if (controlledEvidence.readiness !== 'controlled_local_upstream') {
    throw new Error('agentRoleAuthority.controlledEvidence.readiness must be controlled_local_upstream');
  }
  if (controlledEvidence.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error('agentRoleAuthority.controlledEvidence.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM');
  }
  const expectedGates = ['atelier:projection-contract-gate', 'atelier:official-frontend-gate', 'atelier:bridge-runtime-gate'];
  assertStringArray(controlledEvidence.gates, 'agentRoleAuthority.controlledEvidence.gates');
  if (JSON.stringify(controlledEvidence.gates) !== JSON.stringify(expectedGates)) {
    throw new Error('agentRoleAuthority.controlledEvidence.gates must be atelier:projection-contract-gate, atelier:official-frontend-gate, atelier:bridge-runtime-gate');
  }
  const expectedEvidenceFiles = [
    'tooling/acceptance/evidence/applets/official-applet/atelier-official-frontend-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-bridge-runtime-gate.json',
  ];
  assertStringArray(controlledEvidence.evidenceFiles, 'agentRoleAuthority.controlledEvidence.evidenceFiles');
  if (JSON.stringify(controlledEvidence.evidenceFiles) !== JSON.stringify(expectedEvidenceFiles)) {
    throw new Error('agentRoleAuthority.controlledEvidence.evidenceFiles must match controlled authority evidence files');
  }
  assertStringArray(controlledEvidence.roles, 'agentRoleAuthority.controlledEvidence.roles');
  if (JSON.stringify(controlledEvidence.roles) !== JSON.stringify(requiredRoles)) {
    throw new Error('agentRoleAuthority.controlledEvidence.roles must match agentRoleAuthority.roles');
  }
  for (const [field, expected] of Object.entries(expectedRoleSets)) {
    assertStringArray(controlledEvidence[field], `agentRoleAuthority.controlledEvidence.${field}`);
    if (JSON.stringify(controlledEvidence[field]) !== JSON.stringify(expected)) {
      throw new Error(`agentRoleAuthority.controlledEvidence.${field} must match agentRoleAuthority.${field}`);
    }
  }
  for (const [field, expected] of Object.entries({
    executionOwner: 'station',
    appletMayExecuteAuthority: false,
    formalProtoAuthoritySchemaProven: true,
    stationRoleAllowlistParityProven: true,
    appletAuthorityExecutionExposed: false,
    realConsensusEvaluatorE2EProven: false,
    realVetoSignoffE2EProven: false,
    realSchedulePolicyRuntimeProven: false,
    realHostStationAppletE2EProven: false,
  })) {
    if (controlledEvidence[field] !== expected) {
      throw new Error(`agentRoleAuthority.controlledEvidence.${field} must be ${expected}`);
    }
  }
}

function validateNegotiationProjection(negotiationProjection) {
  if (!isRecord(negotiationProjection)) {
    throw new Error('negotiationProjection must be an object');
  }
  const requiredStances = ['proposal', 'objection', 'counter', 'signoff'];
  assertStringArray(negotiationProjection.voiceStances, 'negotiationProjection.voiceStances');
  if (JSON.stringify(negotiationProjection.voiceStances) !== JSON.stringify(requiredStances)) {
    throw new Error('negotiationProjection.voiceStances must match the canonical voice stance taxonomy');
  }
  assertStringArray(negotiationProjection.requiredVoiceFields, 'negotiationProjection.requiredVoiceFields');
  if (JSON.stringify(negotiationProjection.requiredVoiceFields) !== JSON.stringify(['role', 'stance', 'text'])) {
    throw new Error('negotiationProjection.requiredVoiceFields must be role, stance, text');
  }
  assertStringArray(negotiationProjection.optionalVoiceFields, 'negotiationProjection.optionalVoiceFields');
  if (JSON.stringify(negotiationProjection.optionalVoiceFields) !== JSON.stringify(['evidenceRef', 'sessionId', 'roundId', 'voiceId', 'objectionId'])) {
    throw new Error('negotiationProjection.optionalVoiceFields must match the canonical optional voice trace fields');
  }
  assertStringArray(negotiationProjection.evidenceRequiredStances, 'negotiationProjection.evidenceRequiredStances');
  if (JSON.stringify(negotiationProjection.evidenceRequiredStances) !== JSON.stringify(['objection'])) {
    throw new Error('negotiationProjection.evidenceRequiredStances must be objection');
  }
  assertString(negotiationProjection.noEvidenceObjectionDisposition, 'negotiationProjection.noEvidenceObjectionDisposition');
  if (negotiationProjection.noEvidenceObjectionDisposition !== 'concern') {
    throw new Error('negotiationProjection.noEvidenceObjectionDisposition must be concern');
  }
  assertString(negotiationProjection.consensusOwner, 'negotiationProjection.consensusOwner');
  if (negotiationProjection.consensusOwner !== 'station') {
    throw new Error('negotiationProjection.consensusOwner must be station');
  }
  if (negotiationProjection.appletMayResolveConsensus !== false) {
    throw new Error('negotiationProjection.appletMayResolveConsensus must be false');
  }
  const expectedForbiddenActions = [
    'agent.invoke',
    'atelier.agent',
    'orchestration.start',
    'negotiation.run',
    'provider.invoke',
    'runtime.invokeProvider',
    'runtime.execute',
    'gate.rerun',
    'taskGraph.diff.apply',
  ];
  assertStringArray(negotiationProjection.forbiddenActions, 'negotiationProjection.forbiddenActions');
  if (JSON.stringify(negotiationProjection.forbiddenActions) !== JSON.stringify(expectedForbiddenActions)) {
    throw new Error('negotiationProjection.forbiddenActions must match the canonical read-only forbidden surface');
  }
  validateNegotiationProjectionControlledEvidence(negotiationProjection);
}

function validateNegotiationProjectionControlledEvidence(negotiationProjection) {
  const controlledEvidence = negotiationProjection.controlledEvidence;
  if (!isRecord(controlledEvidence)) {
    throw new Error('negotiationProjection.controlledEvidence must describe controlled negotiation projection evidence');
  }
  if (controlledEvidence.readiness !== 'controlled_local_upstream') {
    throw new Error('negotiationProjection.controlledEvidence.readiness must be controlled_local_upstream');
  }
  if (controlledEvidence.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error('negotiationProjection.controlledEvidence.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM');
  }
  const expectedGates = ['atelier:projection-contract-gate', 'atelier:official-frontend-gate', 'atelier:bridge-runtime-gate'];
  assertStringArray(controlledEvidence.gates, 'negotiationProjection.controlledEvidence.gates');
  if (JSON.stringify(controlledEvidence.gates) !== JSON.stringify(expectedGates)) {
    throw new Error('negotiationProjection.controlledEvidence.gates must be atelier:projection-contract-gate, atelier:official-frontend-gate, atelier:bridge-runtime-gate');
  }
  const expectedEvidenceFiles = [
    'tooling/acceptance/evidence/applets/official-applet/atelier-official-frontend-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-bridge-runtime-gate.json',
  ];
  assertStringArray(controlledEvidence.evidenceFiles, 'negotiationProjection.controlledEvidence.evidenceFiles');
  if (JSON.stringify(controlledEvidence.evidenceFiles) !== JSON.stringify(expectedEvidenceFiles)) {
    throw new Error('negotiationProjection.controlledEvidence.evidenceFiles must match controlled negotiation evidence files');
  }
  for (const field of [
    'voiceStances',
    'requiredVoiceFields',
    'optionalVoiceFields',
    'evidenceRequiredStances',
    'forbiddenActions',
  ]) {
    assertStringArray(controlledEvidence[field], `negotiationProjection.controlledEvidence.${field}`);
    if (JSON.stringify(controlledEvidence[field]) !== JSON.stringify(negotiationProjection[field])) {
      throw new Error(`negotiationProjection.controlledEvidence.${field} must match negotiationProjection.${field}`);
    }
  }
  for (const [field, expected] of Object.entries({
    noEvidenceObjectionDisposition: 'concern',
    consensusOwner: 'station',
    appletMayResolveConsensus: false,
    officialProjectionParserGuardProven: true,
    prototypeProjectionIngressGuardProven: true,
    appletConsensusExecutionExposed: false,
    realConsensusEvaluatorE2EProven: false,
    realMultiAgentNegotiationRuntimeProven: false,
    realProviderVoiceQualityProven: false,
    realHostStationAppletE2EProven: false,
  })) {
    if (controlledEvidence[field] !== expected) {
      throw new Error(`negotiationProjection.controlledEvidence.${field} must be ${expected}`);
    }
  }
}

function validateStreamBlockRequiredFields(streamBlocks) {
  if (!isRecord(streamBlocks.requiredFieldsByKind)) {
    throw new Error('streamBlocks.requiredFieldsByKind must be an object');
  }
  for (const kind of streamBlocks.allowedKinds) {
    assertStringArray(streamBlocks.requiredFieldsByKind[kind], `streamBlocks.requiredFieldsByKind.${kind}`);
  }
  validateStreamBlocksControlledEvidence(streamBlocks);
}

function validateStreamBlocksControlledEvidence(streamBlocks) {
  const controlledEvidence = streamBlocks.controlledEvidence;
  if (!isRecord(controlledEvidence)) {
    throw new Error('streamBlocks.controlledEvidence must describe controlled stream block evidence');
  }
  if (controlledEvidence.readiness !== 'controlled_local_upstream') {
    throw new Error('streamBlocks.controlledEvidence.readiness must be controlled_local_upstream');
  }
  if (controlledEvidence.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error('streamBlocks.controlledEvidence.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM');
  }
  const expectedGates = ['atelier:projection-contract-gate', 'atelier:official-frontend-gate', 'atelier:bridge-runtime-gate'];
  assertStringArray(controlledEvidence.gates, 'streamBlocks.controlledEvidence.gates');
  if (JSON.stringify(controlledEvidence.gates) !== JSON.stringify(expectedGates)) {
    throw new Error('streamBlocks.controlledEvidence.gates must be atelier:projection-contract-gate, atelier:official-frontend-gate, atelier:bridge-runtime-gate');
  }
  const expectedEvidenceFiles = [
    'tooling/acceptance/evidence/applets/official-applet/atelier-official-frontend-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-bridge-runtime-gate.json',
  ];
  assertStringArray(controlledEvidence.evidenceFiles, 'streamBlocks.controlledEvidence.evidenceFiles');
  if (JSON.stringify(controlledEvidence.evidenceFiles) !== JSON.stringify(expectedEvidenceFiles)) {
    throw new Error('streamBlocks.controlledEvidence.evidenceFiles must match controlled stream block evidence files');
  }
  assertStringArray(controlledEvidence.allowedKinds, 'streamBlocks.controlledEvidence.allowedKinds');
  if (JSON.stringify(controlledEvidence.allowedKinds) !== JSON.stringify(streamBlocks.allowedKinds)) {
    throw new Error('streamBlocks.controlledEvidence.allowedKinds must match streamBlocks.allowedKinds');
  }
  if (!isRecord(controlledEvidence.requiredFieldsByKind)) {
    throw new Error('streamBlocks.controlledEvidence.requiredFieldsByKind must be an object');
  }
  if (JSON.stringify(controlledEvidence.requiredFieldsByKind) !== JSON.stringify(streamBlocks.requiredFieldsByKind)) {
    throw new Error('streamBlocks.controlledEvidence.requiredFieldsByKind must match streamBlocks.requiredFieldsByKind');
  }
  assertStringArray(controlledEvidence.diffSummaryFields, 'streamBlocks.controlledEvidence.diffSummaryFields');
  if (JSON.stringify(controlledEvidence.diffSummaryFields) !== JSON.stringify(streamBlocks.diffSummaryFields)) {
    throw new Error('streamBlocks.controlledEvidence.diffSummaryFields must match streamBlocks.diffSummaryFields');
  }
  for (const [field, expected] of Object.entries({
    officialProjectionIngressGuardProven: true,
    prototypeProjectionIngressGuardProven: true,
    diffMetadataOnlyCardProven: true,
    rawDiffPatchRenderingForbidden: true,
    appletStreamProducerExposed: false,
    realStreamProducerRuntimeProven: false,
    realProviderExecutionProven: false,
    realArtifactBodyRendererProven: false,
    realDesktopProductWindowUIProven: false,
    realHostStationAppletE2EProven: false,
  })) {
    if (controlledEvidence[field] !== expected) {
      throw new Error(`streamBlocks.controlledEvidence.${field} must be ${expected}`);
    }
  }
}

function validateViewSurface(viewSurface) {
  if (!isRecord(viewSurface)) {
    throw new Error('viewSurface must be an object');
  }
  assertStringArray(viewSurface.statuses, 'viewSurface.statuses');
  const requiredStatuses = ['loading', 'empty', 'ready', 'reconciling', 'degraded', 'disconnected', 'auth-denied', 'error'];
  if (JSON.stringify(viewSurface.statuses) !== JSON.stringify(requiredStatuses)) {
    throw new Error('viewSurface.statuses must match the canonical projection surface status taxonomy');
  }
  assertStringArray(viewSurface.eventStreamStates, 'viewSurface.eventStreamStates');
  const requiredEventStreamStates = ['idle', 'subscribing', 'live', 'degraded'];
  if (JSON.stringify(viewSurface.eventStreamStates) !== JSON.stringify(requiredEventStreamStates)) {
    throw new Error('viewSurface.eventStreamStates must match the canonical projection event stream states');
  }
  assertStringArray(viewSurface.typedRecoveryKinds, 'viewSurface.typedRecoveryKinds');
  const requiredTypedRecoveryKinds = ['auth-denied', 'disconnected'];
  if (JSON.stringify(viewSurface.typedRecoveryKinds) !== JSON.stringify(requiredTypedRecoveryKinds)) {
    throw new Error('viewSurface.typedRecoveryKinds must be auth-denied, disconnected');
  }
  assertStringArray(viewSurface.statusNoticeKinds, 'viewSurface.statusNoticeKinds');
  const requiredStatusNoticeKinds = ['reconciling', 'degraded'];
  if (JSON.stringify(viewSurface.statusNoticeKinds) !== JSON.stringify(requiredStatusNoticeKinds)) {
    throw new Error('viewSurface.statusNoticeKinds must be reconciling, degraded');
  }
  for (const status of viewSurface.statusNoticeKinds) {
    if (!viewSurface.statuses.includes(status)) {
      throw new Error(`viewSurface.statusNoticeKinds.${status} must be a view status`);
    }
  }
  validateLabelKeyByStatus(viewSurface.statusNoticeLabelKeyByStatus, viewSurface.statusNoticeKinds, 'viewSurface.statusNoticeLabelKeyByStatus');
  assertString(viewSurface.emptyCtaStatus, 'viewSurface.emptyCtaStatus');
  if (viewSurface.emptyCtaStatus !== 'empty') {
    throw new Error('viewSurface.emptyCtaStatus must be empty');
  }
  validateLabelKeyByStatus(viewSurface.centeredStateLabelKeyByStatus, ['loading', 'empty'], 'viewSurface.centeredStateLabelKeyByStatus');
  validatePrototypeStatusScenarioCopyByStatus(viewSurface.prototypeStatusScenarioCopyByStatus, viewSurface.statuses);
  validateCopyByKind(viewSurface.bridgeRuntimeStatusCopyByKind, ['loading', 'ready', 'reconciling', 'degraded', 'auth-denied', 'disconnected', 'error'], 'viewSurface.bridgeRuntimeStatusCopyByKind');
  validateBridgeRuntimeRecoveryCodeKindByCode(viewSurface.bridgeRuntimeRecoveryCodeKindByCode);
  assertString(viewSurface.reconcilingEventStreamState, 'viewSurface.reconcilingEventStreamState');
  if (viewSurface.reconcilingEventStreamState !== 'subscribing') {
    throw new Error('viewSurface.reconcilingEventStreamState must be subscribing');
  }
  assertStringArray(viewSurface.degradedEventStreamStates, 'viewSurface.degradedEventStreamStates');
  if (JSON.stringify(viewSurface.degradedEventStreamStates) !== JSON.stringify(['degraded'])) {
    throw new Error('viewSurface.degradedEventStreamStates must be degraded');
  }
  if (!isRecord(viewSurface.recovery)) {
    throw new Error('viewSurface.recovery must be an object');
  }
  assertStringArray(viewSurface.recovery.tones, 'viewSurface.recovery.tones');
  const allowedTones = new Set(viewSurface.recovery.tones);
  const requiredTones = ['warning', 'danger'];
  if (JSON.stringify(viewSurface.recovery.tones) !== JSON.stringify(requiredTones)) {
    throw new Error('viewSurface.recovery.tones must be warning, danger');
  }
  assertStringArray(viewSurface.recovery.kinds, 'viewSurface.recovery.kinds');
  validateStringMap(viewSurface.recovery.toneByKind, allowedTones, 'viewSurface.recovery.toneByKind');
  if (JSON.stringify(Object.keys(viewSurface.recovery.toneByKind)) !== JSON.stringify(viewSurface.recovery.kinds)) {
    throw new Error('viewSurface.recovery.kinds must match toneByKind keys');
  }
  validateRecoveryLabelKeyByKind(viewSurface.recovery.labelKeyByKind, viewSurface.recovery.kinds);
  assertStringArray(viewSurface.recovery.retryableKinds, 'viewSurface.recovery.retryableKinds');
  for (const kind of viewSurface.recovery.retryableKinds) {
    if (!Object.hasOwn(viewSurface.recovery.toneByKind, kind)) {
      throw new Error(`viewSurface.recovery.retryableKinds.${kind} must have a toneByKind entry`);
    }
  }
  validateStatusMap(viewSurface.recovery.statusSeverityByStatus, viewSurface.statuses, 'viewSurface.recovery.statusSeverityByStatus');
  validateStatusMap(viewSurface.recovery.statusLabelKeyByStatus, viewSurface.statuses, 'viewSurface.recovery.statusLabelKeyByStatus');
  validateStatusMap(viewSurface.recovery.prototypeSeverityByStatus, viewSurface.statuses, 'viewSurface.recovery.prototypeSeverityByStatus');
  validateStatusMap(viewSurface.recovery.prototypeSymbolByStatus, viewSurface.statuses, 'viewSurface.recovery.prototypeSymbolByStatus');
  validateViewSurfaceControlledEvidence(viewSurface);
}

function validateViewSurfaceControlledEvidence(viewSurface) {
  const controlledEvidence = viewSurface.controlledEvidence;
  if (!isRecord(controlledEvidence)) {
    throw new Error('viewSurface.controlledEvidence must describe controlled UI/status taxonomy evidence');
  }
  if (controlledEvidence.readiness !== 'controlled_local_upstream') {
    throw new Error('viewSurface.controlledEvidence.readiness must be controlled_local_upstream');
  }
  if (controlledEvidence.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error('viewSurface.controlledEvidence.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM');
  }
  assertStringArray(controlledEvidence.gates, 'viewSurface.controlledEvidence.gates');
  for (const gate of ['atelier:official-frontend-gate', 'atelier:bridge-runtime-gate']) {
    if (!controlledEvidence.gates.includes(gate)) {
      throw new Error(`viewSurface.controlledEvidence.gates must include ${gate}`);
    }
  }
  assertStringArray(controlledEvidence.evidenceFiles, 'viewSurface.controlledEvidence.evidenceFiles');
  for (const evidenceFile of [
    'tooling/acceptance/evidence/applets/official-applet/atelier-official-frontend-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-bridge-runtime-gate.json',
  ]) {
    if (!controlledEvidence.evidenceFiles.includes(evidenceFile)) {
      throw new Error(`viewSurface.controlledEvidence.evidenceFiles must include ${evidenceFile}`);
    }
  }
  assertStringArray(controlledEvidence.coveredStatuses, 'viewSurface.controlledEvidence.coveredStatuses');
  if (JSON.stringify(controlledEvidence.coveredStatuses) !== JSON.stringify(viewSurface.statuses)) {
    throw new Error('viewSurface.controlledEvidence.coveredStatuses must match viewSurface.statuses');
  }
  assertStringArray(controlledEvidence.centeredStates, 'viewSurface.controlledEvidence.centeredStates');
  if (JSON.stringify(controlledEvidence.centeredStates) !== JSON.stringify(['loading', 'empty'])) {
    throw new Error('viewSurface.controlledEvidence.centeredStates must be loading/empty');
  }
  assertStringArray(controlledEvidence.typedRecoveryKinds, 'viewSurface.controlledEvidence.typedRecoveryKinds');
  if (JSON.stringify(controlledEvidence.typedRecoveryKinds) !== JSON.stringify(viewSurface.typedRecoveryKinds)) {
    throw new Error('viewSurface.controlledEvidence.typedRecoveryKinds must match viewSurface.typedRecoveryKinds');
  }
  assertStringArray(controlledEvidence.statusNoticeKinds, 'viewSurface.controlledEvidence.statusNoticeKinds');
  if (JSON.stringify(controlledEvidence.statusNoticeKinds) !== JSON.stringify(viewSurface.statusNoticeKinds)) {
    throw new Error('viewSurface.controlledEvidence.statusNoticeKinds must match viewSurface.statusNoticeKinds');
  }
  if (controlledEvidence.structuredErrorCodeTaxonomy !== 'bridgeRuntimeRecoveryCodeKindByCode') {
    throw new Error('viewSurface.controlledEvidence.structuredErrorCodeTaxonomy must be bridgeRuntimeRecoveryCodeKindByCode');
  }
  if (controlledEvidence.pageSurfaceMatrix !== 'officialPageSurfaceMatrix') {
    throw new Error('viewSurface.controlledEvidence.pageSurfaceMatrix must be officialPageSurfaceMatrix');
  }
  if (controlledEvidence.prototypeStatusScenarioMatrix !== 'prototypeStatusScenarioCopyByStatus') {
    throw new Error('viewSurface.controlledEvidence.prototypeStatusScenarioMatrix must be prototypeStatusScenarioCopyByStatus');
  }
  if (controlledEvidence.realHostStationFailureMatrixProven !== false) {
    throw new Error('viewSurface.controlledEvidence.realHostStationFailureMatrixProven must be false');
  }
}

function validateRecoveryLabelKeyByKind(labelKeyByKind, recoveryKinds) {
  if (!isRecord(labelKeyByKind)) {
    throw new Error('viewSurface.recovery.labelKeyByKind must be an object');
  }
  if (JSON.stringify(Object.keys(labelKeyByKind)) !== JSON.stringify(recoveryKinds)) {
    throw new Error('viewSurface.recovery.labelKeyByKind keys must match recovery.kinds');
  }
  for (const kind of recoveryKinds) {
    const label = labelKeyByKind[kind];
    if (!isRecord(label)) {
      throw new Error(`viewSurface.recovery.labelKeyByKind.${kind} must be an object`);
    }
    assertString(label.titleKey, `viewSurface.recovery.labelKeyByKind.${kind}.titleKey`);
    if (Object.hasOwn(label, 'detailKey')) {
      assertString(label.detailKey, `viewSurface.recovery.labelKeyByKind.${kind}.detailKey`);
    }
  }
}

function validateLabelKeyByStatus(labelKeyByStatus, statuses, fieldName) {
  if (!isRecord(labelKeyByStatus)) {
    throw new Error(`${fieldName} must be an object`);
  }
  if (JSON.stringify(Object.keys(labelKeyByStatus)) !== JSON.stringify(statuses)) {
    throw new Error(`${fieldName} keys must match status keys`);
  }
  for (const status of statuses) {
    const label = labelKeyByStatus[status];
    if (!isRecord(label)) {
      throw new Error(`${fieldName}.${status} must be an object`);
    }
    assertString(label.titleKey, `${fieldName}.${status}.titleKey`);
    assertString(label.detailKey, `${fieldName}.${status}.detailKey`);
  }
}

function validatePrototypeStatusScenarioCopyByStatus(copyByStatus, statuses) {
  if (!isRecord(copyByStatus)) {
    throw new Error('viewSurface.prototypeStatusScenarioCopyByStatus must be an object');
  }
  if (JSON.stringify(Object.keys(copyByStatus)) !== JSON.stringify(statuses)) {
    throw new Error('viewSurface.prototypeStatusScenarioCopyByStatus keys must match viewSurface.statuses');
  }
  for (const status of statuses) {
    const copy = copyByStatus[status];
    if (!isRecord(copy)) {
      throw new Error(`viewSurface.prototypeStatusScenarioCopyByStatus.${status} must be an object`);
    }
    assertString(copy.title, `viewSurface.prototypeStatusScenarioCopyByStatus.${status}.title`);
    assertString(copy.detail, `viewSurface.prototypeStatusScenarioCopyByStatus.${status}.detail`);
  }
}

function validateCopyByKind(copyByKind, kinds, fieldName) {
  if (!isRecord(copyByKind)) {
    throw new Error(`${fieldName} must be an object`);
  }
  if (JSON.stringify(Object.keys(copyByKind)) !== JSON.stringify(kinds)) {
    throw new Error(`${fieldName} keys must match expected kinds`);
  }
  for (const kind of kinds) {
    const copy = copyByKind[kind];
    if (!isRecord(copy)) {
      throw new Error(`${fieldName}.${kind} must be an object`);
    }
    assertString(copy.title, `${fieldName}.${kind}.title`);
    assertString(copy.detail, `${fieldName}.${kind}.detail`);
  }
}

function validateBridgeRuntimeRecoveryCodeKindByCode(codeKindByCode) {
  if (!isRecord(codeKindByCode)) {
    throw new Error('viewSurface.bridgeRuntimeRecoveryCodeKindByCode must be an object');
  }
  const expected = {
    PERMISSION_DENIED: 'auth-denied',
    UNAUTHORIZED: 'auth-denied',
    FORBIDDEN: 'auth-denied',
    AUTH_DENIED: 'auth-denied',
    NETWORK_DISCONNECTED: 'disconnected',
    NETWORK_ERROR: 'disconnected',
    TIMEOUT: 'disconnected',
    STREAM_DISCONNECTED: 'disconnected',
    CONNECTION_CLOSED: 'disconnected',
    CAPABILITY_FAILED: 'error',
    INVALID_PROJECTION: 'error',
    UNKNOWN: 'error',
  };
  if (JSON.stringify(codeKindByCode) !== JSON.stringify(expected)) {
    throw new Error('viewSurface.bridgeRuntimeRecoveryCodeKindByCode must match the canonical bridge runtime error-code recovery taxonomy');
  }
}

function validateProjectSurface(projectSurface) {
  if (!isRecord(projectSurface)) {
    throw new Error('projectSurface must be an object');
  }
  for (const field of [
    'blockerSeverities',
    'blockerStates',
    'residualRiskStates',
    'dependencyEdgeTypes',
    'taskGraphParallelPolicies',
    'projectStates',
    'milestoneStates',
    'taskGraphNodeStates',
    'memoryCandidateTypes',
    'memoryCandidateScopes',
    'memoryCandidateFeeds',
    'policyRuleScopes',
    'defectSources',
    'defectStates',
  ]) {
    assertStringArray(projectSurface[field], `projectSurface.${field}`);
  }
  if (!isRecord(projectSurface.projectionDisplayLimits)) {
    throw new Error('projectSurface.projectionDisplayLimits must be an object');
  }
  for (const field of [
    'projectHealthItems',
    'projectHealthMilestones',
    'milestoneRefs',
    'taskGraphNodes',
    'taskGraphRootIds',
    'taskGraphEdges',
    'taskGraphNodeRefs',
    'legacyTodos',
    'providerCapabilities',
    'negotiationVoices',
    'diffPaths',
    'contextFileRefs',
    'contextOtherRefs',
    'sidePanelArtifacts',
    'artifactPaths',
    'safeTextPreviewLines',
    'gateItems',
    'gateChecks',
    'gateArtifactRefs',
  ]) {
    const value = projectSurface.projectionDisplayLimits[field];
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`projectSurface.projectionDisplayLimits.${field} must be a positive integer`);
    }
  }
  validateProjectSurfaceControlledEvidence(projectSurface);
}

function validateProjectSurfaceControlledEvidence(projectSurface) {
  const controlledEvidence = projectSurface.controlledEvidence;
  if (!isRecord(controlledEvidence)) {
    throw new Error('projectSurface.controlledEvidence must describe controlled project surface taxonomy evidence');
  }
  if (controlledEvidence.readiness !== 'controlled_local_upstream') {
    throw new Error('projectSurface.controlledEvidence.readiness must be controlled_local_upstream');
  }
  if (controlledEvidence.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error('projectSurface.controlledEvidence.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM');
  }
  const expectedGates = ['atelier:projection-contract-gate', 'atelier:official-frontend-gate', 'atelier:bridge-runtime-gate'];
  assertStringArray(controlledEvidence.gates, 'projectSurface.controlledEvidence.gates');
  if (JSON.stringify(controlledEvidence.gates) !== JSON.stringify(expectedGates)) {
    throw new Error('projectSurface.controlledEvidence.gates must match controlled project surface taxonomy gates');
  }
  const expectedEvidenceFiles = [
    'tooling/acceptance/evidence/applets/official-applet/atelier-official-frontend-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-bridge-runtime-gate.json',
  ];
  assertStringArray(controlledEvidence.evidenceFiles, 'projectSurface.controlledEvidence.evidenceFiles');
  if (JSON.stringify(controlledEvidence.evidenceFiles) !== JSON.stringify(expectedEvidenceFiles)) {
    throw new Error('projectSurface.controlledEvidence.evidenceFiles must match controlled project surface taxonomy evidence files');
  }
  if (controlledEvidence.surfaceId !== 'projectSurface') {
    throw new Error('projectSurface.controlledEvidence.surfaceId must be projectSurface');
  }
  if (controlledEvidence.surfaceRole !== 'applet_read_only_projection_taxonomy') {
    throw new Error('projectSurface.controlledEvidence.surfaceRole must be applet_read_only_projection_taxonomy');
  }
  if (controlledEvidence.sourceOfTruth !== 'station_projection_contract') {
    throw new Error('projectSurface.controlledEvidence.sourceOfTruth must be station_projection_contract');
  }
  for (const field of [
    'blockerSeverities',
    'blockerStates',
    'residualRiskStates',
    'dependencyEdgeTypes',
    'taskGraphParallelPolicies',
    'projectStates',
    'milestoneStates',
    'taskGraphNodeStates',
    'memoryCandidateTypes',
    'memoryCandidateScopes',
    'memoryCandidateFeeds',
    'policyRuleScopes',
    'defectSources',
    'defectStates',
    'projectionDisplayLimits',
  ]) {
    if (JSON.stringify(controlledEvidence[field]) !== JSON.stringify(projectSurface[field])) {
      throw new Error(`projectSurface.controlledEvidence.${field} must match projectSurface.${field}`);
    }
  }
  const expectedDisplaySurfaces = ['project_health', 'task_graph'];
  assertStringArray(controlledEvidence.displaySurfaces, 'projectSurface.controlledEvidence.displaySurfaces');
  if (JSON.stringify(controlledEvidence.displaySurfaces) !== JSON.stringify(expectedDisplaySurfaces)) {
    throw new Error('projectSurface.controlledEvidence.displaySurfaces must match controlled project projection surfaces');
  }
  for (const [field, expected] of Object.entries({
    generatedTaxonomyProven: true,
    officialProjectionGuardProven: true,
    prototypeProjectionGuardProven: true,
    displayLimitConsumptionProven: true,
    projectHealthReadOnlyBoundaryProven: true,
    taskGraphReadOnlyBoundaryProven: true,
    memoryCandidateProjectionGuardProven: true,
    policyDefectProjectionGuardProven: true,
    appletProjectMutationExposed: false,
    appletTaskGraphMutationExposed: false,
    appletMemoryWriteExposed: false,
    appletPolicyOverrideExposed: false,
    appletDefectLifecycleMutationExposed: false,
    realProjectStateMachineProven: false,
    realTaskGraphProductionRuntimeProven: false,
    realMemoryWriteE2EProven: false,
    realPolicyEngineProven: false,
    realDefectGovernanceLifecycleProven: false,
    realHostStationAppletE2EProven: false,
  })) {
    if (controlledEvidence[field] !== expected) {
      throw new Error(`projectSurface.controlledEvidence.${field} must be ${expected}`);
    }
  }
}

function validateWorkbenchSurface(workbenchSurface) {
  if (!isRecord(workbenchSurface)) {
    throw new Error('workbenchSurface must be an object');
  }
  for (const field of [
    'taskIntentPresets',
    'todoStatuses',
    'contextFileGroups',
    'artifactKinds',
    'artifactBodyKinds',
    'gateStatuses',
    'gateCheckStatuses',
  ]) {
    assertStringArray(workbenchSurface[field], `workbenchSurface.${field}`);
  }
  assertString(workbenchSurface.defaultTaskIntentPreset, 'workbenchSurface.defaultTaskIntentPreset');
  if (!workbenchSurface.taskIntentPresets.includes(workbenchSurface.defaultTaskIntentPreset)) {
    throw new Error('workbenchSurface.defaultTaskIntentPreset must be one of taskIntentPresets');
  }
  assertString(workbenchSurface.defaultContextFileGroup, 'workbenchSurface.defaultContextFileGroup');
  if (!workbenchSurface.contextFileGroups.includes(workbenchSurface.defaultContextFileGroup)) {
    throw new Error('workbenchSurface.defaultContextFileGroup must be one of contextFileGroups');
  }
  if (!Array.isArray(workbenchSurface.taskOrganizerModes)) {
    throw new Error('workbenchSurface.taskOrganizerModes must be an array');
  }
  const expectedOrganizerModes = ['folders', 'flat-list', 'kanban', 'dag'];
  const actualOrganizerModes = [];
  for (const [index, mode] of workbenchSurface.taskOrganizerModes.entries()) {
    if (!isRecord(mode)) {
      throw new Error(`workbenchSurface.taskOrganizerModes.${index} must be an object`);
    }
    assertString(mode.id, `workbenchSurface.taskOrganizerModes.${index}.id`);
    if (typeof mode.ready !== 'boolean') {
      throw new Error(`workbenchSurface.taskOrganizerModes.${index}.ready must be a boolean`);
    }
    actualOrganizerModes.push(mode.id);
  }
  if (JSON.stringify(actualOrganizerModes) !== JSON.stringify(expectedOrganizerModes)) {
    throw new Error('workbenchSurface.taskOrganizerModes must be folders, flat-list, kanban, dag');
  }
  const readyOrganizerModes = workbenchSurface.taskOrganizerModes.filter((mode) => mode.ready).map((mode) => mode.id);
  if (JSON.stringify(readyOrganizerModes) !== JSON.stringify(['folders', 'flat-list'])) {
    throw new Error('workbenchSurface.taskOrganizerModes ready modes must be folders, flat-list');
  }
  assertString(workbenchSurface.defaultTaskOrganizerMode, 'workbenchSurface.defaultTaskOrganizerMode');
  if (!actualOrganizerModes.includes(workbenchSurface.defaultTaskOrganizerMode)) {
    throw new Error('workbenchSurface.defaultTaskOrganizerMode must be one of taskOrganizerModes ids');
  }
  validateWorkbenchSurfaceControlledEvidence(workbenchSurface);
}

function validateWorkbenchSurfaceControlledEvidence(workbenchSurface) {
  const controlledEvidence = workbenchSurface.controlledEvidence;
  if (!isRecord(controlledEvidence)) {
    throw new Error('workbenchSurface.controlledEvidence must describe controlled workbench surface taxonomy evidence');
  }
  if (controlledEvidence.readiness !== 'controlled_local_upstream') {
    throw new Error('workbenchSurface.controlledEvidence.readiness must be controlled_local_upstream');
  }
  if (controlledEvidence.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error('workbenchSurface.controlledEvidence.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM');
  }
  const expectedGates = ['atelier:projection-contract-gate', 'atelier:official-frontend-gate', 'atelier:bridge-runtime-gate'];
  assertStringArray(controlledEvidence.gates, 'workbenchSurface.controlledEvidence.gates');
  if (JSON.stringify(controlledEvidence.gates) !== JSON.stringify(expectedGates)) {
    throw new Error('workbenchSurface.controlledEvidence.gates must match controlled workbench taxonomy gates');
  }
  const expectedEvidenceFiles = [
    'tooling/acceptance/evidence/applets/official-applet/atelier-official-frontend-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-bridge-runtime-gate.json',
  ];
  assertStringArray(controlledEvidence.evidenceFiles, 'workbenchSurface.controlledEvidence.evidenceFiles');
  if (JSON.stringify(controlledEvidence.evidenceFiles) !== JSON.stringify(expectedEvidenceFiles)) {
    throw new Error('workbenchSurface.controlledEvidence.evidenceFiles must match controlled workbench taxonomy evidence files');
  }
  if (controlledEvidence.surfaceId !== 'workbenchSurface') {
    throw new Error('workbenchSurface.controlledEvidence.surfaceId must be workbenchSurface');
  }
  if (controlledEvidence.surfaceRole !== 'applet_projection_surface') {
    throw new Error('workbenchSurface.controlledEvidence.surfaceRole must be applet_projection_surface');
  }
  if (controlledEvidence.sourceOfTruth !== 'station_projection_contract') {
    throw new Error('workbenchSurface.controlledEvidence.sourceOfTruth must be station_projection_contract');
  }
  for (const field of [
    'taskIntentPresets',
    'defaultTaskIntentPreset',
    'todoStatuses',
    'contextFileGroups',
    'defaultContextFileGroup',
    'taskOrganizerModes',
    'defaultTaskOrganizerMode',
    'artifactKinds',
    'artifactBodyKinds',
    'gateStatuses',
    'gateCheckStatuses',
  ]) {
    if (JSON.stringify(controlledEvidence[field]) !== JSON.stringify(workbenchSurface[field])) {
      throw new Error(`workbenchSurface.controlledEvidence.${field} must match workbenchSurface.${field}`);
    }
  }
  for (const [field, expected] of Object.entries({
    generatedTaxonomyProven: true,
    officialGeneratedConsumptionProven: true,
    prototypeGeneratedConsumptionProven: true,
    readyOrganizerModesProven: true,
    disabledOrganizerModesExecutionForbidden: true,
    artifactBodyKindAllowlistFeedsBodyFetch: true,
    gateStatusTaxonomyGenerated: true,
    appletOrganizerExecutionExposed: false,
    appletArtifactBodyKindOverrideExposed: false,
    realKanbanDagRuntimeProven: false,
    realArtifactRendererRuntimeProven: false,
    realHostStationAppletE2EProven: false,
  })) {
    if (controlledEvidence[field] !== expected) {
      throw new Error(`workbenchSurface.controlledEvidence.${field} must be ${expected}`);
    }
  }
}

function validateBudgetSurface(budgetSurface) {
  if (!isRecord(budgetSurface)) {
    throw new Error('budgetSurface must be an object');
  }
  assertStringArray(budgetSurface.budgetStatuses, 'budgetSurface.budgetStatuses');
  const requiredStatuses = ['ok', 'warning', 'danger', 'blocked'];
  if (JSON.stringify(budgetSurface.budgetStatuses) !== JSON.stringify(requiredStatuses)) {
    throw new Error('budgetSurface.budgetStatuses must be ok, warning, danger, blocked');
  }
  validateBudgetSurfaceControlledEvidence(budgetSurface);
}

function validateBudgetSurfaceControlledEvidence(budgetSurface) {
  const controlledEvidence = budgetSurface.controlledEvidence;
  if (!isRecord(controlledEvidence)) {
    throw new Error('budgetSurface.controlledEvidence must describe controlled budget projection evidence');
  }
  if (controlledEvidence.readiness !== 'controlled_local_upstream') {
    throw new Error('budgetSurface.controlledEvidence.readiness must be controlled_local_upstream');
  }
  if (controlledEvidence.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error('budgetSurface.controlledEvidence.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM');
  }
  const expectedGates = [
    'atelier:official-frontend-gate',
    'atelier:bridge-runtime-gate',
    'atelier:budget-surface-controlled-gate',
  ];
  assertStringArray(controlledEvidence.gates, 'budgetSurface.controlledEvidence.gates');
  if (JSON.stringify(controlledEvidence.gates) !== JSON.stringify(expectedGates)) {
    throw new Error('budgetSurface.controlledEvidence.gates must match the controlled budget projection evidence gates');
  }
  const expectedEvidenceFiles = [
    'tooling/acceptance/evidence/applets/official-applet/atelier-official-frontend-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-bridge-runtime-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-budget-surface-controlled-gate.json',
  ];
  assertStringArray(controlledEvidence.evidenceFiles, 'budgetSurface.controlledEvidence.evidenceFiles');
  if (JSON.stringify(controlledEvidence.evidenceFiles) !== JSON.stringify(expectedEvidenceFiles)) {
    throw new Error('budgetSurface.controlledEvidence.evidenceFiles must match the official budget projection evidence files');
  }
  if (controlledEvidence.descriptorField !== 'workspace.budget') {
    throw new Error('budgetSurface.controlledEvidence.descriptorField must be workspace.budget');
  }
  assertStringArray(controlledEvidence.coveredStatuses, 'budgetSurface.controlledEvidence.coveredStatuses');
  if (JSON.stringify(controlledEvidence.coveredStatuses) !== JSON.stringify(budgetSurface.budgetStatuses)) {
    throw new Error('budgetSurface.controlledEvidence.coveredStatuses must match budgetSurface.budgetStatuses');
  }
  if (controlledEvidence.generatedTaxonomy !== 'ATELIER_BUDGET_STATUSES') {
    throw new Error('budgetSurface.controlledEvidence.generatedTaxonomy must be ATELIER_BUDGET_STATUSES');
  }
  if (controlledEvidence.officialGuard !== 'isAtelierBudgetProjection') {
    throw new Error('budgetSurface.controlledEvidence.officialGuard must be isAtelierBudgetProjection');
  }
  if (controlledEvidence.prototypeGuard !== 'isBudgetProjection') {
    throw new Error('budgetSurface.controlledEvidence.prototypeGuard must be isBudgetProjection');
  }
  for (const [field, expected] of Object.entries({
    readOnlyProjection: true,
    appletBudgetWriteExposed: false,
    stationAggregationProven: true,
    providerBillingReconciliationProven: true,
    budgetCircuitBreakerProven: true,
    decisionCardRecoveryProven: true,
    realHostStationAppletE2EProven: false,
  })) {
    if (controlledEvidence[field] !== expected) {
      throw new Error(`budgetSurface.controlledEvidence.${field} must be ${expected}`);
    }
  }
}

function validateTaskLifecycle(taskLifecycle, methodPayloads, methodIntents, methodTransports) {
  if (!isRecord(taskLifecycle)) {
    throw new Error('taskLifecycle must be an object');
  }
  assertString(taskLifecycle.field, 'taskLifecycle.field');
  if (taskLifecycle.field !== 'status') {
    throw new Error('taskLifecycle.field must be status');
  }
  assertString(taskLifecycle.domain, 'taskLifecycle.domain');
  if (taskLifecycle.domain !== 'workbench_lifecycle') {
    throw new Error('taskLifecycle.domain must be workbench_lifecycle');
  }
  assertString(taskLifecycle.orthogonalTo, 'taskLifecycle.orthogonalTo');
  if (taskLifecycle.orthogonalTo !== 'execution_state') {
    throw new Error('taskLifecycle.orthogonalTo must be execution_state');
  }
  assertStringArray(taskLifecycle.states, 'taskLifecycle.states');
  const requiredStates = ['active', 'archived', 'deleted'];
  if (JSON.stringify(taskLifecycle.states) !== JSON.stringify(requiredStates)) {
    throw new Error('taskLifecycle.states must be active, archived, deleted');
  }
  if (!Array.isArray(taskLifecycle.transitions) || taskLifecycle.transitions.length === 0) {
    throw new Error('taskLifecycle.transitions must be a non-empty array');
  }
  for (const [index, transition] of taskLifecycle.transitions.entries()) {
    if (!isRecord(transition)) {
      throw new Error(`taskLifecycle.transitions.${index} must be an object`);
    }
    if (!taskLifecycle.states.includes(transition.from)) {
      throw new Error(`taskLifecycle.transitions.${index}.from must be a taskLifecycle state`);
    }
    if (!taskLifecycle.states.includes(transition.to)) {
      throw new Error(`taskLifecycle.transitions.${index}.to must be a taskLifecycle state`);
    }
    if (transition.reversible !== true) {
      throw new Error(`taskLifecycle.transitions.${index}.reversible must be true`);
    }
  }
  assertString(taskLifecycle.purgeRequiresStatus, 'taskLifecycle.purgeRequiresStatus');
  if (taskLifecycle.purgeRequiresStatus !== 'deleted') {
    throw new Error('taskLifecycle.purgeRequiresStatus must be deleted');
  }
  assertStringArray(taskLifecycle.forbiddenExecutionStatusValues, 'taskLifecycle.forbiddenExecutionStatusValues');

  const setStatusPayload = methodPayloads['atelier.task.setStatus'];
  if (!isRecord(setStatusPayload)) {
    throw new Error('methodPayloads.atelier.task.setStatus must be an object');
  }
  assertStringArray(setStatusPayload.allowedStatus, 'methodPayloads.atelier.task.setStatus.allowedStatus');
  if (JSON.stringify(setStatusPayload.allowedStatus) !== JSON.stringify(taskLifecycle.states)) {
    throw new Error('methodPayloads.atelier.task.setStatus.allowedStatus must match taskLifecycle.states');
  }
  validateTaskSetStatusControlledEvidence(
    setStatusPayload,
    methodIntents['atelier.task.setStatus'],
    methodTransports['atelier.task.setStatus'],
    taskLifecycle,
  );

  const purgePayload = methodPayloads['atelier.task.purge'];
  if (!isRecord(purgePayload)) {
    throw new Error('methodPayloads.atelier.task.purge must be an object');
  }
  assertString(purgePayload.requiresStatus, 'methodPayloads.atelier.task.purge.requiresStatus');
  if (purgePayload.requiresStatus !== taskLifecycle.purgeRequiresStatus) {
    throw new Error('methodPayloads.atelier.task.purge.requiresStatus must match taskLifecycle.purgeRequiresStatus');
  }
  validateTaskPurgeControlledEvidence(
    purgePayload,
    methodIntents['atelier.task.purge'],
    methodTransports['atelier.task.purge'],
    taskLifecycle,
  );
  validateTaskLifecycleControlledEvidence(taskLifecycle);
}

function validateTaskSetStatusControlledEvidence(payload, intent, transport, taskLifecycle) {
  const controlledEvidence = payload.controlledEvidence;
  if (!isRecord(controlledEvidence)) {
    throw new Error('methodPayloads.atelier.task.setStatus.controlledEvidence must describe controlled task lifecycle evidence');
  }
  validateTaskMethodControlledEvidenceCommon({
    method: 'atelier.task.setStatus',
    payload,
    intent,
    transport,
    controlledEvidence,
    requiredFields: ['taskId', 'status'],
    payloadFields: ['requiredFields', 'allowedStatus', 'forbiddenActions'],
    expectedGates: ['atelier:projection-contract-gate', 'atelier:official-frontend-gate', 'atelier:bridge-runtime-gate'],
    expectedEvidenceFiles: [
      'tooling/acceptance/evidence/applets/official-applet/atelier-official-frontend-gate.json',
      'tooling/acceptance/evidence/applets/official-applet/atelier-bridge-runtime-gate.json',
    ],
  });
  if (JSON.stringify(payload.allowedStatus) !== JSON.stringify(taskLifecycle.states)) {
    throw new Error('methodPayloads.atelier.task.setStatus.allowedStatus must match taskLifecycle.states');
  }
  for (const [field, expected] of Object.entries({
    officialLifecycleGuardProven: true,
    prototypeLifecycleGuardProven: true,
    serviceBindingGuardProven: true,
    statusTaxonomyGuardProven: true,
    taskLifecycleMetadataGuardProven: true,
    archiveDeleteRestoreGuardProven: true,
    appletTaskExecutionExposed: false,
    appletProviderInvokeExposed: false,
    appletRuntimeExecuteExposed: false,
    appletTaskGraphMutationExposed: false,
    appletMemoryWriteExposed: false,
    appletInputSnapshotWriteExposed: false,
    realLifecyclePersistenceE2EProven: false,
    realHostStationAppletE2EProven: false,
  })) {
    if (controlledEvidence[field] !== expected) {
      throw new Error(`methodPayloads.atelier.task.setStatus.controlledEvidence.${field} must be ${expected}`);
    }
  }
}

function validateTaskPurgeControlledEvidence(payload, intent, transport, taskLifecycle) {
  const controlledEvidence = payload.controlledEvidence;
  if (!isRecord(controlledEvidence)) {
    throw new Error('methodPayloads.atelier.task.purge.controlledEvidence must describe controlled task purge evidence');
  }
  validateTaskMethodControlledEvidenceCommon({
    method: 'atelier.task.purge',
    payload,
    intent,
    transport,
    controlledEvidence,
    requiredFields: ['taskId'],
    payloadFields: ['requiredFields', 'requiresStatus', 'forbiddenActions'],
    expectedGates: ['atelier:projection-contract-gate', 'atelier:official-frontend-gate', 'atelier:bridge-runtime-gate'],
    expectedEvidenceFiles: [
      'tooling/acceptance/evidence/applets/official-applet/atelier-official-frontend-gate.json',
      'tooling/acceptance/evidence/applets/official-applet/atelier-bridge-runtime-gate.json',
    ],
  });
  if (payload.requiresStatus !== taskLifecycle.purgeRequiresStatus) {
    throw new Error('methodPayloads.atelier.task.purge.requiresStatus must match taskLifecycle.purgeRequiresStatus');
  }
  for (const [field, expected] of Object.entries({
    officialPurgeConfirmationGuardProven: true,
    prototypePurgeConfirmationGuardProven: true,
    serviceBindingGuardProven: true,
    requiresDeletedGuardProven: true,
    durableIndexCleanupGuardProven: true,
    taskLifecycleMetadataGuardProven: true,
    appletTaskExecutionExposed: false,
    appletProviderInvokeExposed: false,
    appletRuntimeExecuteExposed: false,
    appletTaskGraphMutationExposed: false,
    appletMemoryWriteExposed: false,
    appletInputSnapshotWriteExposed: false,
    realPurgeE2EProven: false,
    realHostStationAppletE2EProven: false,
  })) {
    if (controlledEvidence[field] !== expected) {
      throw new Error(`methodPayloads.atelier.task.purge.controlledEvidence.${field} must be ${expected}`);
    }
  }
}

function validateTaskMethodControlledEvidenceCommon({
  method,
  payload,
  intent,
  transport,
  controlledEvidence,
  requiredFields,
  payloadFields,
  expectedGates,
  expectedEvidenceFiles,
}) {
  if (!isRecord(intent)) {
    throw new Error(`methodIntents.${method} must be an object`);
  }
  if (!isRecord(transport)) {
    throw new Error(`methodTransports.${method} must be an object`);
  }
  if (controlledEvidence.readiness !== 'controlled_local_upstream') {
    throw new Error(`methodPayloads.${method}.controlledEvidence.readiness must be controlled_local_upstream`);
  }
  if (controlledEvidence.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error(`methodPayloads.${method}.controlledEvidence.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM`);
  }
  assertStringArray(payload.requiredFields, `methodPayloads.${method}.requiredFields`);
  if (JSON.stringify(payload.requiredFields) !== JSON.stringify(requiredFields)) {
    throw new Error(`methodPayloads.${method}.requiredFields must match expected fields`);
  }
  assertStringArray(payload.forbiddenActions, `methodPayloads.${method}.forbiddenActions`);
  const expectedForbiddenActions = [
    'execute',
    'run',
    'provider.invoke',
    'runtime.execute',
    'taskGraph.execute',
    'taskGraph.diff.apply',
    'memory.write',
    'input_snapshot.write',
    'inputSnapshot.write',
  ];
  if (JSON.stringify(payload.forbiddenActions) !== JSON.stringify(expectedForbiddenActions)) {
    throw new Error(`methodPayloads.${method}.forbiddenActions must match task lifecycle forbidden actions`);
  }
  assertStringArray(controlledEvidence.gates, `methodPayloads.${method}.controlledEvidence.gates`);
  if (JSON.stringify(controlledEvidence.gates) !== JSON.stringify(expectedGates)) {
    throw new Error(`methodPayloads.${method}.controlledEvidence.gates must match task lifecycle evidence gates`);
  }
  assertStringArray(controlledEvidence.evidenceFiles, `methodPayloads.${method}.controlledEvidence.evidenceFiles`);
  if (JSON.stringify(controlledEvidence.evidenceFiles) !== JSON.stringify(expectedEvidenceFiles)) {
    throw new Error(`methodPayloads.${method}.controlledEvidence.evidenceFiles must match task lifecycle evidence files`);
  }
  if (controlledEvidence.method !== method) {
    throw new Error(`methodPayloads.${method}.controlledEvidence.method must be ${method}`);
  }
  for (const field of ['intentOwner', 'intentKind', 'sideEffectClass', 'executionForbidden']) {
    if (controlledEvidence[field] !== intent[field]) {
      throw new Error(`methodPayloads.${method}.controlledEvidence.${field} must match methodIntents.${method}.${field}`);
    }
  }
  for (const field of ['transportKind', 'frontendCall', 'service', 'httpMethod', 'publicPath', 'stationPath', 'stationHandler', 'desktopGateway']) {
    if (controlledEvidence[field] !== transport[field]) {
      throw new Error(`methodPayloads.${method}.controlledEvidence.${field} must match methodTransports.${method}.${field}`);
    }
  }
  for (const field of payloadFields) {
    if (JSON.stringify(controlledEvidence[field]) !== JSON.stringify(payload[field])) {
      throw new Error(`methodPayloads.${method}.controlledEvidence.${field} must match payload.${field}`);
    }
  }
}

function validateTaskLifecycleControlledEvidence(taskLifecycle) {
  const controlledEvidence = taskLifecycle.controlledEvidence;
  if (!isRecord(controlledEvidence)) {
    throw new Error('taskLifecycle.controlledEvidence must describe controlled lifecycle evidence');
  }
  if (controlledEvidence.readiness !== 'controlled_local_upstream') {
    throw new Error('taskLifecycle.controlledEvidence.readiness must be controlled_local_upstream');
  }
  if (controlledEvidence.evidenceClass !== 'CONTROLLED_LOCAL_UPSTREAM') {
    throw new Error('taskLifecycle.controlledEvidence.evidenceClass must be CONTROLLED_LOCAL_UPSTREAM');
  }
  const expectedGates = ['atelier:official-frontend-gate', 'atelier:bridge-runtime-gate'];
  assertStringArray(controlledEvidence.gates, 'taskLifecycle.controlledEvidence.gates');
  if (JSON.stringify(controlledEvidence.gates) !== JSON.stringify(expectedGates)) {
    throw new Error('taskLifecycle.controlledEvidence.gates must be atelier:official-frontend-gate, atelier:bridge-runtime-gate');
  }
  const expectedEvidenceFiles = [
    'tooling/acceptance/evidence/applets/official-applet/atelier-official-frontend-gate.json',
    'tooling/acceptance/evidence/applets/official-applet/atelier-bridge-runtime-gate.json',
  ];
  assertStringArray(controlledEvidence.evidenceFiles, 'taskLifecycle.controlledEvidence.evidenceFiles');
  if (JSON.stringify(controlledEvidence.evidenceFiles) !== JSON.stringify(expectedEvidenceFiles)) {
    throw new Error('taskLifecycle.controlledEvidence.evidenceFiles must match controlled lifecycle evidence files');
  }
  for (const field of ['field', 'domain', 'orthogonalTo', 'purgeRequiresStatus']) {
    if (controlledEvidence[field] !== taskLifecycle[field]) {
      throw new Error(`taskLifecycle.controlledEvidence.${field} must match taskLifecycle.${field}`);
    }
  }
  assertStringArray(controlledEvidence.states, 'taskLifecycle.controlledEvidence.states');
  if (JSON.stringify(controlledEvidence.states) !== JSON.stringify(taskLifecycle.states)) {
    throw new Error('taskLifecycle.controlledEvidence.states must match taskLifecycle.states');
  }
  assertStringArray(controlledEvidence.forbiddenExecutionStatusValues, 'taskLifecycle.controlledEvidence.forbiddenExecutionStatusValues');
  if (JSON.stringify(controlledEvidence.forbiddenExecutionStatusValues) !== JSON.stringify(taskLifecycle.forbiddenExecutionStatusValues)) {
    throw new Error('taskLifecycle.controlledEvidence.forbiddenExecutionStatusValues must match taskLifecycle.forbiddenExecutionStatusValues');
  }
  for (const [field, expected] of Object.entries({
    setStatusMethod: 'atelier.task.setStatus',
    purgeMethod: 'atelier.task.purge',
    setStatusPayloadAllowedStatusMatchesStates: true,
    purgePayloadRequiresDeletedStatus: true,
    statusOrthogonalToExecutionState: true,
    lifecycleMenuExecutionActionsForbidden: true,
    purgeBypassForbidden: true,
    realStationTaskLifecycleE2EProven: false,
    realPurgeE2EProven: false,
    realExecutionStateTransitionProven: false,
    realHostStationAppletE2EProven: false,
  })) {
    if (controlledEvidence[field] !== expected) {
      throw new Error(`taskLifecycle.controlledEvidence.${field} must be ${expected}`);
    }
  }
}

function validateMethodIntents(methods, methodIntents) {
  if (!isRecord(methodIntents)) {
    throw new Error('methodIntents must be an object');
  }
  const allowedOwners = new Set(['station', 'desktop_host']);
  const allowedSideEffects = new Set(['none', 'host_ui', 'station_transaction']);
  for (const method of methods) {
    const intent = methodIntents[method];
    if (!isRecord(intent)) {
      throw new Error(`methodIntents.${method} must be an object`);
    }
    if (!allowedOwners.has(intent.intentOwner)) {
      throw new Error(`methodIntents.${method}.intentOwner must be station or desktop_host`);
    }
    assertString(intent.intentKind, `methodIntents.${method}.intentKind`);
    if (!allowedSideEffects.has(intent.sideEffectClass)) {
      throw new Error(`methodIntents.${method}.sideEffectClass must be none, host_ui, or station_transaction`);
    }
    if (intent.executionForbidden !== true) {
      throw new Error(`methodIntents.${method}.executionForbidden must be true`);
    }
  }
}

function validateMethodGovernance(methodGovernance, contract) {
  if (!isRecord(methodGovernance)) {
    throw new Error('methodGovernance must be an object');
  }
  if (methodGovernance.surfaceKind !== 'applet_method_governance') {
    throw new Error('methodGovernance.surfaceKind must be applet_method_governance');
  }
  if (methodGovernance.sourceOfTruth !== 'station_projection_contract') {
    throw new Error('methodGovernance.sourceOfTruth must be station_projection_contract');
  }
  const expectedAllowedIntentOwners = ['station', 'desktop_host'];
  const expectedAllowedSideEffectClasses = ['none', 'host_ui', 'station_transaction'];
  const expectedPayloadlessMethods = ['atelier.workspace.load', contract.subscriptionMethod];
  const expectedServiceBindingMethods = contract.methods.filter((method) => contract.methodTransports[method]?.transportKind === 'service_binding');
  const expectedHostLocalMethods = contract.methods.filter((method) => contract.methodTransports[method]?.transportKind === 'desktop_gateway_host_local');
  const expectedEventSubscriptionMethods = contract.methods.filter((method) => contract.methodTransports[method]?.transportKind === 'event_subscription');
  for (const [field, expected] of Object.entries({
    allowedIntentOwners: expectedAllowedIntentOwners,
    allowedSideEffectClasses: expectedAllowedSideEffectClasses,
    serviceBindingMethods: expectedServiceBindingMethods,
    hostLocalMethods: expectedHostLocalMethods,
    eventSubscriptionMethods: expectedEventSubscriptionMethods,
    payloadlessMethods: expectedPayloadlessMethods,
    forbiddenExecutionActions: [
      'provider.invoke',
      'runtime.execute',
      'model.run',
      'cli.execute',
      'shell.execute',
      'gate.run',
      'artifact.write',
      'memory.write',
      'input_snapshot.write',
      'inputSnapshot.write',
      'HostStorage.write',
    ],
  })) {
    assertStringArray(methodGovernance[field], `methodGovernance.${field}`);
    if (JSON.stringify(methodGovernance[field]) !== JSON.stringify(expected)) {
      throw new Error(`methodGovernance.${field} must match generated method governance matrix`);
    }
  }
  for (const method of contract.methods) {
    if (!contract.methodIntents[method]?.executionForbidden) {
      throw new Error(`methodGovernance requires methodIntents.${method}.executionForbidden to be true`);
    }
  }
  if (JSON.stringify(Object.keys(contract.methodIntents)) !== JSON.stringify(contract.methods)) {
    throw new Error('methodGovernance requires methodIntents keys to match methods order');
  }
  if (JSON.stringify(Object.keys(contract.methodTransports)) !== JSON.stringify(contract.methods)) {
    throw new Error('methodGovernance requires methodTransports keys to match methods order');
  }
  const expectedPayloadKeys = contract.methods.filter((method) => !expectedPayloadlessMethods.includes(method));
  if (JSON.stringify(Object.keys(contract.methodPayloads)) !== JSON.stringify(expectedPayloadKeys)) {
    throw new Error('methodGovernance requires methodPayloads keys to exclude only payloadless methods');
  }
  const controlledEvidence = methodGovernance.controlledEvidence;
  if (!isRecord(controlledEvidence)) {
    throw new Error('methodGovernance.controlledEvidence must describe controlled method governance evidence');
  }
  const expectedControlledEvidence = {
    readiness: 'controlled_local_upstream',
    evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    gates: ['atelier:projection-contract-gate', 'atelier:official-frontend-gate', 'atelier:bridge-runtime-gate'],
    evidenceFiles: [
      'tooling/acceptance/evidence/applets/official-applet/atelier-projection-contract-gate.json',
      'tooling/acceptance/evidence/applets/official-applet/atelier-official-frontend-gate.json',
      'tooling/acceptance/evidence/applets/official-applet/atelier-bridge-runtime-gate.json',
    ],
    methodKeysMatchMethods: true,
    runtimeMethodsExcludeEventSubscription: true,
    intentKeysMatchMethods: true,
    transportKeysMatchMethods: true,
    payloadKeysExcludePayloadlessMethods: true,
    allMethodsExecutionForbidden: true,
    serviceBindingUsesHostGateway: true,
    hostLocalLimitedToUiIntent: true,
    eventSubscriptionTransportBoundToProjectionTopic: true,
    generatedIntentMetadataExportProven: true,
    exactTransportMatrixGateProven: true,
    appletProviderInvokeExposed: false,
    appletRuntimeExecuteExposed: false,
    appletModelRunExposed: false,
    appletShellExecuteExposed: false,
    appletGateRunExposed: false,
    appletArtifactWriteExposed: false,
    appletMemoryWriteExposed: false,
    appletInputSnapshotWriteExposed: false,
    appletHostStorageWriteExposed: false,
    realProviderRuntimeProven: false,
    realGateRuntimeProven: false,
    realArtifactMutationRuntimeProven: false,
    realMemoryWriteE2EProven: false,
    realHostStationAppletE2EProven: false,
  };
  if (JSON.stringify(controlledEvidence) !== JSON.stringify(expectedControlledEvidence)) {
    throw new Error('methodGovernance.controlledEvidence must exactly describe controlled method governance evidence boundaries');
  }
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new Error(`${label} must be a string array`);
  }
}

function validateStatusMap(value, statuses, label) {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  for (const status of statuses) {
    assertString(value[status], `${label}.${status}`);
  }
}

function validateStringMap(value, allowedValues, label) {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  for (const [key, mapValue] of Object.entries(value)) {
    assertString(mapValue, `${label}.${key}`);
    if (!allowedValues.has(mapValue)) {
      throw new Error(`${label}.${key} must be one of ${Array.from(allowedValues).join(', ')}`);
    }
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
