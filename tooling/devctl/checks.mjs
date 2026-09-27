import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DevctlError, ERROR_CODES } from './errors.mjs';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

function walkSourceFiles(root, extensions = SOURCE_EXTENSIONS, excludedDirectories = new Set()) {
  if (!fs.existsSync(root)) {
    throw new DevctlError(
      ERROR_CODES.CHECK_FAILED,
      `Required scan root does not exist: ${root}`,
      { root },
    );
  }

  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name)) {
          pending.push(target);
        }
      } else if (extensions.has(path.extname(entry.name))) {
        files.push(target);
      }
    }
  }
  return files.sort();
}

function sourceMatches(filePath, expression, options = {}) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/u);
  const matches = [];
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trimStart();
    if (options.ignoreComments && (trimmed.startsWith('//') || trimmed.startsWith('*'))) {
      continue;
    }
    expression.lastIndex = 0;
    if (expression.test(line)) {
      matches.push({ file: filePath, line: index + 1, text: line.trim() });
    }
  }
  return matches;
}

function requireText(filePath, token, violations, rule) {
  if (!fs.existsSync(filePath)) {
    violations.push({ rule, file: filePath, line: 0, text: 'required file missing' });
    return;
  }
  if (!fs.readFileSync(filePath, 'utf8').includes(token)) {
    violations.push({ rule, file: filePath, line: 0, text: `missing ${token}` });
  }
}

export function checkSocialWire(root) {
  const desktopSource = path.join(root, 'apps', 'desktop', 'src');
  const scanRoots = ['services', 'runtimes', 'store'].map((part) =>
    path.join(desktopSource, part),
  );
  const forbidden =
    /ProtoReader|STREAM_EVENT_[A-Z_]+_FIELD|reader\.varint|reader\.bytes|field-number/u;
  const violations = scanRoots.flatMap((scanRoot) =>
    walkSourceFiles(scanRoot).flatMap((filePath) =>
      sourceMatches(filePath, forbidden).map((match) => ({
        rule: 'desktop-social-wire-generated-proto-only',
        ...match,
      })),
    ),
  );

  const eventStream = path.join(desktopSource, 'services', 'eventStream.ts');
  const socialRealtime = path.join(desktopSource, 'services', 'socialRealtime.ts');
  requireText(eventStream, 'StreamEventSchema', violations, 'event-stream-schema');
  requireText(eventStream, 'fromBinary', violations, 'event-stream-generated-decoder');
  requireText(
    socialRealtime,
    'FriendChatMessageSchema',
    violations,
    'friend-chat-schema',
  );
  requireText(socialRealtime, 'GroupMessageSchema', violations, 'group-message-schema');
  requireText(
    socialRealtime,
    'fromBinary',
    violations,
    'social-realtime-generated-decoder',
  );
  return violations;
}

