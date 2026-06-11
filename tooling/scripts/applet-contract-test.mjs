#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  APPLET_BRIDGE_PROTOCOL,
  APPLET_CONTRACT_JSON_SCHEMA,
  CapabilityMethod,
  createInvalidSessionResponse,
  validateManifest,
} from '../../packages/applet-contract/dist/index.js';

const validManifest = {
  id: 'generic-complex-applet',
  version: '1.0.0',
  targets: ['desktop'],
  entries: { lynx: 'main.lynx.bundle' },
  load: { desktop: { type: 'lynx-web', entry: 'main.lynx.bundle' } },
  bridge: { protocol: APPLET_BRIDGE_PROTOCOL },
  permissions: [CapabilityMethod.NetworkRequest, CapabilityMethod.NetworkUpload, CapabilityMethod.NetworkDownload, CapabilityMethod.DeviceGetSafeArea, CapabilityMethod.ClipboardGetText, CapabilityMethod.FileWrite, CapabilityMethod.SkillsRegister, CapabilityMethod.SkillsList, CapabilityMethod.SkillsInvoke, CapabilityMethod.TasksStart, CapabilityMethod.AgentStartSession, CapabilityMethod.AgentStream, CapabilityMethod.AiGenerate, CapabilityMethod.AiChat, CapabilityMethod.TelemetryTrack],
  services: [{ id: 'primary-api', kind: 'http', binding: 'host-resolved', allowedMethods: ['GET', 'POST'], allowedPaths: ['/api/v1/*'], streaming: true }],
  skills: [{ id: 'generic-skill', inputSchema: 'schemas/skill.input.json', streaming: true }],
  integrity: { algorithm: 'sha256', files: { 'main.lynx.bundle': 'sha256:test', 'schemas/skill.input.json': 'sha256:test' } },
};

assert.equal(validateManifest(validManifest).valid, true);
assert.equal(validateManifest({
  ...validManifest,
  skills: [{
    id: 'agent-summary',
    inputSchema: 'schemas/skill.input.json',
    streaming: true,
    executor: { type: 'agent', request: { message: 'summarize readiness' } },
  }],
}).valid, true);
assert.equal(validateManifest({ ...validManifest, permissions: ['unknown.method'] }).valid, false);
assert.equal(validateManifest({ ...validManifest, services: [] }).valid, false);
assert.equal(validateManifest({ ...validManifest, skills: [{ id: 'generic-skill' }] }).valid, false);

const response = createInvalidSessionResponse({
  protocol: APPLET_BRIDGE_PROTOCOL,
  appletId: validManifest.id,
  sessionId: 'destroyed',
  requestId: 'request-1',
});
assert.equal(response.requestId, 'request-1');
assert.equal(response.ok, false);
assert.equal(response.error?.code, 'INVALID_SESSION');

const schema = APPLET_CONTRACT_JSON_SCHEMA;
assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
assert.equal(schema.definitions.manifest.properties.bridge.properties.protocol.const, APPLET_BRIDGE_PROTOCOL);
assert.ok(schema.definitions.capabilityMethod.enum.includes(CapabilityMethod.AiChat));
assert.ok(schema.definitions.capabilityMethod.enum.includes(CapabilityMethod.TasksCancel));
assert.ok(schema.definitions.capabilityMethod.enum.includes(CapabilityMethod.AppGetLaunchOptions));
assert.ok(schema.definitions.capabilityMethod.enum.includes(CapabilityMethod.StorageKeys));
assert.ok(schema.definitions.capabilityMethod.enum.includes(CapabilityMethod.UiSetNavigationBar));
assert.ok(schema.definitions.capabilityMethod.enum.includes(CapabilityMethod.NetworkUpload));
assert.ok(schema.definitions.capabilityMethod.enum.includes(CapabilityMethod.NetworkDownload));
assert.ok(schema.definitions.capabilityMethod.enum.includes(CapabilityMethod.DeviceGetSafeArea));
assert.ok(schema.definitions.capabilityMethod.enum.includes(CapabilityMethod.ClipboardSetText));
assert.ok(schema.definitions.capabilityMethod.enum.includes(CapabilityMethod.FileGetInfo));
assert.ok(schema.definitions.appletErrorCode.enum.includes('INVALID_SESSION'));
assert.ok(schema.definitions.bridgeInvokeResponse.allOf.length > 0);

const output = 'PASS applet contract tests\n';
const evidenceDir = path.resolve('applet-readiness-evidence/sdk');
mkdirSync(evidenceDir, { recursive: true });
writeFileSync(path.join(evidenceDir, 'contract-test-output.txt'), output);
process.stdout.write(output);
