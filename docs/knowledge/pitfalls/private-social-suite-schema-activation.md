---
kind: pitfall
title: Private Social Suites require canonical schema before publication
status: active
owns:
  - tooling/development/secure_content/runtime_schema.py
  - tooling/development/secure_content/activation_transport.py
  - tooling/development/secure_content/test_activation_transport.py
  - tooling/development/secure_content/test_runtime_schema.py
  - tooling/acceptance/provisioners/chat_storage_native.py
  - tooling/acceptance/provisioners/mobile_search.py
  - tooling/acceptance/provisioners/native_tauri_embedded_webdriver.py
  - tooling/development/secure_content/prepared_native.py
  - tooling/acceptance/gates/social/cross_station_support.py
  - tooling/acceptance/tests/test_private_social_native_provisioner.py
  - apps/station/app/subserver/social/infrastructure/secure_content_reset_types.go
related:
  - docs/architecture/shared/security/secure-content/decisions.md
  - docs/global/local-dev-environment.md
referenced-by: []
detected: 2026-10-24
---

# Private Social Suites require canonical schema before publication

## Symptom

An exact-source native Suite repeatedly observes `UNKNOWN_COMMIT` for one
immutable private draft. Station returns HTTP 500 and PostgreSQL reports a
not-null violation on the retired `social_private_posts.id` column.

## Root cause

Ordinary migration adds canonical encrypted columns but preserves historical
plaintext columns. A current binary does not establish current physical schema.
Chat actor reset does not own private Social schema activation.

## Mitigation

Before client launch, the Social Suite provisioner invokes the existing Secure
Content reset owner through `prepare_private_social_runtime`. It clears the
closed private scope, rebuilds the canonical Post table, preserves public state,
redeploys exact source and verifies the completed journal and schema attestation.
Never add legacy IDs, arbitrary SQL drops or a second mutation implementation.

A reviewed non-stable Profile and exact `station.reset` lease authorize the
operation. Planless schema activation uses an empty `plan_id` and generated
source-bound audit metadata. Stable Profiles, unknown targets, final-cut intent,
and process-binding drift remain rejected.

Schema preparation precedes retained service/source leases. A separate actor
reset, when already owned by another Suite, remains with that parent. The
profile/deployment child obtains its own deployment lease;
its environment must omit `PT_MACHINE_LEASE_*` metadata for the unrelated
parent descriptor. Python closes that descriptor across exec, so forwarding
its number causes the deployment bridge to fail with `EBADF`. Do not mutate
the parent environment or forward reset authority to a deployment child.

Two-Station preparation supplies an explicit target Profile and expected source
commit. `env-check`, both deployments and the reset lease retain that target
without changing the workspace's selected Profile or slot. Deployment children
also omit parent Acceptance runtime and Agent external-runtime fields.
Checkpoint cleanliness covers Station, its local Note service replacement,
protocol inputs and the remote reset code. Unrelated site or generated Mobile
work cannot supply or invalidate the deployed Station checkpoint. Dirty covered
inputs, a different current commit, unknown target or missing reset capability
fail before the reset owner is invoked.

Physical schema service IDs come from the reset allowlist. A Suite's logical
Station role maps to that physical owner; it never rewrites attestation bytes.
The Evidence Run ID and provisioning epoch are different. Actor/schema
inventories bind the provisioning epoch inside original current-run ArtifactRefs.
Consumer manifests must preserve both identities and retain successful cleanup.
Historical activation ancestry cannot replace that current binding.

## How to detect a recurrence

- Run the Social Search Desktop or Mobile native Suite against a reviewed
  development Profile through the canonical Acceptance provisioner.
- Inspect its immutable `social-private-schema-attestation` artifact: source,
  Profile, scope and runtime must match; `retired_columns_absent` must be true.
- Run `go test ./subserver/social/infrastructure -run
  'TestResetTaskAllowlistMatchesIntentAndProfile|TestPlanlessResetRejectsProcessBindingDrift'`
  from `apps/station/app`.
- Confirm schema preparation occurs once at Suite scope, before the first
  scenario; public snapshot equality is checked by the reset owner.
- Run `python3 -m unittest
  tooling.development.secure_content.test_activation_transport`; profile and
  deploy children must omit parent lease metadata while the parent retains it.
- Run `python3 -m unittest
  tooling.development.secure_content.test_runtime_schema`; explicit secondary
  targets survive both deployments and the lease, source/target/capability
  drift fails before reset, and unrelated site work remains untouched.
- Run `python3 -m unittest
  tooling.acceptance.tests.test_private_social_native_provisioner
  tooling.development.secure_content.test_prepared_native
  tooling.acceptance.gates.social.test_cross_station_support`; both schemas
  prepare before retained leases, physical bytes and adjacent provenance remain
  unchanged, foreign source/run/epoch is rejected, and failed logout still
  stops owned processes without publishing a Suite PASS.
