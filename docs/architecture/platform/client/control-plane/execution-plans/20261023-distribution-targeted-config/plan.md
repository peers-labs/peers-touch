# Execution Plan — Distribution Identity And Targeted Directives

> **Date**: 2026-10-23
> **Decisions**: XCFG-D04, XCFG-D05
> **Status**: P0, P1, and the Desktop first-run auto-default are implemented on
> `chore/open-source-launch-prep` (uncommitted). The client owns an
> independent `meta` module (build identity, runtime region/environment,
> persistent stable id) consumed by X Config targeting and the Logs debug
> panel. P2 Station fetch/watermark, Mobile parity, and the Console editor
> remain.

## Scope

One distribution toolchain shared by Desktop and Mobile (no per-client
packaging chimneys), plus a closed directive section on the X Config snapshot.

## P0 — Distribution identity (no runtime behavior change)

- `tooling/distribution/flavors.json` — flavor registry (geek canonical,
  dev, partner flavors); identifier/scheme/channel/region/labels.
- `tooling/distribution/flavors.mjs` — registry load, validation, and
  deterministic identity derivation; unit tests (`node --test`).
- `tooling/distribution/build-manifest.mjs` — manifest builder: git commit,
  `git rev-list --count HEAD` build number, semver, labels, override config.
- `tooling/distribution/package.mjs` — one entrypoint for desktop and mobile;
  emits `build-manifest.json` + Tauri `--config` override, runs the existing
  Tauri build with `PT_DIST_*` environment.
- `tooling/make/distribution.mk` — `make package PRODUCT= FLAVOR= [CHANNEL=
  REGION= VERSION= LABELS= TARGET=]`, fail-closed.
- `packages/x-config-core`: `BuildIdentity` parse/validation plus an exported
  macro so each client contributes only `option_env!` call sites.
- Desktop/Mobile `build.rs`: passthrough `PT_DIST_*` via `rerun-if-env-changed`.
- System meta: expose parsed `buildIdentity` (Desktop system payload; Mobile
  build-identity surface), without changing the existing acceptance harness
  identity.
- Dev-install identity (`desktop-install.mjs` constants) becomes a view over
  the `dev` flavor entry — single registry, no second source.

Acceptance: `make package PRODUCT=desktop FLAVOR=geek` and
`FLAVOR=xx REGION=cn` produce correct identifier/name/scheme/version fields in
the generated override and manifest; unknown flavor/label exits non-zero;
manifest and override snapshots are deterministic.

## P1 — Directives

- Proto: add `Directive`, `DirectiveRule`, `TargetClause`, `DirectiveValue`,
  `VersionConstraint` messages and one new `directives` field on the existing
  `XConfigSnapshotStatement`. No version bump: `schema_version` stays 1 and
  the proto package name is unchanged; older clients ignore the new field.
- Catalog YAML + typed domain structs; key registry; admin Validate findings;
  publication builder wiring; size/rule limits.
- Rust evaluator in x-config-core; Desktop projection gains `defaults`;
  resolution reuses existing suggestion discovery.
- Shared evaluation conformance vectors consumed by Rust and Go tests.
- Targeting source of truth: channel comes from the baked
  `BuildIdentity.channel` (flavor registry), not a second config path.
  Snapshot endpoint resolution stays the existing single mechanism —
  canonical default URL constant, overridable by compile-time then runtime
  `PEERS_X_CONFIG_URL`; every package consumes x-config identically and there
  is no embedded-vs-service packaging fork (embedded snapshot remains an
  offline bootstrap/test mechanism only).

## P2 — Station

- `apps/station/frame/touch/xcontrol`: fetch, verify, watermark, evaluate;
  Go build identity via embedded manifest; outbound default relay
  consumption only (Station does not consume `network.default_station`).

## P3 — Mobile directive consumption parity and Console directive editor.

## Rollout state — 2026-10-23

- P0/P1 shipped behind field 8; conformance vectors shared by Rust and Go.
- corpstable channel live: x-config service on fiveArm
  (`http://10.37.221.38:18082`) with the corpstable publisher key,
  GitHub CAS sequence 1, and a `network.default_relay` directive
  (`cn-xx` rule, shared fallback).
- Operator login across private HTTP required symmetric gateway work:
  broker multi-site operator config with flag-gated private-IP callbacks
  (`OAUTH_OPERATOR_LOGIN_CORPSTABLE_*`), and x-config request-time URL
  gating plus origin-derived cookie `Secure` flags.
- Operational follow-up: publication validates seeds against a one-hour
  statement window, so standing channel catalogs need periodic
  re-publication automation; the corpstable host reaches the Home relay
  over IPv6 only, so its Compose network enables IPv6/NAT66.
