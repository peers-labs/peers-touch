import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const appletEvidenceRoot = path.join(repoRoot, 'tooling', 'acceptance', 'evidence', 'applets');
export const appletFixtureRoot = path.join(repoRoot, 'tooling', 'fixtures', 'applets');
export const appletArtifactRoot = path.resolve(
  repoRoot,
  process.env.PT_APPLET_ARTIFACT_ROOT ?? '.artifacts/applet-readiness',
);

if (
  appletArtifactRoot === repoRoot ||
  appletArtifactRoot === path.parse(appletArtifactRoot).root
) {
  throw new Error('PT_APPLET_ARTIFACT_ROOT must be a dedicated artifact directory');
}

function assertDescendant(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside ${root}: ${candidate}`);
  }
}

export const appletArtifactPath = (...segments) => {
  const candidate = path.resolve(appletArtifactRoot, ...segments);
  assertDescendant(appletArtifactRoot, candidate, 'Applet artifact path');
  return candidate;
};

const builtPackages = new Set();

function buildWorkspacePackage(name) {
  if (builtPackages.has(name)) return;
  const result = spawnSync('pnpm', ['--filter', name, 'run', 'build'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    throw new Error(`Failed to build ${name}\n${result.stdout}\n${result.stderr}`);
  }
  builtPackages.add(name);
}

export function prepareAppletFixturePackage(id) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
    throw new Error(`Invalid Applet fixture id: ${id}`);
  }
  const source = path.join(appletFixtureRoot, 'packages', id);
  const destination = appletArtifactPath('packages', id);
  if (!existsSync(source)) throw new Error(`Applet fixture does not exist: ${id}`);

  rmSync(destination, { recursive: true, force: true });
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true });

  const packageJson = JSON.parse(readFileSync(path.join(destination, 'package.json'), 'utf8'));
  if (!packageJson.scripts?.build) return destination;

  buildWorkspacePackage('@peers-touch/applet-contract');
  buildWorkspacePackage('@peers-touch/applet-sdk');
  const result = spawnSync('pnpm', ['--dir', destination, 'run', 'build'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, PT_REPO_ROOT: repoRoot },
  });
  if (result.status !== 0) {
    throw new Error(`Failed to build Applet fixture ${id}\n${result.stdout}\n${result.stderr}`);
  }

  const manifestPath = path.join(destination, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const relativePath of Object.keys(manifest.integrity?.files ?? {})) {
    const file = path.join(destination, relativePath);
    if (!existsSync(file)) continue;
    manifest.integrity.files[relativePath] = `sha256:${createHash('sha256')
      .update(readFileSync(file))
      .digest('hex')}`;
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return destination;
}
