# Applet Capability Completion Plan

> **Status**: active
> **Date**: 2026-06-23
> **Owner**: Architecture Team
> **Supersedes**:
> - `2026-06-06-applet-runtime-formalization.md`
> - `2026-06-06-complex-applet-implementation-plan.md`
> - `2026-06-17-note-official-applet-implementation-plan.md`
>
> The superseded documents remain historical inputs and evidence references. New
> applet implementation work must use this document as the task-level execution
> source unless the user explicitly chooses a different source of truth.

---

## 1. Goal

Finish Peers-Touch applet capability as a usable product platform, not just a
bundle loader or local demo.

Target readiness:

```text
L5 COMPLEX_PLATFORM_READY
```

This means:

- Desktop can run official and third-party conforming applet packages through
  Lynx, SDK, Bridge, Gateway, policy, audit, and product shell.
- Note is a complete official applet product path, not a minimum smoke fixture.
- Applet Box uses Station-backed install/catalog state, not only local
  preferences.
- Third-party packages can be validated, installed, launched, revoked, and
  audited without referencing producer source layout.
- Web and Mobile hosts are contract-compatible with Desktop.
- Every readiness claim is backed by gates and evidence, not by narrative.

## 2. Current Baseline

The previous plans produced strong partial evidence:

| Area | Current baseline | Status for this plan |
|------|------------------|----------------------|
| Desktop Note runtime | `peers.note` loads through real Desktop Lynx path and live smoke evidence exists | Treat as baseline, keep regression gate |
| Complex Desktop candidate | Contract/SDK/Gateway/Desktop gates exist for repo fixtures and synthetic repo-external package | Treat as candidate, not release-complete |
| Applet Box | Local installed/catalog state exists in Desktop preferences | Replace with Station-backed model |
| Note frontend | Minimum list/create/search/delete flow exists | Complete product scope |
| Station Store | Architecture documented, not product-closed | Implement |
| Third-party certification | Synthetic external package gate exists | Replace with real third-party certification |
| Manual user acceptance | Not complete | Required before release claim |
| Web/Mobile parity | Runtime/marker evidence exists, still needs product hardening | Harden and gate |

## 3. Non-Negotiable Boundaries

- Applet business code uses `@peers-touch/applet-sdk`; it must not call Desktop,
  Mobile, Station, Tauri, native APIs, browser privileged APIs, raw backend URLs,
  or `window.parent.postMessage` as the integrated bridge.
- Host reads package contract only: manifest, entries, integrity, assets, policy,
  services, permissions, and declarations.
- Station Store owns package distribution, version, policy, install state, revoke,
  rollback, and audit ingestion.
- Desktop/Mobile/Web Gateway owns permission, session, parameter validation,
  policy enforcement, and audit truth.
- SDK is a typed client and error normalizer; it never makes the final
  permission decision.
- Local-only preferences may be used only as caches or development fallback, not
  as production install truth.
- Synthetic fixtures can prove gates but cannot substitute for real third-party
  certification or manual normal-user acceptance.

## 4. Workstream Overview

| ID | Workstream | Purpose | Blocks |
|----|------------|---------|--------|
| P0 | Plan Reset and Evidence Baseline | Archive old plans, freeze claims, identify reusable gates | All work |
| P1 | Note Product Completion | Finish `peers.note` as a real official applet product | Product acceptance |
| P2 | Station Store and Install State | Build catalog/install/revoke/policy source of truth | Applet Box release |
| P3 | Applet Box Product Integration | Replace local-only model with Station-backed user flow | User acceptance |
| P4 | Gateway and Policy Hardening | Close production security, quota, timeout, audit gaps | Third-party release |
| P5 | Third-Party Certification | Prove an independently authored package works | L3 release claim |
| P6 | Web/Mobile Parity Hardening | Bring non-Desktop hosts to product-grade parity gates | L5 claim |
| P7 | Release Readiness and Manual Acceptance | Run release audit, manual acceptance, and final claim | Platform release |

Dependency order:

```text
P0
  → P1
  → P2 → P3
  → P4 → P5
  → P6
  → P7
```

P1 may run in parallel with early P2 design, but P3 must wait for P2 install
state. P5 must wait for P4 policy hardening. P7 must remain last.

