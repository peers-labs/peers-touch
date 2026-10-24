import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  DistributionError,
  loadChannelRegistry,
  loadFlavorRegistry,
} from "./flavors.mjs";
import {
  REPO_ROOT,
  buildManifest,
  canonicalManifestJson,
  manifestEnvironment,
  parseCliArguments,
} from "./build-manifest.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILD_ROOT = path.join(HERE, "build");

const DESKTOP_BUNDLES = new Set([
  "app",
  "dmg",
  "msi",
  "nsis",
  "appimage",
  "deb",
  "rpm",
  "all",
]);

function readTauriConfig(product) {
  const configPath = path.join(
    REPO_ROOT,
    "apps",
    product,
    "src-tauri",
    "tauri.conf.json",
  );
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

function rewriteMobileDeepLinks(entries, scheme) {
  return entries.map((entry) => ({
    ...entry,
    scheme: (entry.scheme ?? []).map((value) =>
      value === "peers-touch" ? scheme : value,
    ),
  }));
}

export function tauriOverride(product, target, manifest) {
  const committed = readTauriConfig(product);
  const override = {
    identifier: manifest.identifier,
    productName: manifest.display_name,
    version: manifest.version,
  };
  if (product === "desktop") {
    override.plugins = {
      "deep-link": { desktop: { schemes: [manifest.deep_link_scheme] } },
    };
    const resources = { ...(committed.bundle?.resources ?? {}) };
    // Sidecar manifest — compile-time copy remains authoritative; this is for
    // diagnostics from an installed bundle. Resource paths are resolved
    // relative to src-tauri, like the committed locales resource.
    const manifestSource = path
      .relative(
        path.join(REPO_ROOT, "apps", "desktop", "src-tauri"),
        path.join(BUILD_ROOT, productManifestName(manifest)),
      )
      .split(path.sep)
      .join("/");
    resources[manifestSource] = "build-manifest.json";
    override.bundle = { resources };
    return override;
  }
  const mobileDeepLinks = committed.plugins?.["deep-link"]?.mobile ?? [];
  override.plugins = {
    "deep-link": {
      mobile: rewriteMobileDeepLinks(
        mobileDeepLinks,
        manifest.deep_link_scheme,
      ),
    },
  };
  if (target.startsWith("android")) {
    override.bundle = { android: { versionCode: manifest.build_number } };
  }
  return override;
}

function productManifestName(manifest) {
  return `${manifest.product}-${manifest.flavor}-build-manifest.json`;
}

function buildCommand(product, target, overridePath) {
  if (product === "desktop") {
    const bundle = target || "all";
    if (!DESKTOP_BUNDLES.has(bundle)) {
      throw new DistributionError(
        "target_unsupported",
        `Unsupported desktop target: ${bundle}`,
      );
    }
    return {
      cwd: path.join(REPO_ROOT, "apps", "desktop"),
      args: [
        "exec",
        "tauri",
        "build",
        ...(bundle === "all" ? [] : ["--bundles", bundle]),
        "--config",
        overridePath,
      ],
    };
  }
  if (target === "android-apk" || target === "android-aab") {
    const flag = target === "android-apk" ? "--apk" : "--aab";
    return {
      cwd: path.join(REPO_ROOT, "apps", "mobile"),
      args: [
        "exec",
        "tauri",
        "android",
        "build",
        flag,
        "--config",
        overridePath,
      ],
    };
  }
  if (target === "ios") {
    return {
      cwd: path.join(REPO_ROOT, "apps", "mobile"),
      args: ["exec", "tauri", "ios", "build", "--config", overridePath],
    };
  }
  throw new DistributionError(
    "target_unsupported",
    `Mobile target must be android-apk | android-aab | ios, got: ${target || "<empty>"}`,
  );
}

function writeBuildArtifacts(manifest, override) {
  fs.mkdirSync(BUILD_ROOT, { recursive: true });
  const manifestName = productManifestName(manifest);
  const manifestPath = path.join(BUILD_ROOT, manifestName);
  const overridePath = path.join(
    BUILD_ROOT,
    `${manifest.product}-${manifest.flavor}-tauri-override.json`,
  );
  fs.writeFileSync(manifestPath, canonicalManifestJson(manifest));
  fs.writeFileSync(overridePath, `${JSON.stringify(override, null, 2)}\n`);
  return { manifestPath, overridePath };
}

export function packageDistribution(options) {
  const product = options.product;
  const flavor = options.flavor;
  if (!product || !flavor) {
    throw new DistributionError(
      "arguments_missing",
      "make package requires PRODUCT and FLAVOR, e.g. make package PRODUCT=desktop FLAVOR=geek",
    );
  }
  const target =
    options.target ?? (product === "desktop" ? "all" : "android-apk");
  const manifest = buildManifest({
    product,
    flavor,
    channel: options.channel,
    region: options.region,
    version: options.version,
    labels: options.labels,
    platform: options.platform ?? "",
    architecture: options.architecture ?? "",
    target,
    registry: loadFlavorRegistry(),
    channels: loadChannelRegistry(),
  });
  const override = tauriOverride(product, target, manifest);
  const { manifestPath, overridePath } = writeBuildArtifacts(
    manifest,
    override,
  );
  const command = buildCommand(product, target, overridePath);
  return { manifest, manifestPath, overridePath, command };
}

function main() {
  const args = parseCliArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      "Usage: make package PRODUCT=<desktop|mobile> FLAVOR=<name> " +
        "[TARGET=...] [CHANNEL=...] [REGION=...] [VERSION=...] [LABELS=k=v,...]\n",
    );
    return;
  }
  const plan = packageDistribution({
    product: args.product,
    flavor: args.flavor,
    target: args.target,
    channel: args.channel,
    region: args.region,
    version: args.version,
    labels: args.labels,
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        manifest: plan.manifest,
        environment: manifestEnvironment(plan.manifest),
        manifestPath: plan.manifestPath,
        overridePath: plan.overridePath,
        command: { cwd: plan.command.cwd, args: plan.command.args },
      },
      null,
      2,
    )}\n`,
  );
  if (args["dry-run"]) {
    return;
  }
  const result = spawnSync("pnpm", plan.command.args, {
    cwd: plan.command.cwd,
    stdio: "inherit",
    env: { ...process.env, ...manifestEnvironment(plan.manifest) },
  });
  if (result.error) {
    throw result.error;
  }
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    if (error instanceof DistributionError) {
      process.stderr.write(`distribution_${error.code}: ${error.message}\n`);
      process.exit(2);
    }
    throw error;
  }
}
