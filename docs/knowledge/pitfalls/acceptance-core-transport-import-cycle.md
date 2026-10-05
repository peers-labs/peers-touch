---
kind: pitfall
title: Core attestation must not import concrete transports
status: active
owns:
  - tooling/acceptance/core/attestation.py
  - tooling/acceptance/provisioners/
  - tooling/acceptance/transports/
  - tooling/acceptance/fixtures/
referenced-by: []
related:
  - docs/architecture/engineering/acceptance/module-layout.md
  - docs/architecture/engineering/acceptance/execution-plans/20260816-runtime-provisioning-contract-implementation.md
detected: 2026-09-09
---

# Core attestation must not import concrete transports

## Symptom

`agent-attachment-e2e` reached exact-source Station attestation but failed before
Fixture reset. A fresh `chat_native_reset` process raised an import error along
this cycle:

```text
fixtures.chat_native_reset
  -> transports.ssh
  -> core.__init__
  -> core.provisioner
  -> core.attestation
  -> transports.ssh
```

The Gate remained `BLOCKED/UNPROVEN`; no product journey or Fixture mutation
started.

## Root cause

Core attestation directly imported the concrete SSH transport to acquire remote
deployment identity. This inverted the accepted dependency direction:
Provisioners own environment and transport mechanics, while Core validates and
persists the resulting source identity. Python package initialization made the
reverse dependency observable only in a fresh child process.

## Mitigation

### What was done in code

- Moved SSH-backed deployment identity acquisition to
  `tooling/acceptance/provisioners/remote_source_identity.py`.
- Made remote Core attestation require an explicitly injected source-identity
  provider.
- Migrated every concrete Provisioner caller and removed the old Core SSH path.

### What guards against regression

- `ActorFixtureOwnerTests.test_reset_module_imports_in_fresh_process` imports
  the reset entry point in a new Python process.
- Remote attestation owner tests retain strict-known-host and tracked-source
  digest assertions against the Provisioner adapter.
- The Acceptance module layout forbids `core/attestation.py` from importing
  concrete transports or Provisioners.

## How to detect a recurrence

```bash
python3 -c \
  'from tooling.acceptance.fixtures.chat_native_reset import main'
```

```bash
rg -n '^from tooling\.acceptance\.(transports|provisioners)' \
  tooling/acceptance/core/attestation.py
```

The import command must exit zero and the search must return no matches.

## Crosswalks

- Architecture boundary:
  `docs/architecture/engineering/acceptance/module-layout.md`.
- Owning execution plan:
  `docs/architecture/engineering/acceptance/execution-plans/20260816-runtime-provisioning-contract-implementation.md`.
