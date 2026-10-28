import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { compareVersions, parseVersion } from './release-version-check.mjs';
import { sha256 } from './release-evidence-check.mjs';
import { checkManifest } from './release-assets.mjs';

function requireFact(condition, code) { if (!condition) throw new Error(code); }
const repo = process.env.GITHUB_REPOSITORY;
const tag = process.env.GITHUB_REF_NAME;
const source = process.env.GITHUB_SHA;
const api = async (route, method = 'GET', body) => {
  const response = await fetch(`https://api.github.com${route}`, {
    method, headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404 && method === 'GET') return null;
  requireFact(response.ok, `RD_GITHUB_API_FAILED:${response.status}`);
  if (response.status === 204) return {};
  return response.json();
};

async function currentRelease() {
  const release = await api(`/repos/${repo}/releases/tags/${tag}`);
  requireFact(release && release.target_commitish === source, 'RD_RELEASE_SOURCE_MISMATCH');
  return release;
}

async function draft() {
  requireFact(!await api(`/repos/${repo}/releases/tags/${tag}`), 'RD_RELEASE_ALREADY_EXISTS');
  const release = await api(`/repos/${repo}/releases`, 'POST', {
    tag_name: tag, target_commitish: source, name: tag, draft: true,
    prerelease: parseVersion(tag).pre.length > 0, make_latest: 'false',
    body: 'Station and Desktop candidate. OS installers are unsigned; signed Tauri updater packages require the baked public key. Runtime evidence must pass before publication.',
  });
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `release_id=${release.id}\n`);
}

async function upload(directory) {
  const release = await currentRelease();
  requireFact(release.draft, 'RD_PUBLIC_ASSET_OVERWRITE_DENIED');
  for (const name of fs.readdirSync(directory)) {
    requireFact(/^[A-Za-z0-9_.-]+$/u.test(name), 'RD_ASSET_NAME_INVALID');
    const file = path.join(directory, name);
    const existing = release.assets.find((asset) => asset.name === name);
    if (existing) {
      const response = await fetch(existing.url, { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/octet-stream' } });
      requireFact(response.ok && sha256(Buffer.from(await response.arrayBuffer())) === sha256(fs.readFileSync(file)), 'RD_ASSET_OVERWRITE_DENIED');
      continue;
    }
    execFileSync('gh', ['release', 'upload', tag, file, '--repo', repo], { stdio: 'pipe' });
  }
}

async function finalize() {
  const release = await currentRelease();
  requireFact(release.draft, 'RD_RELEASE_ALREADY_PUBLIC');
  const response = await fetch(release.assets.find((asset) => asset.name === 'latest.json')?.url,
    { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/octet-stream' } });
  requireFact(response.ok, 'RD_MANIFEST_MISSING');
  checkManifest(await response.json(), { repo, tag, assets: release.assets.map((asset) => asset.name) });
  const image = `ghcr.io/peers-labs/peers-touch-station`;
  const digest = process.env.PT_RD_IMAGE_DIGEST;
  requireFact(/^sha256:[a-f0-9]{64}$/u.test(digest), 'RD_IMAGE_DIGEST_REQUIRED');
  // Package visibility is a separately authorized operator setup step.
  const packageInfo = await api(`/orgs/peers-labs/packages/container/peers-touch-station`);
  requireFact(packageInfo?.visibility === 'public', 'RD_GHCR_PUBLIC_VISIBILITY_REQUIRED');
  const existing = (() => {
    try { return execFileSync('docker', ['buildx', 'imagetools', 'inspect', `${image}:${tag}`, '--format', '{{json .Manifest}}'], { encoding: 'utf8' }); }
    catch { return null; }
  })();
  if (existing) requireFact(JSON.parse(existing).digest === digest, 'RD_IMAGE_TAG_OVERWRITE_DENIED');
  else execFileSync('docker', ['buildx', 'imagetools', 'create', '--tag', `${image}:${tag}`, `${image}@${digest}`], { stdio: 'pipe' });
  await api(`/repos/${repo}/releases/${release.id}`, 'PATCH', { draft: false, make_latest: 'false' });
}

export function canonicalizeUpdaterManifest(manifest, assets) {
  const projected = structuredClone(manifest);
  let changed = false;
  for (const value of Object.values(projected.platforms ?? {})) {
    const parsed = new URL(value.url);
    const assetID = /^\/repos\/[^/]+\/[^/]+\/releases\/assets\/(\d+)$/u.exec(parsed.pathname)?.[1];
    const asset = assetID
      ? assets.find((candidate) => String(candidate.id) === assetID)
      : assets.find((candidate) => candidate.browser_download_url === value.url);
    requireFact(asset && asset.name !== 'latest.json', 'RD_UPDATER_ASSET_IDENTITY_MISSING');
    if (value.url !== asset.browser_download_url) {
      value.url = asset.browser_download_url;
      changed = true;
    }
  }
  return { manifest: projected, changed };
}

async function canonicalizeManifest() {
  const release = await currentRelease();
  requireFact(release.draft, 'RD_PUBLIC_ASSET_OVERWRITE_DENIED');
  const manifestAsset = release.assets.find((asset) => asset.name === 'latest.json');
  requireFact(manifestAsset, 'RD_MANIFEST_MISSING');
  const response = await fetch(manifestAsset.url, {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/octet-stream' },
  });
  requireFact(response.ok, 'RD_MANIFEST_DOWNLOAD_FAILED');
  const { manifest, changed } = canonicalizeUpdaterManifest(await response.json(), release.assets);
  checkManifest(manifest, { repo, tag, assets: release.assets.map((asset) => asset.name) });
  if (!changed) return;
  const directory = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'rd-manifest-'));
  try {
    fs.writeFileSync(path.join(directory, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await api(`/repos/${repo}/releases/assets/${manifestAsset.id}`, 'DELETE');
    execFileSync('gh', ['release', 'upload', tag, path.join(directory, 'latest.json'), '--repo', repo],
      { stdio: 'pipe' });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function promote() {
  requireFact(!parseVersion(tag).pre.length, 'RD_PRERELEASE_PROMOTION_DENIED');
  const release = await currentRelease();
  requireFact(!release.draft && !release.prerelease, 'RD_STABLE_RELEASE_REQUIRED');
  const latest = await api(`/repos/${repo}/releases/latest`);
  if (latest?.tag_name === tag) return;
  requireFact(!latest || compareVersions(tag, latest.tag_name) > 0, 'RD_STABLE_REGRESSION_DENIED');
  await api(`/repos/${repo}/releases/${release.id}`, 'PATCH', { make_latest: 'true' });
  requireFact((await api(`/repos/${repo}/releases/latest`))?.tag_name === tag, 'RD_STABLE_READBACK_FAILED');
}

if (process.argv[1]?.endsWith('release-lifecycle.mjs')) {
  try {
    requireFact(repo && tag && source && process.env.GH_TOKEN, 'RD_RELEASE_IDENTITY_REQUIRED');
    const action = { draft, upload, 'canonicalize-manifest': canonicalizeManifest, finalize, promote }[process.argv[2]];
    requireFact(action, 'RD_RELEASE_OPERATION_INVALID');
    await action(process.argv[3]);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
