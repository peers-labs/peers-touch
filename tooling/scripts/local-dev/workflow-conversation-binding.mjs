import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';

import {
  machineDevRoot,
  workspaceIdForRoot,
} from '../lib/machine-dev-paths.mjs';

const BINDING_KEYS = new Set([
  'kind',
  'host',
  'conversationHash',
  'executionRoot',
  'workspaceId',
  'boundAt',
  'bindingEvent',
  'digest',
]);
const RELEASE_KEYS = new Set([
  'kind',
  'bindingDigest',
  'anchorDigest',
  'releasedAt',
  'digest',
]);
const HOST = /^(?:codex|cursor|trae)$/;
const SHA256 = /^[0-9a-f]{64}$/;

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function owned(metadata) {
  return typeof process.getuid !== 'function' || metadata.uid === process.getuid();
}

function ensureOwnedDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const metadata = lstatSync(directory);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    !owned(metadata) ||
    (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
  ) {
    throw Object.assign(
      new Error(`${directory} is not an owner-controlled directory`),
      { code: 'CONVERSATION_STORE_INVALID' },
    );
  }
}

function conversationDirectory(host, conversationHash, options = {}) {
  if (!HOST.test(host) || !SHA256.test(conversationHash)) {
    throw Object.assign(new Error('Conversation store identity is invalid'), {
      code: 'CONVERSATION_STORE_INVALID',
    });
  }
  const root = options.machineRoot ?? machineDevRoot();
  if (!path.isAbsolute(root)) {
    throw Object.assign(new Error('Conversation store root must be absolute'), {
      code: 'CONVERSATION_STORE_INVALID',
    });
  }
  const directory = path.join(root, 'conversations', host, conversationHash);
  ensureOwnedDirectory(root);
  ensureOwnedDirectory(path.join(root, 'conversations'));
  ensureOwnedDirectory(path.join(root, 'conversations', host));
  ensureOwnedDirectory(directory);
  return directory;
}

function readOwnedJson(file, code) {
  if (!existsSync(file)) return null;
  const metadata = lstatSync(file);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    !owned(metadata) ||
    (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
  ) {
    throw Object.assign(new Error(`${file} is not an owner-controlled file`), {
      code,
    });
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw Object.assign(new Error(`${file} is not valid JSON`), {
      code,
      cause: error,
    });
  }
}

