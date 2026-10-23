import assert from "node:assert/strict";
import test from "node:test";

import {
  DistributionError,
  admitDistributionOrigin,
  androidVersionCode,
  loadChannelRegistry,
  loadFlavorRegistry,
  parseLabels,
  parseSemver,
  resolveChannelOrigins,
  resolveDistribution,
  validateChannelRegistry,
  validateRegistry,
} from "./flavors.mjs";
import { buildManifest, manifestEnvironment } from "./build-manifest.mjs";
import { tauriOverride } from "./package.mjs";

const registry = loadFlavorRegistry();
const channels = loadChannelRegistry();
const COMMIT = "a".repeat(40);

test("registry is internally consistent", () => {
  assert.doesNotThrow(() => validateRegistry(registry));
});

test("canonical flavor owns suffix-less identity", () => {
  const desktop = resolveDistribution(registry, {
    product: "desktop",
    flavor: "geek",
  });
  assert.equal(desktop.identifier, "com.peers.touch.desktop");
  assert.equal(desktop.deepLinkScheme, "peers-touch");
  assert.equal(desktop.displayName, "Peers");
  const mobile = resolveDistribution(registry, {
    product: "mobile",
    flavor: "geek",
  });
  assert.equal(mobile.identifier, "com.peers.touch.mobile");
});

test("suffixed flavors derive coexistence identity and scheme", () => {
  const dev = resolveDistribution(registry, {
    product: "desktop",
    flavor: "dev",
  });
  assert.equal(dev.identifier, "com.peers.touch.desktop.dev");
  assert.equal(dev.deepLinkScheme, "peers-touch-dev");
  const xx = resolveDistribution(registry, { product: "mobile", flavor: "xx" });
  assert.equal(xx.identifier, "com.peers.touch.mobile.xx");
  assert.equal(xx.region, "cn");
});

test("explicit channel/region override flavor defaults", () => {
  const beta = resolveDistribution(registry, {
    product: "desktop",
    flavor: "xx",
    channel: "beta",
    region: "sg",
  });
  assert.equal(beta.channel, "beta");
  assert.equal(beta.region, "sg");
});

test("unknown product/flavor fail closed", () => {
  assert.throws(
    () => resolveDistribution(registry, { product: "web", flavor: "geek" }),
    DistributionError,
  );
  assert.throws(
    () =>
      resolveDistribution(registry, { product: "desktop", flavor: "internal" }),
    DistributionError,
  );
});

test("invalid channel and region are rejected", () => {
  assert.throws(
    () =>
      resolveDistribution(registry, {
        product: "desktop",
        flavor: "geek",
        channel: "NO!",
      }),
    DistributionError,
  );
  assert.throws(
    () =>
      resolveDistribution(registry, {
        product: "desktop",
        flavor: "geek",
        region: "china",
      }),
    DistributionError,
  );
});

test("label allowlist enforced per flavor", () => {
  assert.deepEqual(
    parseLabels("dist.audience=geek", registry.flavors.xx.allowed_labels, "xx"),
    { "dist.audience": "geek" },
  );
  assert.throws(
    () =>
      parseLabels(
        "dist.secret=x",
        registry.flavors.geek.allowed_labels,
        "geek",
      ),
    DistributionError,
  );
  assert.throws(
    () =>
      parseLabels(
        "dist.partner=y",
        registry.flavors.geek.allowed_labels,
        "geek",
      ),
    DistributionError,
  );
});

test("semver and android version code formula", () => {
  const parsed = parseSemver("1.2.3-rc.1");
  assert.equal(parsed.major, 1);
  assert.equal(parsed.minor, 2);
  assert.equal(parsed.patch, 3);
  assert.equal(parsed.prerelease, "rc.1");
  assert.equal(androidVersionCode("1.2.3"), 1_002_003);
  assert.throws(() => parseSemver("1.2"), DistributionError);
});

test("build manifest carries complete targeting identity", () => {
  const manifest = buildManifest({
    product: "desktop",
    flavor: "xx",
    region: "cn",
    version: "0.2.0",
    commit: COMMIT,
    buildNumber: 4321,
  });
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.identifier, "com.peers.touch.desktop.xx");
  assert.equal(manifest.deep_link_scheme, "peers-touch-xx");
  assert.equal(manifest.commit, COMMIT);
  assert.equal(manifest.build_number, 4321);
  assert.equal(manifest.version_code, 2_000);
  const env = manifestEnvironment(manifest);
  assert.equal(env.PT_DIST_FLAVOR, "xx");
  assert.equal(env.PT_DIST_COMMIT, COMMIT);
  assert.deepEqual(manifest.x_config_origins, [
    "https://xconfig.peers.shux.me:28443",
  ]);
  assert.equal(env.PT_DIST_X_CONFIG_URLS, "https://xconfig.peers.shux.me:28443");
});

test("corpstable channel bakes the corp HTTP origin without an env override", () => {
  const manifest = buildManifest({
    product: "desktop",
    flavor: "xx",
    channel: "corpstable",
    version: "0.2.0",
    commit: COMMIT,
    buildNumber: 4321,
  });
  assert.deepEqual(manifest.x_config_origins, ["http://10.37.221.38:18082"]);
  const env = manifestEnvironment(manifest);
  assert.equal(env.PT_DIST_X_CONFIG_URLS, "http://10.37.221.38:18082");
});