## 5. P0 — Plan Reset and Evidence Baseline

### Objective

Make this document the single execution source and prevent future phase-name
drift.

### Write Scope

- `docs/architecture/applet-runtime/README.md`
- superseded execution-plan headers
- current progress/evidence summaries, if updated
- `tooling/acceptance/evidence/applets/**` only through gate scripts

### Deliverables

- Old execution plans marked as superseded by this plan.
- README read-order updated to this plan.
- Current evidence inventory:
  - reusable gates;
  - stale gates;
  - synthetic-only gates;
  - missing real-user or third-party evidence.
- Claim baseline:
  - what can be claimed now;
  - what cannot be claimed yet.

### Acceptance

- Any agent reading `docs/architecture/applet-runtime/README.md` finds this plan
  as the active execution source.
- Old plans are clearly historical and not used for new phase claims.
- Baseline report distinguishes `PASS`, `STALE`, `SYNTHETIC_ONLY`,
  `NOT_IMPLEMENTED`, and `NEEDS_MANUAL_ACCEPTANCE`.

## 6. P1 — Note Product Completion

### Objective

Finish `peers.note` as a complete official applet product path.

### Write Scope

- `apps/applets/note/frontend/**`
- `apps/applets/note/service/**`
- `apps/applets/note/tests/**`
- `packages/applet-sdk/**` only for missing official Note capability surface
- Desktop/Station integration only when required by Note product acceptance

### Deliverables

- Note list, create, edit, delete, search, and restore behavior.
- Editor/update flow.
- Local draft storage through SDK storage only.
- Typed failure UI for:
  - permission denied;
  - unavailable service;
  - timeout;
  - not found;
  - conflict.
- i18n-complete UI; no hardcoded user-facing strings.
- Reload persistence evidence:
  - create → reload → list contains note;
  - edit → reload → edited content persists;
  - delete → reload → note absent;
  - search → finds persisted note.

### Acceptance Commands

```bash
pnpm applet:note-frontend-sdk-gate
pnpm applet:note-real-product-gate
pnpm applet:note-desktop-live-smoke
pnpm applet:note-forbidden-scan
cd apps/applets/note/service && go test ./...
cd apps/desktop && pnpm run check && pnpm run build
```

### Exit Criteria

- `peers.note` is not merely launchable; it satisfies official applet product
  flows and failure states.
- Evidence is labeled `REAL_PRODUCT_PATH` where applicable.
- Progress docs do not claim Mobile runtime product readiness unless runtime E2E
  gates pass.

## 7. P2 — Station Store and Install State

### Objective

Implement Station-backed applet catalog, install state, package storage, policy,
and audit ingestion.

### Write Scope

- `model/domain/applet/**` or equivalent proto source
- `apps/station/app/**` applet store subserver
- `apps/station/frame/**` only if framework support is required
- `apps/desktop/src-tauri/src/application/applets/**`
- `apps/desktop/src-tauri/src/domain/applets/**`
- package tooling under `tooling/scripts/**`

### Domain Model

Station Store must own:

- Package Registry: applet id, version, owner, status.
- Manifest Registry: manifest, target platforms, permissions, capabilities.
- Bundle Storage: bundle, assets, integrity metadata.
- Version Channel: stable/beta/dev, rollout target.
- Policy Distribution: capability policy, service policy, revocation.
- Install State: user/device installed applets, version, config.
- Audit Ingestion: Host audit upload and query.

### Deliverables

- Proto-first applet store API.
- Station subserver for registry/catalog/install/revoke/audit.
- Desktop Gateway client for Station Store.
- Local cache that mirrors Station state but is not source of truth.
- CLI gates:

```bash
pnpm applet:publish <package-dir> --channel dev
pnpm applet:install <applet-id> --channel dev
pnpm applet:revoke <applet-id> --version <version>
```

### Acceptance

- Host syncs catalog from Station.
- Install state survives Desktop restart and account switch correctly.
- Integrity failure rejects install and launch.
- Station revoke prevents new sessions.
- Rollback can select a previous package version.
- Local package install and Station package install reuse the same package
  reader/validator.
- Audit ingestion receives allowed and denied capability records.

## 8. P3 — Applet Box Product Integration

### Objective

