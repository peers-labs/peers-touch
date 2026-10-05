# Secure Content Runtime And Reset Closure Amendment - Review Prompt

> **Status**: completed - Owner accepted `SC-D22` and `SC-D23`
> **Version**: v1.1
> **Created**: 2026-09-17 | **Updated**: 2026-09-17
> **Owner**: Architecture Team

---

## Owner Decision

On 2026-09-17, the Owner accepted the `SC-D22` and `SC-D23` proposals recorded
at commit `bd8dad8b3a5e95c4f3bf002c244d605461c3517d` and authorized the mechanical
plan, work-item, Journey, command, profile, evidence-path, and tracking
amendments required by those decisions.

The same decision authorizes local checkpoint commits, declared deployment on
profiles `four` and `fiveArm`, and only the W12 destructive scopes
`station-four-social-private` and `station-five-arm-social-private`. It does
not authorize push, pull-request creation, history rewrite, production reset,
new profiles, or force-overwriting unrelated remote changes.

This Owner decision resolves the pending architecture gate. It does not
establish any W7-W12 `FUNCTIONAL_PASS` or W13 formal Acceptance result.

---

Review proposed `SC-D22` and `SC-D23` in:

- `docs/architecture/secure-content/decisions.md`
- `docs/architecture/secure-content/design.md`
- `docs/architecture/secure-content/data-model.md`
- `docs/architecture/secure-content/integration.md`
- `docs/architecture/secure-content/operations.md`
- `docs/architecture/secure-content/execution-plans/20260913-secure-content-hard-cut/plan.md`
- `docs/architecture/secure-content/execution-plans/20260913-secure-content-work-items.yaml`
- `docs/architecture/secure-content/execution-plans/20260913-secure-content-journeys.yaml`

Upstream accepted constraints:

- `docs/architecture/social/{product-definition,experience-contract,product-state-model,acceptance-matrix}.md`
- `docs/architecture/local-dev-control-plane/`
- `docs/architecture/development-workflow/`
- `docs/architecture/acceptance-framework/`
- `docs/architecture/mobile/`
- `docs/client/mobile/`
- accepted `SC-D01..SC-D21`

## Verified Gaps

1. The Markdown plan selects profile `one`/slot `0`; the authoritative
   work-item/runtime binding uses profile `four`/slot `5` and secondary profile
   `fiveArm`.
2. The current Development manifest requires one top-level profile and accepts
   `native-tauri` Desktop or Browser clients only.
3. W7/W8 were previously labeled `FUNCTIONAL_PASS` from API/static/smoke
   observations that do not execute the accepted sender/receiver product
   Journeys.
4. W8 has no `social-expansion` scenario implementation for its declared
   receiver-visible slices.
5. Mobile has generated Secure Content proto/Rust bindings but no private
   Social Native store, worker, typed adapter, UI projection, or product
   Harness actions.
6. W2D/W10 need unchanged `MP-J11` Chat attachment proof on Desktop, iOS
   Simulator, and Android Emulator across two manifest-bound Stations.
7. W11 source hard cut and Station four deployment/health are current at
   `a4031b195`, but its required product regression matrix has not run.
8. W12 `schema_audit` and `reset` modules do not exist.
9. `social_private_posts` is a reused table name: migrated deployments may
   contain plaintext-era columns/rows beside the canonical encrypted schema.
10. The plan does not define exact table/column/object targets, public snapshot
    hashing, or resumable database/object failure semantics.

## Proposed SC-D22

`SC-D22` proposes:

1. Canonical workspace binding is profile `four`, slot `5`; `fiveArm` is the
   existing secondary service profile.
2. Profile `one`, slot `0`, `station-one-social-private`, and `*-one-*` client
   IDs are superseded for this plan.
3. One platform/runtime owner emits one immutable external
   `secure-content-development-runtime-v2` manifest.
4. The manifest reuses canonical `services` and client `service_bindings`
   topology semantics; no second Secure Content topology model is introduced.
5. Supported Development clients are exactly Desktop `native-tauri`, Browser,
   `tauri-ios-simulator`, and `tauri-android-emulator`.
6. The runtime owner owns deploy, launch, restart, storage, automation sessions,
   teardown, and temporary secondary-profile selection. The business scenario
   remains attach-only.
7. W7, W8, W9, W2D/W10, W11, and W12 each require current receiver-visible
   child results for every declared runtime/platform variant.
8. `SOC-SEC-AS01..AS16`, `MP-G13`/`MP-J11`, and `sc-dj-*` remain distinct
   evidence namespaces.
9. Development manifest v1 is deleted in the same cut; no compatibility reader
   or fallback remains.
10. Fixed external Mobile debug/telemetry endpoints are removed before W9
    source closure.

## Proposed SC-D23

`SC-D23` proposes:

1. Destructive targets are exactly:
   - `four` / `station-four` / `station-four-social-private`;
   - `fiveArm` / `station-five-arm` /
     `station-five-arm-social-private`.
2. W12 performs a full private Social Development-state reset, including
   canonical encrypted rows from earlier iterations. It does not attempt a
   mixed private-data migration.
