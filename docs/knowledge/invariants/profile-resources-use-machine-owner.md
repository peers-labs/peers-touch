---
kind: invariant
title: Profile resources use the existing machine owner
status: active
owns:
  - tooling/scripts/local-dev/
  - tooling/make/local-dev.mk
  - apps/mobile/scripts/ios-dev-sim.sh
  - tooling/acceptance/provisioners/mobile_simulator.py
  - tooling/acceptance/provisioners/mobile_ios_resources.py
  - tooling/acceptance/provisioners/profile_ios_fixture.py
  - tooling/acceptance/gates/mobile/resource_dependencies*.py
  - tooling/acceptance/environments/
related:
  - docs/architecture/engineering/local-dev/decisions.md
  - docs/architecture/engineering/local-dev/data-model.md
  - docs/architecture/engineering/local-dev/integration.md
  - docs/knowledge/pitfalls/ios-simulator-uninstall-retains-keychain.md
detected: 2026-11-14
owner: Platform Team
review-cadence: on-change
---

# Profile resources use the existing machine owner

## What must hold

Every changed iOS resource entrypoint MUST consume the existing Machine Dev
owner and MUST NOT independently allocate or reclaim devices. Apply
[LDCP-D23/D25/D26/D27](../../architecture/engineering/local-dev/decisions.md#ldcp-d27-readable-discovery-with-internal-identity)
and the canonical
[resource contract](../../architecture/engineering/local-dev/data-model.md#12-resource-dependency-contract).
This entry references those rules; it does not define another schema, quota,
reset policy or workflow permission.

## Why this is non-negotiable

An independent launcher or cleanup callback bypasses cross-worktree physical
locking and recovery. Slot ownership and released lease metadata cannot prove
device ownership, reference sharing, current contents or provider deletion.
Shared ID references MUST NOT silently authorize overwrite. The original data
owner and explicit user decision establish its exact effects, including keychain.

User input MUST NOT require raw resource IDs/UUIDs. The owner/Agent discovers
eligible resources and presents readable names/state/shared Profiles, then
resolves stable IDs internally. Display names and temporary list positions
MUST NOT become identity keys.

Both Mobile shell entries and all iOS Simulator Provisioners now consume this
owner. Source regression results are distinct from native/provider proof.

## How to verify

- `node --test --test-timeout=1200000 tooling/scripts/local-dev/machine-dev*.test.mjs`
  runs the existing owner suite. The implementation must extend it with shared
  user ID assignments, visible cross-Profile sharing, exact overwrite notice/
  force/decline, same-UUID contention, post-confirmation races and preparation recovery.
- `python3 -m unittest tooling.acceptance.tests.test_mobile_simulator_provisioner`
  checks the original consumer owner; implementation must replace its direct
  allocation expectations with the common binding contract.
- `rg -n 'simctl.*create|simctl.*delete|_create_isolated_ios_simulator_definition' tooling/scripts/local-dev/mobile-ios-sim.sh apps/mobile/scripts/ios-dev-sim.sh tooling/acceptance/provisioners/mobile_simulator.py`
  identifies forbidden direct allocation/cleanup. Zero allocation
  hits must be corroborated by runtime provider readback, not treated as proof alone.
- LDCP-R01 to R10 native/provider evidence is required before completion:
  user assignment, shared identity, physical exclusion, crash recovery,
  data/retention, connect-only, separate detach/release/delete, overwrite
  decisions, post-confirmation races and readable discovery/name resolution.
  No such PASS is claimed here.
- `python3 tooling/scripts/acceptance-run.py --gate profile-resource-native-functional --execution-policy development`
  runs the bounded native Journey through the original selected Provisioner.
  It creates only its own fixture devices, interrupts real child owners at
  durable preparation/create/install/lease boundaries, reads provider and scoped
  Keychain state, then separately authorizes deletion of those exact fixtures.
  An occupied ordinary development endpoint or dirty formal source remains
  BLOCKED; never stop a foreign owner to make the proof pass.

## Crosswalks

- [Integration and consumer inventory](../../architecture/engineering/local-dev/integration.md#9-resource-dependency-cutover).
- [Keychain pitfall](../pitfalls/ios-simulator-uninstall-retains-keychain.md).