Turn Applet Box into the product UI for Station-backed catalog, install, update,
launch, and revoke state.

### Write Scope

- `apps/desktop/src/applet/**`
- `apps/desktop/src/runtimes/appletsRuntime.ts`
- `apps/desktop/src/store/applets.ts`
- `apps/desktop/src/pages/AppletsPage.tsx`
- `apps/desktop/src/components/**` only for Applet Box entry points
- `packages/locales/**`
- Desktop applet UX docs if product workflow changes

### Deliverables

- Catalog projection:
  - Station available applets;
  - imported local dev packages;
  - installed applets;
  - update/revoked/error states.
- Install flow:
  - install from Station catalog;
  - import local package/directory for dev;
  - validate before showing as installable;
  - clear failure reasons.
- Launch flow:
  - only installed applets can launch;
  - revoked applets cannot create new sessions;
  - unavailable bundles show localized recovery state.
- Pin/sidebar behavior:
  - pinned applets must be installed;
  - uninstalled/revoked applets disappear or show recovery action.
- User-facing strings through locale keys.

### Acceptance Commands

```bash
cd apps/desktop && pnpm run check && pnpm run build
pnpm applet:desktop-product-shell-real-gateway-gate <package-dir>
pnpm applet:desktop-product-window-gate <package-dir>
```

### Exit Criteria

- Applet Box no longer depends on local preferences as production truth.
- The UI shows accurate installed/catalog/revoked/update states from Station or
  explicit local-dev mode.

## 9. P4 — Gateway and Policy Hardening

### Objective

Close production-grade Gateway gaps before third-party release.

### Write Scope

- Desktop Gateway and policy modules.
- Station policy distribution.
- SDK typed errors only if contract gaps are found.
- Evidence tooling for allow/deny/audit.

### Deliverables

- Capability registry loaded from contract/policy.
- Permission matrix:
  - manifest declared permissions;
  - Station policy;
  - Host platform policy;
  - user/session grant.
- Parameter validation for each public capability.
- Quota/timeout policy:
  - storage quota;
  - request body limit;
  - task duration;
  - agent/AI quota;
  - stream event rate.
- Persistent task/session/audit stores where required for production behavior.
- True push/subscription progress transport decision:
  - implement push path; or
  - document polling as accepted production transport with constraints.
- Product-mode fallback rejection for placeholder skills/tasks/agent paths.

### Acceptance Commands

```bash
pnpm applet:contract-test
pnpm applet:sdk-adapter-test
pnpm applet:product-capability-service-gate
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml applets::tests -- --nocapture
```

### Exit Criteria

- Every allowed and denied invoke has stable `requestId` and audit.
- No token, provider key, internal prompt, tool executor, system log, or audit
  writer reaches applet code.
- Product mode cannot pass using placeholder executors.

## 10. P5 — Third-Party Certification

### Objective

Prove Peers-Touch can accept an independently authored conforming package.

### Input Requirements

A package must come from outside Peers-Touch implementation ownership and include:

- manifest;
- Lynx bundle;
- integrity metadata;
- services;
- skills/tasks/agent/AI/telemetry declarations if used;
- no dependency on Peers-Touch source layout;
- no Host-private imports.

### Deliverables

- Third-party package attestation:
  - author/source;
  - package id;
  - version;
  - expected capabilities.
- Certification output:

```bash
pnpm applet:external-producer-certification-gate <external-package-dir>
```

- Evidence must include:
  - package validation;
  - Desktop runtime;
  - product Host;
  - real Gateway;
  - product shell route;
  - packaged product window;
  - Desktop live E2E;
  - allowed/denied audit.

### Exit Criteria

- Certification runs against a real independently authored package, not a
  tooling-generated package.
- The package remains outside repo-local producer paths.
- Results are attached to release readiness evidence.

## 11. P6 — Web/Mobile Parity Hardening

### Objective

Ensure non-Desktop hosts execute the same applet contract with product-grade
evidence.

### Web Deliverables

- Deployed or deployable Web Host product shell.
- Web Host BFF/Gateway path; no production raw browser fetch.
- Normal account/session acceptance where Web release is in scope.

### Mobile Deliverables

