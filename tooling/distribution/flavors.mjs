import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Distribution flavor registry — single source for build identity and OS
// install identity across Desktop and Mobile. See XCFG-D05.
// Channel bootstrap origins live in channels.json (XCFG-D06).

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REGISTRY_PATH = path.join(HERE, "flavors.json");
export const DEFAULT_CHANNEL_REGISTRY_PATH = path.join(HERE, "channels.json");

export const PRODUCTS = ["desktop", "mobile"];
export const DEFAULT_CHANNEL = "stable";

const SUFFIX_PATTERN = /^[a-z0-9]{1,16}$/u;
const FLAVOR_PATTERN = /^[a-z0-9]{1,24}$/u;
const CHANNEL_PATTERN = /^[a-z0-9-]{1,32}$/u;
const REGION_PATTERN = /^[a-z]{2}(?:-[a-z0-9]{1,16})?$/u;
const LABEL_KEY_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/u;
const LABEL_VALUE_PATTERN = /^[A-Za-z0-9._-]{1,32}$/u;

export class DistributionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DistributionError";
    this.code = code;
    this.details = details;
  }
}

export function loadFlavorRegistry(registryPath = DEFAULT_REGISTRY_PATH) {
  let raw;
  try {
    raw = fs.readFileSync(registryPath, "utf8");
  } catch {
    throw new DistributionError(
      "flavor_registry_missing",
      `Distribution flavor registry not found: ${registryPath}`,
    );
  }
  let registry;
  try {
    registry = JSON.parse(raw);
  } catch {
    throw new DistributionError(
      "flavor_registry_invalid",
      "Flavor registry is not valid JSON",
    );
  }
  validateRegistry(registry);
  return registry;
}

export function validateRegistry(registry) {
  if (
    !registry ||
    registry.schema_version !== 1 ||
    typeof registry.flavors !== "object"
  ) {
    throw new DistributionError(
      "flavor_registry_invalid",
      "Unsupported flavor registry schema",
    );
  }
  const names = Object.keys(registry.flavors);
  if (names.length === 0) {
    throw new DistributionError(
      "flavor_registry_invalid",
      "At least one flavor is required",
    );
  }
  for (const [name, flavor] of Object.entries(registry.flavors)) {
    if (!FLAVOR_PATTERN.test(name)) {
      throw new DistributionError(
        "flavor_name_invalid",
        `Invalid flavor name: ${name}`,
      );
    }
    if (
      typeof flavor.display_name !== "string" ||
      !flavor.display_name.trim()
    ) {
      throw new DistributionError(
        "flavor_registry_invalid",
        `Flavor ${name} needs display_name`,
      );
    }
    validateOptionalSuffix(flavor.identifier_suffix, name, "identifier_suffix");
    validateOptionalSuffix(flavor.url_scheme_suffix, name, "url_scheme_suffix");
    if (
      (flavor.identifier_suffix === null) !==
      (flavor.url_scheme_suffix === null)
    ) {
      throw new DistributionError(
        "flavor_registry_invalid",
        `Flavor ${name} must define identifier and URL suffixes together`,
      );
    }
    if (
      typeof flavor.default_channel !== "string" ||
      !CHANNEL_PATTERN.test(flavor.default_channel)
    ) {
      throw new DistributionError(
        "flavor_registry_invalid",
        `Flavor ${name} has invalid default_channel`,
      );
    }
    if (
      flavor.default_region !== "" &&
      (typeof flavor.default_region !== "string" ||
        !REGION_PATTERN.test(flavor.default_region))
    ) {
      throw new DistributionError(
        "flavor_registry_invalid",
        `Flavor ${name} has invalid default_region`,
      );
    }
    if (
      !Array.isArray(flavor.allowed_labels) ||
      flavor.allowed_labels.some(
        (label) => typeof label !== "string" || !LABEL_KEY_PATTERN.test(label),
      )
    ) {
      throw new DistributionError(
        "flavor_registry_invalid",
        `Flavor ${name} has invalid allowed_labels`,
      );
    }
  }
  const suffixOwners = new Map();
  for (const [name, flavor] of Object.entries(registry.flavors)) {
    if (flavor.identifier_suffix) {
      const owner = suffixOwners.get(flavor.identifier_suffix);
      if (owner) {
        throw new DistributionError(
          "flavor_registry_invalid",
          `Duplicate identifier suffix ${flavor.identifier_suffix}: ${owner} / ${name}`,
        );
      }
      suffixOwners.set(flavor.identifier_suffix, name);
    }
  }
  const canonical = names.filter(
    (name) => registry.flavors[name].identifier_suffix === null,
  );
  if (canonical.length > 1) {
    throw new DistributionError(
      "flavor_registry_invalid",
      `Only one canonical flavor is allowed, found: ${canonical.join(", ")}`,
    );
  }
}