test("unknown channel fails closed instead of baking empty origins", () => {
  assert.throws(
    () =>
      buildManifest({
        product: "desktop",
        flavor: "geek",
        channel: "unshipped",
        version: "0.2.0",
        commit: COMMIT,
        buildNumber: 1,
      }),
    { code: "channel_unknown" },
  );
  assert.throws(
    () => resolveChannelOrigins(channels, "unshipped"),
    { code: "channel_unknown" },
  );
});

test("channel registry is internally consistent", () => {
  assert.doesNotThrow(() => validateChannelRegistry(channels));
  assert.deepEqual(resolveChannelOrigins(channels, "stable"), [
    "https://xconfig.peers.shux.me:28443",
  ]);
});

test("origin admission accepts https hosts and private IPv4/loopback http", () => {
  assert.equal(
    admitDistributionOrigin("https://xconfig.example.test:28443"),
    "https://xconfig.example.test:28443",
  );
  assert.equal(
    admitDistributionOrigin("http://10.37.221.38:18082/"),
    "http://10.37.221.38:18082",
  );
  for (const origin of [
    "http://127.0.0.1:9000",
    "http://172.16.4.2",
    "http://192.168.1.10",
    "http://169.254.1.1",
    "http://[::1]:8080",
  ]) {
    assert.equal(admitDistributionOrigin(origin), origin);
  }
});

test("origin admission rejects public http, non-IP hosts, paths, and credentials", () => {
  const invalid = [
    "http://xconfig.example.test",
    "http://localhost:8080",
    "http://8.8.8.8:8080",
    "http://[fd00::1]:8080",
    "https://x.test/channels/stable/latest.pb",
    "https://x.test?channel=stable",
    "https://x.test#frag",
    "https://user:pass@x.test",
    "ftp://x.test",
    "10.37.221.38:18082",
    "",
    "   ",
  ];
  for (const raw of invalid) {
    assert.throws(
      () => admitDistributionOrigin(raw),
      { code: "distribution_origin_invalid" },
      `expected rejection for ${raw}`,
    );
  }
});

test("channel registry validation rejects malformed and oversized channels", () => {
  assert.throws(
    () =>
      validateChannelRegistry({
        schema_version: 1,
        channels: { bad: { bootstrap_origins: [] } },
      }),
    { code: "channel_registry_invalid" },
  );
  assert.throws(
    () =>
      validateChannelRegistry({
        schema_version: 1,
        channels: {
          stable: {
            bootstrap_origins: [
              "https://a.test",
              "https://b.test",
              "https://c.test",
              "https://d.test",
              "https://e.test",
            ],
          },
        },
      }),
    { code: "channel_registry_invalid" },
  );
  assert.throws(
    () =>
      validateChannelRegistry({
        schema_version: 1,
        channels: {
          stable: {
            bootstrap_origins: ["http://corp.internal.example.test"],
          },
        },
      }),
    { code: "distribution_origin_invalid" },
  );
  assert.throws(
    () =>
      validateChannelRegistry({
        schema_version: 1,
        channels: {
          stable: { bootstrap_origins: ["https://x.test", "https://x.test/"] },
        },
      }),
    { code: "channel_registry_invalid" },
  );
  assert.throws(
    () =>
      validateChannelRegistry({ schema_version: 2, channels: {} }),
    { code: "channel_registry_invalid" },
  );
});

test("desktop tauri override rewrites identity, scheme, and sidecar", () => {
  const manifest = buildManifest({
    product: "desktop",
    flavor: "xx",
    version: "0.2.0",
    commit: COMMIT,
    buildNumber: 10,
  });
  const override = tauriOverride("desktop", "dmg", manifest);
  assert.equal(override.identifier, "com.peers.touch.desktop.xx");
  assert.equal(override.productName, "Peers XX");
  assert.deepEqual(override.plugins["deep-link"].desktop.schemes, [
    "peers-touch-xx",
  ]);
  assert.ok(override.bundle.resources["i18n/"] === undefined);
  assert.ok(
    Object.values(override.bundle.resources).includes("build-manifest.json"),
  );
  assert.ok(
    Object.keys(override.bundle.resources).some((source) =>
      source.endsWith("desktop-xx-build-manifest.json"),
    ),
  );
});

test("mobile override preserves oauth host/path and maps android version code", () => {
  const manifest = buildManifest({
    product: "mobile",
    flavor: "xx",
    version: "0.2.0",
    commit: COMMIT,
    buildNumber: 10,
  });
  const override = tauriOverride("mobile", "android-apk", manifest);
  const [oauth] = override.plugins["deep-link"].mobile;
  assert.deepEqual(oauth.scheme, ["peers-touch-xx"]);
  assert.equal(oauth.host, "oauth");
  assert.deepEqual(oauth.path, ["/callback"]);
  assert.equal(override.bundle.android.versionCode, 10);
});