- Android instrumented bridge/runtime tests beyond marker-only E2E.
- iOS XCTest or equivalent native bridge/runtime tests.
- Native Lynx package install/launch/revoke behavior aligned with Desktop.
- Mobile install state synced from Station Store.

### Acceptance Commands

```bash
pnpm applet:web-host-runtime-gate
pnpm applet:production-web-host-gate
pnpm applet:ios-lynx-runtime-e2e
pnpm applet:android-lynx-runtime-e2e
pnpm mobile:check
```

Additional native test commands must be added when P6 implements the hardening
tests.

### Exit Criteria

- Same package contract works on Desktop + Web + Android + iOS, or unsupported
  platforms are explicitly rejected.
- Permission denied and invalid-session errors are consistent across hosts.
- Install/revoke semantics are consistent across hosts where supported.

## 12. P7 — Release Readiness and Manual Acceptance

### Objective

Produce the final release claim with evidence.

### Deliverables

- L3 release audit passes:

```bash
pnpm applet:l3-release-audit
```

- L5 platform audit, to be added in this plan:

```bash
pnpm applet:l5-platform-audit
```

- Manual normal-user acceptance:
  - install official Note;
  - install third-party package;
  - launch, use, close, reopen;
  - revoke and verify blocked launch;
  - update/rollback where available;
  - inspect audit evidence.
- Release readiness summary:
  - exact level claim;
  - gates passed;
  - remaining non-blocking hardening;
  - known unsupported platforms/capabilities.

### Exit Criteria

- No expected-fail gate remains for the claimed level.
- Manual acceptance evidence references real product shell, normal user/session,
  applet id, version, and artifacts.
- The final claim uses `development-runtime-readiness-report.md` terminology.

## 13. Required Evidence Map

| Evidence | Required by | Minimum path |
|----------|-------------|--------------|
| Plan reset baseline | P0 | `tooling/acceptance/evidence/applets/plan-reset/` |
| Note product acceptance | P1 | `tooling/acceptance/evidence/applets/official-applet/` |
| Station Store publish/install/revoke | P2 | `tooling/acceptance/evidence/applets/station-store/` |
| Applet Box product shell | P3 | `tooling/acceptance/evidence/applets/desktop/` |
| Gateway policy hardening | P4 | `tooling/acceptance/evidence/applets/gateway/` |
| Third-party certification | P5 | `tooling/acceptance/evidence/applets/external-producer/` |
| Web Host product acceptance | P6 | `tooling/acceptance/evidence/applets/web/` |
| Mobile runtime hardening | P6 | `tooling/acceptance/evidence/applets/mobile/` |
| Release audit | P7 | `tooling/acceptance/evidence/applets/release/` |

Every evidence file must include one of:

```text
REAL_PRODUCT_PATH
CONTROLLED_LOCAL_UPSTREAM
SYNTHETIC_FIXTURE
MANUAL_ACCEPTANCE
NOT_IMPLEMENTED
```

## 14. Reporting Contract

Every progress report for this plan must use:

```markdown
**Plan Source**
- `2026-06-23-applet-capability-completion-plan.md`

**Scope Completed**
- P?: <completed deliverables>

**Evidence**
- `<command>`: PASS/FAIL/NOT RUN
- `<path>`: REAL_PRODUCT_PATH / SYNTHETIC_FIXTURE / NOT_IMPLEMENTED

**Not Completed**
- P?: <remaining deliverables>

**Claim**
- <strongest accurate readiness claim>
```

Agents must not say "applet is complete" unless P7 passes the appropriate audit.

## 15. First Next Tasks

Execute in this order:

1. **P0.1 Archive Old Plans**
   - Mark superseded plans as historical.
   - Update `README.md` read order.
   - Create baseline claim/evidence inventory.
2. **P1.1 Note Gap Audit**
   - Compare current `peers.note` behavior against P1 deliverables.
   - Produce missing UI/SDK/service task list.
3. **P2.1 Station Store Proto Design**
   - Define package registry, manifest registry, install state, policy,
     revocation, and audit ingestion API.
4. **P3.1 Applet Box Projection Design**
   - Replace local-only projection with Station-backed runtime projection.
5. **P4.1 Gateway Policy Gap Audit**
   - List remaining placeholder/fallback/polling/quota/timeout gaps.

No coding work after P0 should start without naming the target workstream and
acceptance commands.