function validateOptionalSuffix(value, flavorName, field) {
  if (
    value !== null &&
    (typeof value !== "string" || !SUFFIX_PATTERN.test(value))
  ) {
    throw new DistributionError(
      "flavor_registry_invalid",
      `Flavor ${flavorName} has invalid ${field}`,
    );
  }
}

// Parse "dist.audience=geek,dist.partner=xx" into a sorted object. Every key
// must be allowlisted by the flavor. Unknown labels fail closed.
export function parseLabels(raw, allowedLabels, flavor) {
  const labels = {};
  const text = (raw ?? "").trim();
  if (text === "") {
    return labels;
  }
  for (const pair of text.split(",")) {
    const fragment = pair.trim();
    if (!fragment) {
      throw new DistributionError(
        "label_invalid",
        "Empty distribution label entry",
      );
    }
    const equals = fragment.indexOf("=");
    if (equals <= 0 || equals === fragment.length - 1) {
      throw new DistributionError(
        "label_invalid",
        `Distribution label must be key=value: ${fragment}`,
      );
    }
    const key = fragment.slice(0, equals).trim();
    const value = fragment.slice(equals + 1).trim();
    if (!LABEL_KEY_PATTERN.test(key) || !LABEL_VALUE_PATTERN.test(value)) {
      throw new DistributionError(
        "label_invalid",
        `Malformed distribution label: ${fragment}`,
      );
    }
    if (!allowedLabels.includes(key)) {
      throw new DistributionError(
        "label_not_allowed",
        `Label ${key} is not allowed for flavor ${flavor}`,
        { allowed: allowedLabels },
      );
    }
    labels[key] = value;
  }
  return labels;
}

// Derive the full distribution identity for one product/flavor combination.
export function resolveDistribution(registry, input) {
  const product = input.product;
  if (!PRODUCTS.includes(product)) {
    throw new DistributionError(
      "product_unsupported",
      `Unsupported product: ${String(product)} (expected ${PRODUCTS.join(" | ")})`,
    );
  }
  const flavorName = input.flavor;
  const flavor = registry.flavors[flavorName];
  if (!flavor) {
    throw new DistributionError(
      "flavor_unknown",
      `Unknown distribution flavor: ${String(flavorName)}`,
      { known: Object.keys(registry.flavors) },
    );
  }
  const channel = (input.channel ?? flavor.default_channel).trim();
  if (!CHANNEL_PATTERN.test(channel)) {
    throw new DistributionError(
      "channel_invalid",
      `Invalid distribution channel: ${channel}`,
    );
  }
  const region = (input.region ?? flavor.default_region ?? "").trim();
  if (region !== "" && !REGION_PATTERN.test(region)) {
    throw new DistributionError("region_invalid", `Invalid region: ${region}`);
  }
  const labels = parseLabels(input.labels, flavor.allowed_labels, flavorName);
  const identifier = flavor.identifier_suffix
    ? `com.peers.touch.${product}.${flavor.identifier_suffix}`
    : `com.peers.touch.${product}`;
  const deepLinkScheme = flavor.url_scheme_suffix
    ? `peers-touch-${flavor.url_scheme_suffix}`
    : "peers-touch";
  return {
    product,
    flavor: flavorName,
    displayName: flavor.display_name,
    identifier,
    deepLinkScheme,
    channel,
    region,
    labels,
  };
}

// Strict X.Y.Z with optional -prerelease / +build. Returns parsed parts.
export function parseSemver(version) {
  const match =
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/u.exec(
      String(version ?? "").trim(),
    );
  if (!match) {
    throw new DistributionError(
      "version_invalid",
      `Not a semantic version: ${version}`,
    );
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? "",
    build: match[5] ?? "",
  };
}

// Tauri/Android default version-code formula. Used when no external monotonic
// build number is supplied. Maximum is the Play Store 2,100,000,000 ceiling.
export function androidVersionCode(version) {
  const parts = parseSemver(version);
  const code = parts.major * 1_000_000 + parts.minor * 1_000 + parts.patch;
  if (code > 2_100_000_000) {
    throw new DistributionError(
      "version_code_invalid",
      `Android version code exceeds limit: ${code}`,
    );
  }
  return code;
}

// Channel bootstrap-origin registry (XCFG-D06). Baked origins let packaged
// clients fetch the first signed snapshot without any environment variable;
// later snapshots may advertise additional origins for failover/migration.

