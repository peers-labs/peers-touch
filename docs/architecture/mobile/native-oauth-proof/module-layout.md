# Mobile Native OAuth Proof — Module Layout

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-29 | **Updated**: 2026-08-30
> **Owner**: Mobile Architecture Team
> **Module**: `apps/mobile/`, `tooling/acceptance/`

---

D-19 additions in this document are architecture-accepted targets. Generic
Infra execution is active; Mobile module landing remains blocked until that
Infra lands and the Mobile D-19 amendment passes independent review.

## 1. Target Module Tree

```text
tooling/acceptance/
├── capabilities/mobile.yaml
├── environments/mobile-native.yaml
├── fixtures/
│   ├── mobile_oauth_station.py
│   └── mobile_resource_lease.py
├── contracts/mobile/
│   ├── finalizers.yaml
│   ├── native_oauth.schema.json
│   ├── native_oauth.py
│   ├── native_oauth_test.py
│   └── native_oauth.protected.json
├── finalizers/
│   ├── registry.py
│   └── mobile_native.py
├── gates/mobile/
│   ├── appium.py
│   └── native_e2e.py
├── provisioners/
│   ├── mobile_native_build.py
│   └── mobile_native.py
└── tests/
    ├── test_mobile_native_build.py
    ├── test_mobile_native_preflight.py
    └── test_mobile_resource_lease.py

apps/mobile/
├── vite.config.ts
├── src/acceptance/
│   └── buildIdentity.ts
└── src-tauri/
    ├── build.rs
    └── src/commands/
        └── build_identity.rs
```

## 2. Ownership

| Path | Responsibility | Must not own |
|---|---|---|
| `capabilities/mobile.yaml` | Mobile Gate-level required-finalizer mapping | Generic finalizer lifecycle |
| `contracts/mobile/finalizers.yaml` | Generated concrete finalizer registration and role projection | Independently authored role truth or generic resolver logic |
| `contracts/mobile/native_oauth.schema.json` | Canonical E2-0 payload shapes | Runtime acquisition or evidence writes |
| `contracts/mobile/native_oauth.py` | Role discriminator/path/payload identity, relation, cardinality and redaction validation | Resource mutation |
| `contracts/mobile/native_oauth.protected.json` | Reviewed digests for the Capability-owned requirement mapping, generated registration, contract/schema and entrypoint | A second editable requirement or registration source |
| `finalizers/registry.py` | Generic Acceptance Infra registration schema/resolver | Concrete Mobile registration entries or business validation |
| `finalizers/mobile_native.py` | Validate the sealed post-cleanup snapshot and emit a typed outcome | Provisioning, cleanup, product calls or Evidence Store writes |
| `mobile_resource_lease.py` | Mobile-owned durable lease ledger, broker boundary, fencing and terminal outcomes | Generic Acceptance lifecycle or provider credentials |
| `mobile_native_build.py` | Canonical identity, controlled build, package inspection and attestation payload | Evidence Store authority or runtime proof judgment |
| `mobile_native.py` | Integrate validated build and lease ArtifactRefs into one RuntimeManifest | Raw device/provider identity persistence |
| `appium.py` | Fenced physical install and Driver operations | Build production or lease ownership |
| `native_e2e.py` | Consume refs and emit the primary pre-cleanup 16-cell behavior result | Manufacture Fixture, lease or build evidence; claim final 19-role closure |
| `buildIdentity.ts` | Compare Web and Rust public embedded identity | Build or session truth |
| `build_identity.rs` | Return Rust compile-time public identity | Read files, environment, credentials or Station state |

## 3. Dependency Direction

```text
proof contracts
  -> build producer
  -> resource lease owner
  -> Mobile provisioner integration
  -> Appium/Harness consumers
  -> native Gate primary behavior judgment
  -> detached post-cleanup final evidence closure
```

`mobile_native.py` is the single integration owner. Build and lease modules do
not import each other. Appium and Gate code consume already-validated handles
and ArtifactRefs; they cannot acquire resources or persist evidence directly.
The contract module, schema, tests, documentation and every import move
atomically from `gates/mobile/`; the old module and schema paths are deleted
without compatibility re-exports.

## 4. Registration Boundary

Build and lease producers compile and test behind their owned interfaces.
Shared Harness action registration, Tauri invoke registration, RuntimeManifest
cutover, Appium install cutover and Gate consumption have one integration
owner defined by the execution plan. No temporary dual path or compatibility
alias is retained.

## 5. Secret And Identity Boundary

Persisted:

- opaque account/device/browser refs;
- lease tuples and typed terminal outcomes;
- build, artifact and signing hashes;
- application IDs and boolean verification results.

Process-local only:

- raw UDID/serial;
- provider subject and credentials;
- browser cookies/storage;
- signing credentials;
- HMAC key and callback material.

Any attempt to serialize process-local values fails before Evidence Store
write.
