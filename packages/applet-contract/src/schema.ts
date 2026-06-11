import { APPLET_BRIDGE_PROTOCOL, APPLET_ERROR_CODES_SCHEMA } from './bridge.js';
import { CAPABILITY_METHODS_SCHEMA } from './capability.js';

export const APPLET_CONTRACT_SCHEMA_VERSION = 'https://peers.touch/schemas/applet-contract/v1' as const;

export type JsonSchema = Record<string, unknown>;

export const APPLET_CONTRACT_JSON_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: APPLET_CONTRACT_SCHEMA_VERSION,
  title: 'Peers Touch Applet Contract',
  type: 'object',
  additionalProperties: false,
  definitions: {
    targetPlatform: {
      type: 'string',
      enum: ['desktop', 'android', 'ios', 'harmony', 'web', 'standalone'],
    },
    capabilityMethod: {
      type: 'string',
      enum: CAPABILITY_METHODS_SCHEMA,
    },
    appletErrorCode: {
      type: 'string',
      enum: APPLET_ERROR_CODES_SCHEMA,
    },
    manifest: {
      type: 'object',
      additionalProperties: true,
      required: ['id', 'version', 'targets', 'entries', 'load', 'bridge', 'permissions', 'services', 'skills', 'integrity'],
      properties: {
        id: { type: 'string', minLength: 1 },
        name: { type: 'string', minLength: 1 },
        version: { type: 'string', minLength: 1 },
        description: { type: 'string', minLength: 1 },
        author: { type: 'string', minLength: 1 },
        icon: { type: 'string', minLength: 1 },
        minPlatformVersion: { type: 'string', minLength: 1 },
        targets: {
          type: 'array',
          minItems: 1,
          items: { $ref: '#/definitions/targetPlatform' },
        },
        targetPlatforms: {
          type: 'array',
          minItems: 1,
          items: { $ref: '#/definitions/targetPlatform' },
        },
        entries: {
          type: 'object',
          additionalProperties: false,
          required: ['lynx'],
          properties: {
            lynx: { type: 'string', minLength: 1 },
            standalone: { type: 'string', minLength: 1 },
          },
        },
        load: {
          type: 'object',
          additionalProperties: false,
          properties: {
            desktop: { $ref: '#/definitions/appletEntry' },
            android: { $ref: '#/definitions/appletEntry' },
            ios: { $ref: '#/definitions/appletEntry' },
            harmony: { $ref: '#/definitions/appletEntry' },
            web: { $ref: '#/definitions/appletEntry' },
            standalone: { $ref: '#/definitions/appletEntry' },
          },
        },
        bridge: {
          type: 'object',
          additionalProperties: false,
          required: ['protocol'],
          properties: {
            protocol: { const: APPLET_BRIDGE_PROTOCOL },
            version: { type: 'string', minLength: 1 },
          },
        },
        permissions: {
          type: 'array',
          minItems: 1,
          items: { $ref: '#/definitions/capabilityMethod' },
        },
        capabilities: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
        },
        services: {
          type: 'array',
          items: { $ref: '#/definitions/appletServiceDeclaration' },
        },
        skills: {
          type: 'array',
          items: { $ref: '#/definitions/appletSkillDeclaration' },
        },
        integrity: { $ref: '#/definitions/packageIntegrity' },
      },
    },
    appletEntry: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'entry'],
      properties: {
        type: { type: 'string', enum: ['lynx-web', 'lynx-native', 'web-spa'] },
        entry: { type: 'string', minLength: 1 },
      },
    },
    appletServiceDeclaration: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'kind', 'binding', 'allowedMethods', 'allowedPaths'],
      properties: {
        id: { type: 'string', minLength: 1 },
        kind: { const: 'http' },
        binding: { type: 'string', enum: ['host-resolved', 'station-resolved', 'dev-override'] },
        allowedMethods: {
          type: 'array',
          items: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'] },
        },
        allowedPaths: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
        },
        streaming: { type: 'boolean' },
      },
    },
    appletSkillDeclaration: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'inputSchema'],
      properties: {
        id: { type: 'string', minLength: 1 },
        inputSchema: { type: 'string', minLength: 1 },
        streaming: { type: 'boolean' },
        title: { type: 'string', minLength: 1 },
        description: { type: 'string', minLength: 1 },
        display: { type: 'object' },
        executor: { $ref: '#/definitions/appletSkillExecutor' },
      },
    },
    appletSkillExecutor: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'request'],
          properties: {
            type: { const: 'network' },
            request: { $ref: '#/definitions/appletNetworkExecutorRequest' },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['type'],
          properties: {
            type: { const: 'agent' },
            request: { $ref: '#/definitions/appletAgentExecutorRequest' },
          },
        },
      ],
    },
    appletNetworkExecutorRequest: {
      type: 'object',
      additionalProperties: false,
      required: ['service', 'path'],
      properties: {
        service: { type: 'string', minLength: 1 },
        path: { type: 'string', minLength: 1 },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'] },
        headers: {
          type: 'object',
          additionalProperties: { type: 'string' },
        },
        body: {},
      },
    },
    appletAgentExecutorRequest: {
      type: 'object',
      additionalProperties: false,
      properties: {
        message: { type: 'string', minLength: 1 },
        agentSessionId: { type: 'string', minLength: 1 },
        metadata: { type: 'object' },
      },
    },
    packageIntegrity: {
      type: 'object',
      additionalProperties: false,
      required: ['algorithm', 'files'],
      properties: {
        algorithm: { const: 'sha256' },
        files: {
          type: 'object',
          minProperties: 1,
          additionalProperties: { type: 'string', minLength: 1 },
        },
      },
    },
    bridgeEnvelope: {
      type: 'object',
      additionalProperties: true,
      required: ['protocol', 'appletId', 'sessionId', 'requestId'],
      properties: {
        protocol: { const: APPLET_BRIDGE_PROTOCOL },
        appletId: { type: 'string', minLength: 1 },
        sessionId: { type: 'string', minLength: 1 },
        requestId: { type: 'string', minLength: 1 },
      },
    },
    bridgeInvokeRequest: {
      allOf: [
        { $ref: '#/definitions/bridgeEnvelope' },
        {
          type: 'object',
          required: ['kind', 'method'],
          properties: {
            kind: { const: 'invoke' },
            method: { $ref: '#/definitions/capabilityMethod' },
            params: {},
          },
        },
      ],
    },
    appletError: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message'],
      properties: {
        code: { $ref: '#/definitions/appletErrorCode' },
        message: { type: 'string', minLength: 1 },
        requestId: { type: 'string', minLength: 1 },
        details: { type: 'object' },
      },
    },
    bridgeInvokeResponse: {
      allOf: [
        { $ref: '#/definitions/bridgeEnvelope' },
        {
          type: 'object',
          required: ['kind', 'ok'],
          properties: {
            kind: { const: 'response' },
            ok: { type: 'boolean' },
            result: {},
            error: { $ref: '#/definitions/appletError' },
          },
        },
      ],
    },
    bridgeEventEnvelope: {
      allOf: [
        { $ref: '#/definitions/bridgeEnvelope' },
        {
          type: 'object',
          required: ['kind', 'event'],
          properties: {
            kind: { const: 'event' },
            event: { type: 'string', minLength: 1 },
            payload: {},
          },
        },
      ],
    },
  },
  properties: {
    manifest: { $ref: '#/definitions/manifest' },
    bridgeInvokeRequest: { $ref: '#/definitions/bridgeInvokeRequest' },
    bridgeInvokeResponse: { $ref: '#/definitions/bridgeInvokeResponse' },
    bridgeEventEnvelope: { $ref: '#/definitions/bridgeEventEnvelope' },
  },
} as const satisfies JsonSchema);

export function getAppletContractJsonSchema(): JsonSchema {
  return APPLET_CONTRACT_JSON_SCHEMA;
}