3. It clears exactly `social_private_content_plans`,
   `social_private_content_plan_slots`,
   `social_private_command_receipts`, `social_private_posts`,
   `social_private_comments`, `social_private_audience_snapshots`,
   `social_private_recipient_grants`, `social_private_content_envelopes`,
   `social_private_delivery_intents`, `social_private_object_uploads`,
   `social_private_object_parts`, `social_private_objects`,
   `social_private_object_grants`, and `social_private_commit_proofs`; deletes
   `post_class='private'` rows from `social_comments` and `social_reactions`;
   clears `social_moment_deliveries`; and drops only
   `social_private_audience_grants`.
4. The emptied `social_private_posts` table is rebuilt to the canonical
   encrypted schema. Only the explicit retired-column list in `SC-D23` may be
   removed.
5. Canonical Social-private object bytes and legacy OSS private-media
   references are frozen into an immutable deletion manifest before database
   mutation.
6. Social and OSS owner adapters perform deletion. The reset script cannot
   mutate backend files, S3 objects, or OSS tables directly.
7. Unknown attachment shapes, owner/digest mismatch, or a public,
   Conversation, canonical non-target, or cross-owner reference blocks before
   mutation.
8. Public Posts, public Comments/Reactions, and public Social OSS metadata plus
   bytes receive canonical pre/post hashes.
9. One monotonic journal spans `PREPARED -> DATABASE_SCHEMA_COMMITTED ->
   OBJECTS_DELETED -> STATION_DEPLOYED ->
   POST_AUDIT_PASSED -> COMPLETE`.
10. A partial failure resumes only from the same manifest digest. Station never
    starts from a partial reset, and only `COMPLETE` is success.
11. Key Exchange one-time claims remain consumed; W12 does not reactivate or
    delete them.

## Required Plan Amendment After Acceptance

If both decisions pass review and the Owner accepts them, the plan amendment
must:

1. replace every remaining profile/scope/client drift with the accepted
   `four`/`fiveArm` names and slot `5`;
2. add Runtime Manifest v2 and platform-owner implementation work before
   product scenarios;
3. repair W7/W8 evidence, implement W9, then complete W2D/W10;
4. rerun W7-W10 on the exact W11 checkpoint before allowing W12;
5. implement `schema_audit` and `reset` from the closed allowlist/journal
   contract;
6. run W12 serially for `four` then `fiveArm`, stopping at the first partial
   failure;
7. rerun the complete Desktop/Browser/Mobile/Chat/service matrix;
8. start W13 formal Acceptance only after W12 `FUNCTIONAL_PASS`;
9. preserve `UNPROVEN` for every unrun physical Mobile or formal Gate cell.

## Review Questions

1. Does `SC-D22` preserve Local Dev Control Plane, platform provisioner, and
   business scenario ownership without adding a second runtime authority?
2. Is `four`/slot `5` plus secondary `fiveArm` the only internally consistent
   profile model for this worktree and plan?
3. Does Runtime Manifest v2 remove single-profile assumptions while keeping
   service topology and client isolation canonical?
4. Are iOS Simulator and Android Emulator sufficient for W9 Development
   `FUNCTIONAL_PASS` while physical-only claims remain formal Acceptance
   `UNPROVEN`?
5. Do W7-W12 evidence boundaries prevent API/static/source/deploy observations
   from being promoted into product passes?
6. Are Social, Chat, Development infrastructure, and formal Acceptance
   identities kept distinct?
7. Is a full private Development-state reset preferable to preserving mixed
   canonical/legacy private rows?
8. Is the database table/row/column allowlist complete and narrow enough?
9. Does the object target derivation prevent deletion of public, Conversation,
   shared-CAS, or cross-owner data?
10. Are public snapshot contents sufficient to detect any public Social data or
    object change?
11. Does the journal make database/object non-atomicity safely resumable without
    reintroducing a legacy path or starting a partial Station?
12. Are authorization, source, lease, manifest, and post-audit checks sufficient
    to fail closed before and after destructive mutation?
13. Does the proposed plan ordering restore product-first execution before
    formal Acceptance?

## Required Verdict

Return:

```text
Verdict: PASS | HOLD | REJECT

Findings:
- severity
- exact source reference
- violated invariant or missing semantic
- required correction

Decision checks:
- canonical profiles and controller binding: PASS | HOLD
- single immutable multi-service manifest: PASS | HOLD
- Desktop/Browser/Mobile runtime ownership: PASS | HOLD
- product Journey/evidence partition: PASS | HOLD
- Mobile Development versus physical Acceptance boundary: PASS | HOLD
- exact database reset allowlist: PASS | HOLD
- object ownership/reference safety: PASS | HOLD
- public snapshot completeness: PASS | HOLD
- partial-failure journal and retry semantics: PASS | HOLD
- plan dependency/order correction: PASS | HOLD
```

A `PASS` means the two proposals are internally consistent and ready for
explicit Owner acceptance. It does not accept either decision, authorize
implementation or destructive reset, establish `FUNCTIONAL_PASS`, or start
formal Acceptance.
