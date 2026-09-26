import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';

import { workspaceIdForRoot } from '../lib/machine-dev-paths.mjs';

function git(root, args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: options.encoding ?? 'utf8',
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function containedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function status(root) {
  return git(
    root,
    ['status', '--porcelain=v2', '--branch', '--untracked-files=all'],
  );
}

function contentDigest(root, statusText) {
  const digest = createHash('sha256');
  digest.update(statusText);
  digest.update(
    git(
      root,
      ['diff', '--binary', '--no-ext-diff', 'HEAD', '--'],
      { encoding: 'buffer' },
    ),
  );
  const untracked = git(
    root,
    ['ls-files', '--others', '--exclude-standard', '-z'],
    { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 },
  )
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .sort();
  for (const relative of untracked) {
    const absolute = path.resolve(root, relative);
    if (!containedPath(root, absolute)) {
      throw new Error(`Untracked source path escapes the workspace: ${relative}`);
    }
    const metadata = lstatSync(absolute);
    digest.update(`\0${relative}\0${metadata.mode}\0`);
    digest.update(
      metadata.isSymbolicLink()
        ? Buffer.from(readlinkSync(absolute))
        : readFileSync(absolute),
    );
  }
  return `sha256:${digest.digest('hex')}`;
}

export function isAncestorOf(workspaceRoot, ancestor, descendant) {
  if (ancestor === descendant) return true;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      cwd: realpathSync(workspaceRoot),
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

export function inspectGitWorkspace(workspaceRoot) {
  const root = realpathSync(workspaceRoot);
  const firstStatus = status(root);
  const firstDigest = contentDigest(root, firstStatus);
  const [commit, tree] = git(
    root,
    ['show', '-s', '--format=%H%n%T', 'HEAD'],
  ).trim().split('\n');
  const secondStatus = status(root);
  const secondDigest = contentDigest(root, secondStatus);
  const branch =
    secondStatus
      .split('\n')
      .find((line) => line.startsWith('# branch.head '))
      ?.slice('# branch.head '.length) ?? '';
  const statusCommit =
    secondStatus
      .split('\n')
      .find((line) => line.startsWith('# branch.oid '))
      ?.slice('# branch.oid '.length) ?? '';
  const entries = secondStatus
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith('# '));
  return {
    workspaceId: workspaceIdForRoot(root),
    branch,
    commit,
    tree,
    clean: entries.length === 0,
    stable:
      firstStatus === secondStatus &&
      firstDigest === secondDigest &&
      statusCommit === commit,
    workspaceDigest: entries.length === 0 ? 'clean' : secondDigest,
  };
}
