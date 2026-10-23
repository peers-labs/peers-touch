import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DistributionError,
  androidVersionCode,
  loadFlavorRegistry,
  parseSemver,
  resolveDistribution,
} from "./flavors.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");
export const MANIFEST_SCHEMA_VERSION = 1;
export const MANIFEST_ENV_PREFIX = "PT_DIST_";

function git(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new DistributionError(
      "git_unavailable",
      `git ${args.join(" ")} failed: ${result.stderr.trim()}`,
    );
  }
  return result.stdout.trim();
}

export function readTauriVersion(repoRoot, product) {
  const configPath = path.join(
    repoRoot,
    "apps",
    product,
    "src-tauri",
    "tauri.conf.json",
  );
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new DistributionError(
      "tauri_config_invalid",
      `Cannot read ${configPath}: ${error.message}`,
    );
  }
  parseSemver(config.version);
  return config.version;
}

function sortedObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortedObject);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortedObject(value[key])]),
    );
  }
  return value;
}

export function canonicalManifestJson(manifest) {
  return `${JSON.stringify(sortedObject(manifest), null, 2)}\n`;
}

// Compose the authoritative build manifest. All inputs are already-derived
// identity plus git facts; this function performs no Tauri invocation.
export function buildManifest(input) {
  const repoRoot = input.repoRoot ?? REPO_ROOT;
  const registry = input.registry ?? loadFlavorRegistry();
  const identity = resolveDistribution(registry, {
    product: input.product,
    flavor: input.flavor,
    channel: input.channel,
    region: input.region,
    labels: input.labels,
  });
  const version = (
    input.version ?? readTauriVersion(repoRoot, identity.product)
  ).trim();
  parseSemver(version);
  const commit = (
    input.commit ?? git(repoRoot, ["rev-parse", "HEAD"])
  ).toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(commit)) {
    throw new DistributionError(
      "commit_invalid",
      `Invalid source commit: ${commit}`,
    );
  }
  const buildNumber = Number(
    input.buildNumber ?? git(repoRoot, ["rev-list", "--count", "HEAD"]),
  );
  if (!Number.isSafeInteger(buildNumber) || buildNumber <= 0) {
    throw new DistributionError(
      "build_number_invalid",
      `Invalid build number: ${buildNumber}`,
    );
  }
  return {
    schema_version: MANIFEST_SCHEMA_VERSION,
    product: identity.product,
    flavor: identity.flavor,
    channel: identity.channel,
    version,
    build_number: buildNumber,
    version_code: androidVersionCode(version),
    commit,
    identifier: identity.identifier,
    display_name: identity.displayName,
    deep_link_scheme: identity.deepLinkScheme,
    region: identity.region,
    labels: identity.labels,
    platform: input.platform ?? "",
    architecture: input.architecture ?? "",
    target: input.target ?? "",
    built_at_unix_ms: Date.now(),
  };
}

// PT_DIST_* environment consumed by src-tauri/build.rs rustc-env passthrough.
export function manifestEnvironment(manifest) {
  return {
    [`${MANIFEST_ENV_PREFIX}PRODUCT`]: manifest.product,
    [`${MANIFEST_ENV_PREFIX}FLAVOR`]: manifest.flavor,
    [`${MANIFEST_ENV_PREFIX}CHANNEL`]: manifest.channel,
    [`${MANIFEST_ENV_PREFIX}VERSION`]: manifest.version,
    [`${MANIFEST_ENV_PREFIX}BUILD_NUMBER`]: String(manifest.build_number),
    [`${MANIFEST_ENV_PREFIX}COMMIT`]: manifest.commit,
    [`${MANIFEST_ENV_PREFIX}IDENTIFIER`]: manifest.identifier,
    [`${MANIFEST_ENV_PREFIX}REGION`]: manifest.region,
    [`${MANIFEST_ENV_PREFIX}LABELS_JSON`]: JSON.stringify(
      sortedObject(manifest.labels),
    ),
  };
}

export function parseCliArguments(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new DistributionError(
        "cli_argument_invalid",
        `Unexpected argument: ${token}`,
      );
    }
    const key = token.slice(2);
    if (["help", "dry-run"].includes(key)) {
      args[key] = true;
    } else {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new DistributionError(
          "cli_argument_invalid",
          `Missing value for --${key}`,
        );
      }
      args[key] = value;
      index += 1;
    }
  }
  return args;
}
