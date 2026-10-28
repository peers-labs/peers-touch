import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sha256 } from './release-evidence-check.mjs';
import { parseVersion } from './release-version-check.mjs';

const required = (condition, code) => { if (!condition) throw new Error(code); };
export const INSTALL_ASSETS = ['install.sh', 'installer.py', 'installation_state.py', 'docker-compose.yml', 'station-release.json'];

export function checkManifest(manifest, { repo, tag, assets }) {
  required(manifest.version === parseVersion(tag).version, 'RD_MANIFEST_VERSION_MISMATCH');
  const prefix = `https://github.com/${repo}/releases/download/${tag}/`;
  for (const platform of ['windows-x86_64', 'linux-x86_64', 'darwin-x86_64', 'darwin-aarch64']) {
    const value = manifest.platforms?.[platform];
    required(value?.url?.startsWith(prefix) && value.signature, 'RD_MANIFEST_PLATFORM_MISSING');
    const name = decodeURIComponent(value.url.slice(prefix.length));
    required(/^[A-Za-z0-9_.-]+$/u.test(name) && assets.includes(name) && assets.includes(`${name}.sig`), 'RD_UPDATER_ASSET_MISSING');
    if (platform.startsWith('darwin')) required(name.endsWith('.app.tar.gz'), 'RD_MAC_UPDATER_FORMAT_INVALID');
  }
  required(manifest.platforms['darwin-x86_64'].url === manifest.platforms['darwin-aarch64'].url
    && manifest.platforms['darwin-x86_64'].signature === manifest.platforms['darwin-aarch64'].signature,
  'RD_UNIVERSAL_MANIFEST_MISMATCH');
}

export function createStationAssets({ root, output, tag, source, imageDigest, platforms }) {
  parseVersion(tag);
  required(/^[a-f0-9]{40}$/u.test(source) && /^sha256:[a-f0-9]{64}$/u.test(imageDigest), 'RD_BUILD_IDENTITY_INVALID');
  required(platforms.includes('linux/amd64') && platforms.includes('linux/arm64'), 'RD_IMAGE_PLATFORM_MISSING');
  fs.mkdirSync(output, { recursive: true });
  for (const name of INSTALL_ASSETS.filter((name) => name !== 'station-release.json')) {
    fs.copyFileSync(path.join(root, 'tooling/distribution', name), path.join(output, name));
  }
  const release = { tag, source, image: `ghcr.io/peers-labs/peers-touch-station@${imageDigest}`, postgresMajor: 16, platforms };
  fs.writeFileSync(path.join(output, 'station-release.json'), `${JSON.stringify(release, null, 2)}\n`);
  const checksums = INSTALL_ASSETS.map((name) => `${sha256(fs.readFileSync(path.join(output, name)))}  ${name}`).join('\n');
  fs.writeFileSync(path.join(output, 'checksums.txt'), `${checksums}\n`);
  return release;
}

export function scanAssets(directory) {
  for (const name of INSTALL_ASSETS) {
    const text = fs.readFileSync(path.join(directory, name), 'utf8');
    // Variable names and instructions are legal; concrete assignments are not.
    required(!/(?:PEERS_AUTH_SECRET|PEERS_DB_PASSWORD|PEERS_DASHBOARD_PASSWORD|PEERS_DASHBOARD_JWT_SECRET)\s*=\s*["']?[A-Za-z0-9+/]{16,}/u.test(text)
      && !/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(text)
      && !/\b(?:ghp_|github_pat_)[a-zA-Z0-9_]{20,}/u.test(text), 'RD_SECRET_LITERAL_FOUND');
  }
}

export function projectManifest(manifest, origin) {
  required(new URL(origin).protocol === 'https:', 'RD_CANDIDATE_HTTPS_REQUIRED');
  const projected = structuredClone(manifest);
  for (const value of Object.values(projected.platforms)) {
    value.url = `${origin.replace(/\/$/u, '')}/${new URL(value.url).pathname.split('/').pop()}`;
  }
  return projected;
}

if (process.argv[1]?.endsWith('release-assets.mjs')) {
  try {
    const output = process.argv[2];
    const inspect = JSON.parse(execFileSync('docker', ['buildx', 'imagetools', 'inspect', process.env.PT_RD_IMAGE, '--raw'], { encoding: 'utf8' }));
    createStationAssets({
      root: process.cwd(), output, tag: process.env.GITHUB_REF_NAME, source: process.env.GITHUB_SHA,
      imageDigest: process.env.PT_RD_IMAGE_DIGEST,
      platforms: inspect.manifests.map((entry) => `${entry.platform.os}/${entry.platform.architecture}`),
    });
    scanAssets(output);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
