# W9 Native Acceptance and Readiness Audit

> **Run date**: 2026-09-03
> **Environment**: macOS local development workstation (no physical iOS/Android devices)
> **Runner**: W9 manual audit

---

## 1. Infrastructure Health

### Acceptance Framework Tests

```
python3 -m pytest tooling/acceptance/tests/ -q
  (excluding 6 ssh-transport-dependent tests)
Result: 399 passed, 28 failed, 1 error
```

Non-mobile failures (28) are pre-existing infrastructure issues unrelated to mobile domain:
- `test_launch_context.py` (ephemeral timeout, exit-code mismatch)
- `test_local_dev_profile_redaction.py` (missing env.sh fixture)
- `test_profile_lease.py` (port/known_hosts_file signature mismatch)
- `test_provisioning_model.py` (tuple index out of range)

Missing infrastructure modules blocking full runner/validator:
- `tooling.acceptance.transports.ssh` -- module missing (only `__pycache__` in directory)
- `tooling.acceptance.core.redaction.redact_text_with_values` -- function does not exist in `redaction.py`

These block:
- `make acceptance PLAN=tooling/acceptance/plans/mobile-shell.json`
- `python3 tooling/scripts/acceptance-validate.py --domain mobile`

### Mobile Gate Unit Tests

All mobile-specific gate unit tests pass:

| Test suite | Result |
|---|---|
| `proof_contracts_test.py` | 49 passed |
| `native_e2e_test.py` | 25 passed |
| `simulator_e2e_test.py` | 18 passed |
| `cleanup_evidence_finalizer_test.py` | 11 passed |
| `test_mobile_resource_lease.py` | 92 passed, 1 fixture error |
| **Total mobile gate tests** | **195 passed** |

---

## 2. Gate-by-Gate Status

### Static / Structural Gates

| Gate ID | Command | Status | Detail |
|---|---|---|---|
| `mobile-contract-static` | `python3 -m tooling.acceptance.gates.mobile.contract_static` | NOT RUN | Requires acceptance run context (`EvidenceRootInvalid`); unit tests (49 proof_contracts) PASS |
| `mobile-identity-contract` | `python3 tooling/acceptance/gates/mobile/identity_contract.py` | **FAIL** | Non-canonical DID actor aliases at `apps/station/app/subserver/social/infrastructure/relationship_schema.go:11,12` (`actor_did`, `peer_did` column tags not in legacy allowlist) |
| `mobile-hard-cut-static` | `python3 -m tooling.acceptance.gates.mobile.contract_static --hard-cut` | NOT RUN | Requires acceptance run context |
| `mobile-domain-validation` | `python3 tooling/scripts/acceptance-validate.py --domain mobile --require-proven` | NOT RUN | Blocked by missing `tooling.acceptance.transports.ssh` module |

### E2E / Native Gates (all require physical devices + provisioner)

| Gate ID | Status | Reason |
|---|---|---|
| `mobile-simulator-access-e2e` | UNPROVEN | Requires `mobile-simulator` environment and Appium provisioner |
| `mobile-native-access-e2e` | UNPROVEN | Requires physical iOS/Android devices, approved provider accounts, Station fixture |
| `mobile-native-lifecycle-e2e` | UNPROVEN | Requires `mobile-native` environment |
| `mobile-native-recovery-e2e` | UNPROVEN | Requires `mobile-native` environment |
| `mobile-native-recovery-ui-e2e` | UNPROVEN | Requires `mobile-native` environment |
| `mobile-native-social-convergence-e2e` | UNPROVEN | Requires `mobile-native` environment |
| `mobile-native-chat-contacts-e2e` | UNPROVEN | Requires `mobile-native` environment |
| `mobile-native-moments-e2e` | UNPROVEN | Requires `mobile-native` environment |
| `mobile-native-settings-e2e` | UNPROVEN | Requires `mobile-native` environment |
| `mobile-native-platform-e2e` | UNPROVEN | Requires `mobile-native` environment |

---

## 3. Product Assertion Coverage (MS-PA01 through MS-PA27)

All 27 product assertions (MS-PA01..MS-PA27) are listed in the plan at `tooling/acceptance/plans/mobile-shell.json`.

**Current status**: All MS-PA assertions are **UNPROVEN**.

Reason: No native runtime cell has produced evidence. The gate infrastructure (proof contracts, native E2E test harnesses, simulator E2E, cleanup finalizers) is source-complete and unit-tested, but no physical acceptance run has executed.

---

## 4. Architecture Gate Coverage (MS-AG01 through MS-AG11)