function writeDurableFile(file, value) {
  const descriptor = openSync(file, 'wx', 0o600);
  try {
    writeSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function fsyncDirectory(directoryPath) {
  if (process.platform === 'win32') return;
  const directory = openSync(directoryPath, 'r');
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

function temporaryPath(file) {
  return path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
  );
}

function writeDurableExclusive(file, value) {
  const temporary = temporaryPath(file);
  try {
    writeDurableFile(temporary, value);
    linkSync(temporary, file);
    fsyncDirectory(path.dirname(file));
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function writeDurableReplace(file, value) {
  if (existsSync(file)) {
    const metadata = lstatSync(file);
    if (!metadata.isFile() || metadata.isSymbolicLink() || !owned(metadata)) {
      throw Object.assign(new Error(`${file} is not an owner-controlled file`), {
        code: 'CONVERSATION_STORE_INVALID',
      });
    }
  }
  const temporary = temporaryPath(file);
  try {
    writeDurableFile(temporary, value);
    renameSync(temporary, file);
    fsyncDirectory(path.dirname(file));
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function validateTimestamp(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

function validateDigestRecord(value, keys, kind, code) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.kind !== kind ||
    new Set(Object.keys(value)).size !== keys.size ||
    [...keys].some((key) => !(key in value))
  ) {
    throw Object.assign(new Error(`${kind} has an invalid shape`), { code });
  }
  const { digest: actualDigest, ...unsigned } = value;
  if (
    typeof actualDigest !== 'string' ||
    actualDigest !== digest(unsigned)
  ) {
    throw Object.assign(new Error(`${kind} digest does not match`), { code });
  }
  return value;
}

function validateStoredBinding(value, expected = {}) {
  validateDigestRecord(
    value,
    BINDING_KEYS,
    'peers-touch-workflow-conversation-binding',
    'CONVERSATION_BINDING_INVALID',
  );
  if (
    typeof value.executionRoot !== 'string' ||
    typeof value.workspaceId !== 'string' ||
    typeof value.host !== 'string' ||
    typeof value.conversationHash !== 'string'
  ) {
    throw Object.assign(new Error('Conversation binding fields are invalid'), {
      code: 'CONVERSATION_BINDING_INVALID',
    });
  }
  const canonicalRoot = realpathSync(value.executionRoot);
  if (
    !HOST.test(value.host) ||
    !SHA256.test(value.conversationHash) ||
    value.executionRoot !== canonicalRoot ||
    value.workspaceId !== workspaceIdForRoot(canonicalRoot) ||
    value.bindingEvent !== 'PRE_TOOL_USE' ||
    !validateTimestamp(value.boundAt) ||
    (expected.host !== undefined && value.host !== expected.host) ||
    (expected.conversationHash !== undefined &&
      value.conversationHash !== expected.conversationHash)
  ) {
    throw Object.assign(new Error('Conversation binding identity is invalid'), {
      code: 'CONVERSATION_BINDING_INVALID',
    });
  }
  return value;
}

function bindingIsReleased(directory, binding) {
  const releases = path.join(directory, 'releases');
  if (!existsSync(releases)) return false;
  const metadata = lstatSync(releases);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    !owned(metadata) ||
    (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
  ) {
    throw Object.assign(
      new Error(`${releases} is not an owner-controlled directory`),
      { code: 'CONVERSATION_STORE_INVALID' },
    );
  }
  return readdirSync(releases, { withFileTypes: true }).some((entry) => {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      throw Object.assign(new Error('Conversation release entry is invalid'), {
        code: 'CONVERSATION_RELEASE_INVALID',
      });
    }
    const release = validateDigestRecord(
      readOwnedJson(
        path.join(releases, entry.name),
        'CONVERSATION_RELEASE_INVALID',
      ),
      RELEASE_KEYS,
      'peers-touch-workflow-conversation-release',
      'CONVERSATION_RELEASE_INVALID',
    );
    return release.bindingDigest === binding.digest;
  });
}

export function conversationHash(host, stableConversationId) {
  if (!HOST.test(host) ||
      typeof stableConversationId !== 'string' ||
      !stableConversationId) {
    throw Object.assign(new Error('Host conversation identity is invalid'), {
      code: 'CONVERSATION_IDENTITY_INVALID',
    });
  }
  return createHash('sha256')
    .update(`${host}\0${stableConversationId}`)
    .digest('hex');
}

export function conversationBindingPath(
  host,
  stableConversationId,
  options = {},
) {
  const hash = conversationHash(host, stableConversationId);
  return path.join(
    conversationDirectory(host, hash, options),
    'execution-binding.json',
  );
}

export function readConversationBinding(
  host,
  stableConversationId,
  options = {},
) {
  const file = conversationBindingPath(host, stableConversationId, options);
  const value = readOwnedJson(file, 'CONVERSATION_BINDING_INVALID');
  if (value === null) return null;
  return validateStoredBinding(value, {
    host,
    conversationHash: conversationHash(host, stableConversationId),
  });
}

export function listActiveConversationBindings(executionRoot, options = {}) {
  const canonicalRoot = realpathSync(executionRoot);
  const root = options.machineRoot ?? machineDevRoot();
  const conversations = path.join(root, 'conversations');
  if (!existsSync(conversations)) return [];
  const metadata = lstatSync(conversations);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    !owned(metadata) ||
    (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
  ) {
    throw Object.assign(
      new Error(`${conversations} is not an owner-controlled directory`),
      { code: 'CONVERSATION_STORE_INVALID' },
    );
  }
  const bindings = [];
  for (const hostEntry of readdirSync(conversations, { withFileTypes: true })) {
    if (!hostEntry.isDirectory() || !HOST.test(hostEntry.name)) continue;
    const hostDirectory = path.join(conversations, hostEntry.name);
    ensureOwnedDirectory(hostDirectory);
    for (const conversationEntry of readdirSync(hostDirectory, {
      withFileTypes: true,
    })) {
      if (
        !conversationEntry.isDirectory() ||
        !SHA256.test(conversationEntry.name)
      ) {
        continue;
      }
      const directory = path.join(hostDirectory, conversationEntry.name);
      ensureOwnedDirectory(directory);
      const file = path.join(directory, 'execution-binding.json');
      const value = readOwnedJson(file, 'CONVERSATION_BINDING_INVALID');
      if (value === null) continue;
      const binding = validateStoredBinding(value, {
        host: hostEntry.name,
        conversationHash: conversationEntry.name,
      });
      if (
        binding.executionRoot === canonicalRoot &&
        !bindingIsReleased(directory, binding)
      ) {
        bindings.push(binding);
      }
    }
  }
  return bindings.sort((left, right) => left.boundAt.localeCompare(right.boundAt));
}

export function resolveActiveConversationBinding(
  executionRoot,
  options = {},
) {
  const excluded = new Set(options.excludeDigests ?? []);
  const candidates = listActiveConversationBindings(
    executionRoot,
    options,
  ).filter((binding) => !excluded.has(binding.digest));
  if (candidates.length !== 1) {
    throw Object.assign(
      new Error('Exactly one active conversation binding must own this action'),
      {
        code: 'CONVERSATION_BINDING_AMBIGUOUS',
        details: {
          candidateCount: candidates.length,
          excludedCount: excluded.size,
        },
      },
    );
  }
  return candidates[0];
}

export function bindConversation(
  host,
  stableConversationId,
  executionRoot,
  options = {},
) {
  const canonicalRoot = realpathSync(executionRoot);
  const unsigned = {
    kind: 'peers-touch-workflow-conversation-binding',
    host,
    conversationHash: conversationHash(host, stableConversationId),
    executionRoot: canonicalRoot,
    workspaceId: workspaceIdForRoot(canonicalRoot),
    boundAt: (options.now ?? new Date()).toISOString(),
    bindingEvent: 'PRE_TOOL_USE',
  };
  const value = { ...unsigned, digest: digest(unsigned) };
  const file = conversationBindingPath(host, stableConversationId, options);
  try {
    writeDurableExclusive(file, value);
    return { binding: value, created: true };
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    return {
      binding: readConversationBinding(host, stableConversationId, options),
      created: false,
    };
  }
}

export function writeAnchorReceipt(binding, anchor, options = {}) {
  const directory = conversationDirectory(
    binding.host,
    binding.conversationHash,
    options,
  );
  const unsigned = {
    kind: 'peers-touch-workflow-anchor-receipt',
    bindingDigest: binding.digest,
    anchorDigest: anchor.digest,
    renderedAt: (options.now ?? new Date()).toISOString(),
    status: anchor.status,
    content: anchor.content,
  };
  const value = { ...unsigned, digest: digest(unsigned) };
  writeDurableReplace(path.join(directory, 'anchor-receipt.json'), value);
  return value;
}

export function releaseConversation(binding, anchorDigest, options = {}) {
  const directory = conversationDirectory(
    binding.host,
    binding.conversationHash,
    options,
  );
  if (!SHA256.test(anchorDigest)) {
    throw Object.assign(new Error('Anchor digest is invalid'), {
      code: 'CONVERSATION_RELEASE_INVALID',
    });
  }
  const releases = path.join(directory, 'releases');
  ensureOwnedDirectory(releases);
  const unsigned = {
    kind: 'peers-touch-workflow-conversation-release',
    bindingDigest: binding.digest,
    anchorDigest,
    releasedAt: (options.now ?? new Date()).toISOString(),
  };
  const value = { ...unsigned, digest: digest(unsigned) };
  const file = path.join(releases, `${anchorDigest}.json`);
  try {
    writeDurableExclusive(file, value);
    return value;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = validateDigestRecord(
      readOwnedJson(file, 'CONVERSATION_RELEASE_INVALID'),
      RELEASE_KEYS,
      'peers-touch-workflow-conversation-release',
      'CONVERSATION_RELEASE_INVALID',
    );
    if (existing.bindingDigest !== binding.digest) {
      throw Object.assign(
        new Error('Conversation release belongs to a different binding'),
        { code: 'CONVERSATION_RELEASE_CONFLICT' },
      );
    }
    return existing;
  }
}
