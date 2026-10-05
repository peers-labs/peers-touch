#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
    const key = arg.slice(2);
    if (['dry-run', 'force', 'with-proto'].includes(key)) {
      options[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function requireOption(options, key) {
  const value = options[key];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required option: --${key}`);
  }
  return String(value).trim();
}

function validateAppletId(appletId) {
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(appletId)) {
    throw new Error(`Applet id must be DNS-like lowercase text: ${appletId}`);
  }
}

function validateServiceName(serviceName) {
  if (!/^[a-z][a-z0-9-]*$/.test(serviceName)) {
    throw new Error(`Service name must be lowercase kebab text: ${serviceName}`);
  }
}

function goPackageName(serviceName) {
  return serviceName.replaceAll('-', '_');
}

function writePlannedFile(filePath, content, options, plannedWrites) {
  const relativePath = path.relative(process.cwd(), filePath);
  plannedWrites.push(relativePath);
  if (options['dry-run']) return;
  mkdirSync(path.dirname(filePath), { recursive: true });
  if (existsSync(filePath) && !options.force) {
    const current = readFileSync(filePath, 'utf8');
    if (current.length > 0) {
      return;
    }
  }
  writeFileSync(filePath, content);
}

function ensureDirectory(dirPath, options, plannedWrites) {
  const keepPath = path.join(dirPath, '.gitkeep');
  writePlannedFile(keepPath, '', options, plannedWrites);
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function appletReadme({ appletId, displayName, serviceName }) {
  return `# ${displayName} Official Applet

This official applet follows the Peers-Touch official applet architecture contract.

Architecture source:

- \`docs/architecture/platform/applet-runtime/official-applet-architecture-contract.md\`
- \`docs/architecture/platform/applet-runtime/note-applet-validation-design.md\` when this applet is Note

## Product Unit

\`\`\`text
apps/applets/${serviceName}/
  frontend/
  service/
  contracts/
  docs/
  tests/
\`\`\`

## Identity

- Applet id: \`${appletId}\`
- Service: \`${serviceName}\`

## Boundaries

- Frontend uses \`@peers-touch/applet-sdk\` for Host capabilities.
- Service follows DDD boundaries.
- Proto source stays under \`model/domain/${serviceName}/\`.
- Desktop, Mobile, and Web Hosts load built artifacts instead of importing product source.
`;
}

function contractReadme({ appletId, serviceName }) {
  return `# ${appletId} Contracts

This directory documents the applet product contract. It does not replace proto source files.

## Proto Source

\`\`\`text
model/domain/${serviceName}/v1/${serviceName}.proto
\`\`\`

## Service Binding

\`\`\`typescript
sdk.network.request({
  service: '${serviceName}',
  method: 'GET',
  path: '/v1/notes'
})
\`\`\`

The applet frontend must not know or construct a backend base URL.

## HTTP Mapping

\`\`\`text
GET    /v1/notes
GET    /v1/notes/{note_id}
POST   /v1/notes
PATCH  /v1/notes/{note_id}
DELETE /v1/notes/{note_id}
POST   /v1/notes/{note_id}:restore
GET    /v1/notes:search with query { q }
\`\`\`

## Error Mapping

Service errors must be returned through the Station API error envelope. Applet-visible errors are normalized by Host Gateway into typed applet errors with locale message keys.
`;
}

function frontendPackageJson({ appletId, serviceName }) {
  return json({
    name: `@peers-touch/${serviceName}-official-applet`,
    private: true,
    version: '0.1.0',
    type: 'module',
    scripts: {
      check: 'tsc --noEmit',
      build: 'rspeedy build --config rspeedy.config.ts',
    },
    dependencies: {
      '@lynx-js/react': '^0.121.0',
      '@peers-touch/applet-sdk': 'workspace:*',
      react: '^18.3.1',
    },
    devDependencies: {
      '@lynx-js/react-rsbuild-plugin': '^0.16.2',
      '@lynx-js/rspeedy': '^0.14.4',
      '@lynx-js/types': '^3.9.0',
      '@types/react': '^18.3.31',
      typescript: '^5.9.3',
    },
    peersTouch: {
      appletId,
    },
  });
}

function rspeedyConfig() {
  return `import { defineConfig } from '@lynx-js/rspeedy';
import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin';

export default defineConfig({
  plugins: [pluginReactLynx()],
  environments: {
    web: {},
  },
  source: {
    entry: './src/index.tsx',
  },
  output: {
    distPath: {
      root: './dist',
    },
    filename: 'main.lynx.bundle',
    filenameHash: false,
  },
});
`;
}

function tsconfig() {
  return json({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      jsx: 'react-jsx',
      jsxImportSource: '@lynx-js/react',
      resolveJsonModule: true,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    },
    include: ['src'],
  });
}

function frontendIndex({ serviceName }) {
  return `import { sdk } from '@peers-touch/applet-sdk';

export async function bootstrapOfficialApplet() {
  await sdk.lifecycle.reportReady();
  await sdk.telemetry.track({
    name: 'official_applet.bootstrap',
    properties: {
      service: '${serviceName}',
    },
  });
}
`;
}

function noteClient({ serviceName }) {
  return `import { sdk } from '@peers-touch/applet-sdk';

export async function requestNoteService(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
  query?: Record<string, string | number | boolean>,
) {
  return sdk.network.request({
    service: '${serviceName}',
    method,
    path,
    query,
    body,
  });
}
`;
}

function serviceReadme({ displayName, serviceName }) {
  return `# ${displayName} Service

This service follows the official applet DDD service contract.

## Layers

- \`domain/\`: aggregate, value objects, repository interfaces, domain errors, domain events.
- \`application/\`: commands, queries, use cases, transaction boundaries, authorization context.
- \`infrastructure/\`: repository implementations and persistence details.
- \`transport/\`: inbound HTTP/gRPC adapters.
- \`stationadapter/\`: Station subserver mounting.
- \`standalone/\`: standalone deployment entry.

Station may mount \`stationadapter\`, but applet business rules stay in \`apps/applets/${serviceName}/service\`.
`;
}

function serviceGoMod({ serviceName }) {
  return `module github.com/peers-labs/peers-touch/apps/applets/${serviceName}/service

go 1.24.6

require (
\tgithub.com/oklog/ulid/v2 v2.1.1
\tgoogle.golang.org/protobuf v1.36.11
\tgorm.io/driver/sqlite v1.6.0
\tgorm.io/gorm v1.31.1
)
`;
}

function protoSkeleton({ serviceName }) {
  const pkg = goPackageName(serviceName);
  const serviceTitle = serviceName
    .split('-')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join('');
  return `syntax = "proto3";

package peers_touch.model.${pkg}.v1;

import "google/protobuf/timestamp.proto";

option go_package = "github.com/peers-labs/peers-touch/apps/applets/${serviceName}/service/model;model";

message ${serviceTitle} {
  string ${pkg}_id = 1;
  string owner_id = 2;
  string title = 3;
  string content = 4;
  google.protobuf.Timestamp created_at = 5;
  google.protobuf.Timestamp updated_at = 6;
  google.protobuf.Timestamp deleted_at = 7;
}

message List${serviceTitle}sRequest {
  int32 page_size = 1;
  string page_token = 2;
  string order_by = 3;
  bool include_deleted = 4;
}

message List${serviceTitle}sResponse {
  repeated ${serviceTitle} items = 1;
  string next_page_token = 2;
}

message Get${serviceTitle}Request {
  string ${pkg}_id = 1;
  bool include_deleted = 2;
}

message Get${serviceTitle}Response {
  ${serviceTitle} item = 1;
}

message Create${serviceTitle}Request {
  string title = 1;
  string content = 2;
}

message Create${serviceTitle}Response {
  ${serviceTitle} item = 1;
}

message Update${serviceTitle}Request {
  string ${pkg}_id = 1;
  optional string title = 2;
  optional string content = 3;
}

message Update${serviceTitle}Response {
  ${serviceTitle} item = 1;
}

message Delete${serviceTitle}Request {
  string ${pkg}_id = 1;
}

message Delete${serviceTitle}Response {
  bool deleted = 1;
}

message Restore${serviceTitle}Request {
  string ${pkg}_id = 1;
}

message Restore${serviceTitle}Response {
  ${serviceTitle} item = 1;
}

message Search${serviceTitle}sRequest {
  string query = 1;
  int32 page_size = 2;
  string page_token = 3;
  string order_by = 4;
}

message Search${serviceTitle}sResponse {
  repeated ${serviceTitle} items = 1;
  string next_page_token = 2;
}

service ${serviceTitle}Service {
  rpc List${serviceTitle}s(List${serviceTitle}sRequest) returns (List${serviceTitle}sResponse);
  rpc Get${serviceTitle}(Get${serviceTitle}Request) returns (Get${serviceTitle}Response);
  rpc Create${serviceTitle}(Create${serviceTitle}Request) returns (Create${serviceTitle}Response);
  rpc Update${serviceTitle}(Update${serviceTitle}Request) returns (Update${serviceTitle}Response);
  rpc Delete${serviceTitle}(Delete${serviceTitle}Request) returns (Delete${serviceTitle}Response);
  rpc Restore${serviceTitle}(Restore${serviceTitle}Request) returns (Restore${serviceTitle}Response);
  rpc Search${serviceTitle}s(Search${serviceTitle}sRequest) returns (Search${serviceTitle}sResponse);
}
`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const appletId = requireOption(options, 'id');
  const serviceName = requireOption(options, 'service');
  const displayName = requireOption(options, 'name');
  validateAppletId(appletId);
  validateServiceName(serviceName);

  const appletDir = path.resolve('apps/applets', serviceName);
  const plannedWrites = [];
  const write = (relativePath, content) => {
    writePlannedFile(path.join(appletDir, relativePath), content, options, plannedWrites);
  };

  write('README.md', appletReadme({ appletId, displayName, serviceName }));
  write('applet.manifest.json', json({
    id: appletId,
    name: displayName,
    description: `${displayName} official applet`,
    author: 'Peers Touch',
    version: '0.1.0',
    icon: 'assets/icon.png',
    minPlatformVersion: '0.1.0',
    targets: ['desktop', 'android', 'ios', 'web'],
    entries: {
      lynx: 'main.lynx.bundle',
    },
    load: {
      desktop: { type: 'lynx-web', entry: 'main.lynx.bundle' },
      android: { type: 'lynx-native', entry: 'main.lynx.bundle' },
      ios: { type: 'lynx-native', entry: 'main.lynx.bundle' },
      web: { type: 'lynx-web', entry: 'main.lynx.bundle' },
    },
    bridge: {
      protocol: 'peers-touch.applet.bridge',
      version: '1.0.0',
    },
    permissions: [
      'app.getContext',
      'app.getLaunchOptions',
      'lifecycle.reportReady',
      'network.request',
      'storage.get',
      'storage.set',
      'storage.remove',
      'ui.showToast',
      'ui.showLoading',
      'ui.hideLoading',
      'ui.showModal',
      'navigation.navigateTo',
      'navigation.back',
      'events.emit',
      'events.subscribe',
      'events.unsubscribe',
      'telemetry.track',
      'telemetry.reportError',
    ],
    capabilities: [],
    services: [
      {
        id: serviceName,
        kind: 'http',
        binding: 'station-resolved',
        allowedMethods: ['GET', 'POST', 'PATCH', 'DELETE'],
        allowedPaths: ['/v1/notes', '/v1/notes/*', '/v1/notes:search'],
        publicPathPrefix: '/v1',
        stationPathPrefix: `/applets/${serviceName}/v1`,
        streaming: false,
      },
    ],
    serviceDependencies: {
      [serviceName]: {
        kind: 'station-subserver',
        required: true,
      },
    },
    skills: [],
    platformPermissions: [
      `network:service:${serviceName}`,
      'storage:applet',
      'ui:feedback',
      'navigation:applet',
      'events:applet',
      'telemetry:track',
    ],
  }));
  write('service.manifest.json', json({
    service: serviceName,
    routes: {
      stationPrefix: `/applets/${serviceName}/v1`,
      publicPrefix: '/v1',
    },
    deployment: {
      stationBundled: true,
      standalone: 'planned',
    },
    health: {
      path: '/healthz',
    },
  }));
  write('frontend/package.json', frontendPackageJson({ appletId, serviceName }));
  write('frontend/rspeedy.config.ts', rspeedyConfig());
  write('frontend/tsconfig.json', tsconfig());
  write('frontend/src/index.tsx', frontendIndex({ serviceName }));
  write('frontend/src/domain/.gitkeep', '');
  write('frontend/src/application/.gitkeep', '');
  write('frontend/src/infrastructure/capability/serviceClient.ts', noteClient({ serviceName }));
  write('frontend/src/presentation/pages/.gitkeep', '');
  write('frontend/src/presentation/components/.gitkeep', '');
  write('frontend/locales/en.json', json({}));
  write('frontend/locales/zh-CN.json', json({}));
  write('service/README.md', serviceReadme({ displayName, serviceName }));
  write('service/go.mod', serviceGoMod({ serviceName }));
  for (const serviceDir of ['domain', 'application', 'infrastructure', 'transport', 'stationadapter', 'standalone']) {
    ensureDirectory(path.join(appletDir, 'service', serviceDir), options, plannedWrites);
  }
  write('contracts/README.md', contractReadme({ appletId, serviceName }));
  ensureDirectory(path.join(appletDir, 'docs'), options, plannedWrites);
  ensureDirectory(path.join(appletDir, 'tests'), options, plannedWrites);

  if (options['with-proto']) {
    const protoPath = path.resolve('model/domain', serviceName, 'v1', `${serviceName}.proto`);
    writePlannedFile(protoPath, protoSkeleton({ serviceName }), options, plannedWrites);
  }

  const summary = {
    status: options['dry-run'] ? 'DRY_RUN' : 'OK',
    appletId,
    service: serviceName,
    appletDir: path.relative(process.cwd(), appletDir),
    withProto: Boolean(options['with-proto']),
    plannedWrites,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`FAIL create official applet: ${error.message}\n`);
  process.exit(1);
}