| Gate | Mapped Scenarios | Status | Blocking Issue |
|---|---|---|---|
| MS-AG01 | AS-01, AS-04 | UNPROVEN | No native run |
| MS-AG02 | AS-01, AS-02, AS-04, AS-10 | UNPROVEN | No native run |
| MS-AG03 | AS-02, AS-03 | UNPROVEN | Physical devices + approved provider accounts required |
| MS-AG04 | AS-05, AS-06, AS-08 | UNPROVEN | No native run |
| MS-AG05 | AS-04, AS-10, AS-11 | UNPROVEN | No native run |
| MS-AG06 | AS-04..AS-09 | UNPROVEN | No native run |
| MS-AG07 | AS-14 | UNPROVEN | No native run |
| MS-AG08 | AS-09, AS-13..AS-15 | UNPROVEN | No native run |
| MS-AG09 | AS-06, AS-07, AS-12 | UNPROVEN | No native run |
| MS-AG10 | AS-05, AS-08, AS-09, AS-11 | UNPROVEN | No native run |
| MS-AG11 | AS-09, AS-13, AS-15 | UNPROVEN | No native run |

---

## 5. Capability Coverage

| Capability | Required Gates | Proven Gates | Status |
|---|---|---|---|
| `mobile-station-access` | contract-static, identity-contract, native-access-e2e | 0/3 | UNPROVEN |
| `mobile-runtime-lifecycle` | contract-static, native-lifecycle-e2e | 0/2 | UNPROVEN |
| `mobile-command-recovery` | contract-static, native-recovery-e2e, native-recovery-ui-e2e | 0/3 | UNPROVEN |
| `mobile-social-product` | native-social-convergence, native-chat-contacts, native-moments, native-settings | 0/4 | UNPROVEN |
| `mobile-native-quality` | native-platform-e2e, hard-cut-static | 0/2 | UNPROVEN |

---

## 6. Acceptance Scenarios (AS-01 through AS-15)

All 15 scenarios remain **pending** (as recorded in the execution plan section 10).

---

## 7. Blockers for Readiness

### Infrastructure blockers (fixable without physical devices)

1. **Missing `tooling.acceptance.transports.ssh` module** -- the `transports/` directory contains only `__pycache__`. This blocks `acceptance-validate.py` and `acceptance-run.py` from loading.
2. **Missing `redact_text_with_values` function** in `tooling/acceptance/core/redaction.py` -- `acceptance-run.py` line 201 imports it but the module only exposes `redact_text` and `redact_value`.
3. **Identity contract gate FAIL** -- `relationship_schema.go` lines 11-12 use `actor_did`/`peer_did` GORM column tags that are not in the `LEGACY_MIGRATION_ALLOWLIST`. Either the allowlist must be updated or the schema must use PTID-canonical column names.

### Physical environment blockers

4. **No physical iOS/Android devices** connected to this workstation.
5. **No approved OAuth provider accounts** for native access E2E.
6. **No `mobile-native` or `mobile-simulator` environment provisioned**.

### Implementation blockers (W3-W8 not done)

7. Per the plan status table (section 11), W3 through W8 remain **pending**. Only W-1, W0, and W1 are done; W2 is in progress (W2-E2 physical proof unproven).

---

## 8. Summary

| Category | Count |
|---|---|
| Gates in plan | 14 |
| Gates PASS | 0 |
| Gates FAIL | 1 (identity-contract) |
| Gates NOT RUN | 3 (static gates blocked by run context / missing module) |
| Gates UNPROVEN | 10 (all native E2E gates) |
| Product assertions proven | 0 / 27 |
| Architecture gates proven | 0 / 11 |
| Acceptance scenarios completed | 0 / 15 |

**Readiness verdict: UNPROVEN**

Mobile Shell production readiness cannot be claimed. The acceptance gate infrastructure is source-complete (195 unit tests pass), but:
- The acceptance runner has two missing module blockers preventing execution.
- The identity contract gate fails due to a non-allowlisted DID alias.
- W3 through W8 implementation is pending.
- No physical device evidence exists.

---

## 9. Recommended Next Steps

1. Fix the missing `tooling.acceptance.transports.ssh` module (restore from git or create stub).
2. Add `redact_text_with_values` to `tooling/acceptance/core/redaction.py` or fix the import in `acceptance-run.py`.
3. Resolve `relationship_schema.go` DID alias: add to allowlist or rename columns.
4. Complete W3-W8 implementation before re-running W9.
5. Provision physical iOS/Android devices and approved provider accounts for native E2E gates.