export function checkSocialRuntimeBoundaries(root) {
  const desktopRoots = ['pages', 'components'].map((part) =>
    path.join(root, 'apps', 'desktop', 'src', part),
  );
  const mobileRoots = ['pages', 'components'].map((part) =>
    path.join(root, 'apps', 'mobile', 'src', part),
  );
  const rules = [
    {
      id: 'ui-must-not-own-realtime-stream',
      expression: /\/events\/stream|\/presence\/heartbeat|\/presence\/offline|EventSource\(/u,
      roots: [...desktopRoots, ...mobileRoots],
    },
    {
      id: 'ui-must-not-install-social-runtime',
      expression: /startEventStream|installEventStreamBridge|installSocialRealtimeBridge|installSocialChatRealtimeBridge|startRealtimeStream|startSocialRuntime|dispatchSocialRuntimeExternalEvent|createSocialEventIngress|createMomentsProjection|createProfileProjection|createMomentsGateway|createProfileGateway|stubIngress/u,
      roots: [...desktopRoots, ...mobileRoots],
    },
    {
      id: 'ui-must-not-reconcile-social-runtime',
      expression: /refreshSocialProjection|\.reconcile\(|useSocialStore\.getState\(\)\.reconcile|loadFriendRequests\(|refreshFriendRequests\(|refreshSessions\(|refreshNotifications\(/u,
      roots: [...desktopRoots, ...mobileRoots],
    },
    {
      id: 'mobile-ui-must-not-refresh-social-projections',
      expression: /\b(?:loadCurrentUserProfile|loadPeerProfile|loadFriendshipStatus)\b/u,
      roots: mobileRoots,
    },
    {
      id: 'mobile-ui-must-not-own-group-e2ee',
      expression: /GroupCiphertextSchema|SenderKeyDistributionMessageSchema|crypto_group|cryptoGroup|groupE2ee/u,
      roots: mobileRoots,
    },
  ];

  return rules.flatMap((rule) =>
    rule.roots.flatMap((scanRoot) =>
      walkSourceFiles(scanRoot).flatMap((filePath) =>
        sourceMatches(filePath, rule.expression, { ignoreComments: true }).map(
          (match) => ({ rule: rule.id, ...match }),
        ),
      ),
    ),
  );
}

export function checkMobileSocialWire(root) {
  const mobileRoot = path.join(root, 'apps', 'mobile');
  const socialRoot = path.join(mobileRoot, 'src', 'features', 'social');
  const groupRoot = path.join(mobileRoot, 'src', 'features', 'group');
  const forbiddenDecoder =
    /ProtoReader|STREAM_EVENT_[A-Z_]+_FIELD|reader\.varint|reader\.bytes|field-number/u;
  const violations = [socialRoot, groupRoot].flatMap((scanRoot) =>
    walkSourceFiles(scanRoot).flatMap((filePath) =>
      sourceMatches(filePath, forbiddenDecoder).map((match) => ({
        rule: 'mobile-social-wire-generated-proto-only',
        ...match,
      })),
    ),
  );

  const socialWire = path.join(socialRoot, 'socialWire.ts');
  requireText(socialWire, 'StreamEventSchema', violations, 'mobile-event-stream-schema');
  requireText(
    socialWire,
    'FriendChatMessageSchema',
    violations,
    'mobile-friend-chat-schema',
  );
  requireText(socialWire, 'GroupMessageSchema', violations, 'mobile-group-message-schema');

  const legacyOwnership =
    /groupE2ee|GROUP_SKDM|SENDER_KEY_DISTRIBUTION|crypto\.sender-key-ledger|signaling_envelope_(open|seal)|messaging_send_text/u;
  const legacyRoots = [
    path.join(mobileRoot, 'src'),
    path.join(mobileRoot, 'src-tauri', 'src'),
  ];
  violations.push(
    ...legacyRoots.flatMap((scanRoot) =>
      walkSourceFiles(
        scanRoot,
        new Set(['.ts', '.tsx', '.rs']),
        new Set(['gen']),
      ).flatMap((filePath) =>
        sourceMatches(filePath, legacyOwnership).map((match) => ({
          rule: 'mobile-legacy-browser-messaging-owner-deleted',
          ...match,
        })),
      ),
    ),
  );
  return violations;
}

function checkResult(name, violations) {
  return {
    name,
    ok: violations.length === 0,
    violations,
  };
}

export function runChecks(root, target = 'all') {
  const available = [
    checkResult('desktop-social-wire', checkSocialWire(root)),
    checkResult('mobile-social-wire', checkMobileSocialWire(root)),
    checkResult('social-runtime-boundaries', checkSocialRuntimeBoundaries(root)),
  ];
  const results = target === 'desktop'
    ? available.filter((result) => result.name !== 'mobile-social-wire')
    : target === 'all'
      ? available
    : available.filter((result) => result.name === target);
  if (results.length === 0) {
    throw new DevctlError(
      ERROR_CODES.UNSUPPORTED_MODE,
      `Unsupported check target: ${target}`,
      { target },
    );
  }
  const failures = results.flatMap((result) => result.violations);
  if (failures.length > 0) {
    throw new DevctlError(
      ERROR_CODES.CHECK_FAILED,
      `${failures.length} source contract violation(s) found`,
      { results },
    );
  }
  return results;
}

export function changedFiles(root, range) {
  const result = spawnSync('git', ['diff', '--name-only', range, '--'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new DevctlError(
      ERROR_CODES.CHECK_FAILED,
      `Unable to read git range: ${range}`,
      { range, stderr: result.stderr.trim() },
    );
  }
  return result.stdout.split(/\r?\n/u).filter(Boolean);
}
