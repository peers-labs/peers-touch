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

function normalizeExcludedPaths(values = []) {
  return [...new Set(values.map((value) => {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      path.isAbsolute(value) ||
      value.split('/').some((segment) => segment === '.' || segment === '..')
    ) {
      throw new Error(`Invalid excluded source path: ${value}`);
    }
    return path.posix.normalize(value.replaceAll('\\', '/')).replace(/\/+$/, '');
  }))].sort();
}

function normalizeExcludedGlobs(values = []) {
  return [...new Set(values.map((value) => {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      path.isAbsolute(value) ||
      value.split('/').some((segment) => segment === '.' || segment === '..')
    ) {
      throw new Error(`Invalid excluded source glob: ${value}`);
    }
    return value.replaceAll('\\', '/');
  }))].sort();
}

function pathspec(excludedPaths, excludedGlobs) {
  return [
    '--',
    '.',
    ...excludedPaths.map((relative) => `:(top,exclude,literal)${relative}`),
    ...excludedGlobs.map((relative) => `:(top,exclude,glob)${relative}`),
  ];
}

function status(root, excludedPaths, excludedGlobs) {
  return git(
    root,
    [
      'status',
      '--porcelain=v2',
      '--branch',
      '--untracked-files=all',
      ...pathspec(excludedPaths, excludedGlobs),
    ],
  );
}

function contentDigest(root, statusText, excludedPaths, excludedGlobs) {
  const digest = createHash('sha256');
  digest.update(statusText);
  digest.update(
    git(
      root,
      [
        'diff',
        '--binary',
        '--no-ext-diff',
        'HEAD',
        ...pathspec(excludedPaths, excludedGlobs),
      ],
      { encoding: 'buffer' },
    ),
  );
  const untracked = git(
    root,
    [
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
      ...pathspec(excludedPaths, excludedGlobs),
    ],
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

export function inspectGitWorkspace(workspaceRoot, options = {}) {
  const root = realpathSync(workspaceRoot);
  const excludedPaths = normalizeExcludedPaths(options.excludePaths);
  const excludedGlobs = normalizeExcludedGlobs(options.excludeGlobs);
  const firstStatus = status(root, excludedPaths, excludedGlobs);
  const firstDigest = contentDigest(
    root,
    firstStatus,
    excludedPaths,
    excludedGlobs,
  );
  const [commit, tree] = git(
    root,
    ['show', '-s', '--format=%H%n%T', 'HEAD'],
  ).trim().split('\n');
  const secondStatus = status(root, excludedPaths, excludedGlobs);
  const secondDigest = contentDigest(
    root,
    secondStatus,
    excludedPaths,
    excludedGlobs,
  );
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
