import { spawnSync } from 'node:child_process';

// Restricted-network registries (e.g. hub.byted.org) proxy Docker Hub but some
// fail to serve OCI indexes by digest: `pull repo:tag` resolves the index
// digest and then 404s copying it. Pulling the architecture-specific child
// manifest by its digest and retagging works around that proxy behaviour.

// Images Station compose/build need, kept in lockstep with compose.yml and
// the PEERS_STATION_BUILDER_IMAGE/BASE_IMAGE defaults written to .env.
export const STATION_IMAGES = [
  { repository: 'pgvector/pgvector', tag: 'pg16' },
  { repository: 'library/golang', tag: '1.24' },
  { repository: 'library/ubuntu', tag: '22.04' },
];

const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function localImageExists(image) {
  return docker(['image', 'inspect', image]).status === 0;
}

async function fetchManifest(registry, repository, tag) {
  const url = `https://${registry}/v2/${repository}/manifests/${tag}`;
  const response = await fetch(url, { headers: { Accept: MANIFEST_ACCEPT } });
  if (!response.ok) {
    throw new Error(`GET ${url} -> ${response.status}`);
  }
  return response.json();
}

function childDigestForArch(manifest, architecture) {
  const match = manifest.manifests?.find((entry) => {
    const platform = entry.platform ?? {};
    return platform.os === 'linux' && platform.architecture === architecture;
  });
  return match?.digest;
}

async function mirrorOne(registry, image, architecture) {
  const tagged = `${registry}/${image.repository}:${image.tag}`;
  if (localImageExists(tagged)) {
    return { image: tagged, action: 'cached' };
  }

  const manifest = await fetchManifest(registry, image.repository, image.tag);
  const digest = childDigestForArch(manifest, architecture);
  if (digest) {
    const digestRef = `${registry}/${image.repository}@${digest}`;
    const pull = docker(['pull', digestRef]);
    if (pull.status !== 0) {
      throw new Error(`docker pull ${digestRef}: ${pull.stderr.trim()}`);
    }
    const tag = docker(['tag', digestRef, tagged]);
    if (tag.status !== 0) {
      throw new Error(`docker tag ${digestRef} ${tagged}: ${tag.stderr.trim()}`);
    }
    return { image: tagged, action: 'mirrored', digest };
  }

  const pull = docker(['pull', tagged]);
  if (pull.status !== 0) {
    throw new Error(`docker pull ${tagged}: ${pull.stderr.trim()}`);
  }
  return { image: tagged, action: 'pulled' };
}

// options: { architecture, log }
export async function ensureRegistryImages(registry, options = {}) {
  if (!registry) return [];
  const architecture = options.architecture
    ?? (process.arch === 'arm64' ? 'arm64' : 'amd64');
  const log = options.log ?? (() => {});
  const results = [];
  for (const image of STATION_IMAGES) {
    const result = await mirrorOne(registry, image, architecture);
    log(`${result.action}: ${result.image}`);
    results.push(result);
  }
  return results;
}
