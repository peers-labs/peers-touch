# Mobile Native OAuth Proof — Module Layout

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-08-29 | **Updated**: 2026-08-29
> **Owner**: Mobile Architecture Team
> **Module**: `apps/mobile/`, `tooling/acceptance/`

---

## 1. Target Module Tree

```text
tooling/acceptance/
├── environments/mobile-native.yaml
├── fixtures/
│   ├── mobile_oauth_station.py
│   └── mobile_resource_lease.py
├── gates/mobile/
│   ├── proof-contract.schema.json
│   ├── proof_contracts.py
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
| `proof-contract.schema.json` | Canonical E2-0 payload shapes | Runtime acquisition or evidence writes |
| `proof_contracts.py` | Payload, relation, cardinality and redaction validation | Resource mutation |
| `mobile_resource_lease.py` | Mobile-owned durable lease ledger, broker boundary, fencing and terminal outcomes | Generic Acceptance lifecycle or provider credentials |
| `mobile_native_build.py` | Canonical identity, controlled build, package inspection and attestation payload | Evidence Store authority or runtime proof judgment |
| `mobile_native.py` | Integrate validated build and lease ArtifactRefs into one RuntimeManifest | Raw device/provider identity persistence |
| `appium.py` | Fenced physical install and Driver operations | Build production or lease ownership |
| `native_e2e.py` | Consume refs and judge MS-AG03 | Manufacture Fixture, lease or build evidence |
| `buildIdentity.ts` | Compare Web and Rust public embedded identity | Build or session truth |
| `build_identity.rs` | Return Rust compile-time public identity | Read files, environment, credentials or Station state |

## 3. Dependency Direction

```text
proof contracts
  -> build producer
  -> resource lease owner
  -> Mobile provisioner integration
  -> Appium/Harness consumers
  -> native Gate judgment
```

`mobile_native.py` is the single integration owner. Build and lease modules do
not import each other. Appium and Gate code consume already-validated handles
and ArtifactRefs; they cannot acquire resources or persist evidence directly.

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