export const MAX_CHANNEL_ORIGINS = 4;
const MAX_DISTRIBUTION_ORIGIN_CH = 512;
const IPV4_OCTET_PATTERN = /^(?:0|[1-9][0-9]{0,2})$/u;

export function loadChannelRegistry(registryPath = DEFAULT_CHANNEL_REGISTRY_PATH) {
  let raw;
  try {
    raw = fs.readFileSync(registryPath, "utf8");
  } catch {
    throw new DistributionError(
      "channel_registry_missing",
      `Distribution channel registry not found: ${registryPath}`,
    );
  }
  let registry;
  try {
    registry = JSON.parse(raw);
  } catch {
    throw new DistributionError(
      "channel_registry_invalid",
      "Channel registry is not valid JSON",
    );
  }
  validateChannelRegistry(registry);
  return registry;
}

export function validateChannelRegistry(registry) {
  if (
    !registry ||
    registry.schema_version !== 1 ||
    typeof registry.channels !== "object"
  ) {
    throw new DistributionError(
      "channel_registry_invalid",
      "Unsupported channel registry schema",
    );
  }
  const names = Object.keys(registry.channels);
  if (names.length === 0) {
    throw new DistributionError(
      "channel_registry_invalid",
      "At least one channel is required",
    );
  }
  for (const [name, channel] of Object.entries(registry.channels)) {
    if (!CHANNEL_PATTERN.test(name)) {
      throw new DistributionError(
        "channel_name_invalid",
        `Invalid channel name: ${name}`,
      );
    }
    if (
      !Array.isArray(channel.bootstrap_origins) ||
      channel.bootstrap_origins.length === 0 ||
      channel.bootstrap_origins.length > MAX_CHANNEL_ORIGINS
    ) {
      throw new DistributionError(
        "channel_registry_invalid",
        `Channel ${name} requires 1..${MAX_CHANNEL_ORIGINS} bootstrap_origins`,
      );
    }
    const seen = new Set();
    for (const raw of channel.bootstrap_origins) {
      const origin = admitDistributionOrigin(raw, name);
      if (seen.has(origin)) {
        throw new DistributionError(
          "channel_registry_invalid",
          `Channel ${name} lists duplicate origin: ${origin}`,
        );
      }
      seen.add(origin);
    }
  }
}

// Resolve the baked bootstrap origins for a resolved channel name. Re-admits
// every entry so registries injected by tests or future callers fail closed.
export function resolveChannelOrigins(channelRegistry, channel) {
  const entry = channelRegistry?.channels?.[channel];
  if (!entry) {
    throw new DistributionError(
      "channel_unknown",
      `No bootstrap origins registered for channel: ${channel}`,
      { known: Object.keys(channelRegistry?.channels ?? {}) },
    );
  }
  return entry.bootstrap_origins.map((raw) => admitDistributionOrigin(raw, channel));
}

// Admission policy for a bare snapshot base URL. Mirrors
// x-config-core::origin::valid_snapshot_origin and the x-config publisher's
// canonicalDistributionOrigin: HTTPS for any host; plain HTTP only for IPv4
// loopback/RFC1918/link-local literals or IPv6 ::1; no path, query, fragment,
// or credentials. Returns the canonical origin (no trailing slash).
export function admitDistributionOrigin(raw, channel = "") {
  const text = String(raw ?? "").trim();
  const scope = channel ? ` in channel ${channel}` : "";
  const reject = () =>
    new DistributionError(
      "distribution_origin_invalid",
      `Invalid x-config distribution origin${scope}: ${String(raw)}`,
    );
  if (text.length === 0 || text.length > MAX_DISTRIBUTION_ORIGIN_CH) {
    throw reject();
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    throw reject();
  }
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.pathname !== "/" ||
    url.hostname === ""
  ) {
    throw reject();
  }
  if (url.protocol === "https:") {
    return url.origin;
  }
  if (url.protocol !== "http:") {
    throw reject();
  }
  const octets = parsePrivateIpv4(url.hostname);
  const privateIPv4 = octets !== null && admittedPrivateIPv4(octets);
  const loopbackIPv6 = url.hostname === "[::1]";
  if (!privateIPv4 && !loopbackIPv6) {
    throw reject();
  }
  return url.origin;
}

// Strict dotted-quad parse: WHATWG URL accepts exotic IPv4 spellings, so the
// hostname text itself must be a canonical quad before private-range checks.
function parsePrivateIpv4(host) {
  const parts = host.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const octets = [];
  for (const part of parts) {
    if (!IPV4_OCTET_PATTERN.test(part)) {
      return null;
    }
    const value = Number(part);
    if (value > 255) {
      return null;
    }
    octets.push(value);
  }
  return octets;
}

function admittedPrivateIPv4([first, second]) {
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}
