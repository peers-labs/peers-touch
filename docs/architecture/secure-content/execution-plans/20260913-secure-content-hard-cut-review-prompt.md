# Secure Content Hard Cut - Plan Review Prompt

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-13 | **Updated**: 2026-09-13
> **Owner**: Architecture Team

---

You are reviewing a Peers-Touch execution plan for a cross-domain Secure Content
hard cut.

## Plan Background

The plan replaces Social's plaintext private Post/Comment persistence, bespoke
media crypto, signaling key envelopes, and public ciphertext object access. It
extracts shared crypto/validation kernels while preserving Social and Conversation
as independent authority, transaction, route, table, grant, and object owners.

## Accepted Product Sources

- `docs/architecture/social/product-definition.md`
- `docs/architecture/social/experience-contract.md`
- `docs/architecture/social/product-state-model.md`
- `docs/architecture/social/acceptance-matrix.md`
- `docs/architecture/messaging-platform/product-definition.md` (`MP-C13`)
- `docs/architecture/messaging-platform/experience-contract.md` (`MP-J11`)
- `docs/architecture/messaging-platform/acceptance-matrix.md` (`MP-G13`)

## Accepted Architecture Sources

- `docs/architecture/secure-content/README.md`
- `docs/architecture/secure-content/design.md`
- `docs/architecture/secure-content/security.md`
- `docs/architecture/secure-content/operations.md`
- `docs/architecture/secure-content/data-model.md`
- `docs/architecture/secure-content/integration.md`
- `docs/architecture/secure-content/module-layout.md`
- `docs/architecture/local-dev-control-plane/` (`LDCP-D01..LDCP-D09`)

## Plan

- `docs/architecture/secure-content/execution-plans/20260913-secure-content-hard-cut.md`
- `docs/architecture/secure-content/execution-plans/20260913-secure-content-work-items.yaml`
- `docs/architecture/secure-content/execution-plans/20260913-secure-content-journeys.yaml`

## Required Review

1. Verify every product-facing workstream traces to `SOC-SEC-C01..C09`,
   `SOC-SEC-J01..J09`, `SOC-SEC-AS01..AS16`, `SC-A01..SC-A08`, and
   `SC-D01..SC-D13`; verify W0R traces only to accepted
   `LDCP-D01..LDCP-D09`.
   Verify the YAML artifacts satisfy the exact `DevelopmentWorkItem`,
   `DevelopmentResourceIntent`, `ExecutionAuthorization`, and
   `DevelopmentJourney` schemas, including the machine identifier regex.
2. Verify the dependency DAG is real: proto before generated consumers, kernels
   before adapters, owner contracts before Social, consumers before deletion,
   functional pass before Acceptance.
   Verify W1's focused generator can write only its declared Station Go plus
   Desktop/Mobile TypeScript output roots, limits Rust changes to declared
   build-input/module files, and cannot touch unrelated, applet, or absent legacy
   Android/iOS native-project output.
   Verify the current ad hoc declaration is released, W0/W0R/W4 use explicit
   `dev-start`, and later YAML projection/readback uses `dev-update` only for an
   already-live item.
3. Verify Social and Conversation remain independent route/UOW/table/grant/object
   owners and no hidden `/secure-content/*` business authority is introduced.
4. Verify PreKey claim replay, outer transaction atomicity, object attach/GC,
   recovery, cancellation, storage-full/overload, cleanup retry, and
   account-switch lifecycles are complete, including every outer-UOW write
   boundary failpoint.
5. Verify FRIENDS, GROUP, all Post subtypes, comments, reactions, mentions,
   recovery, Browser rejection, and public continuity have executable scenarios.
6. Verify W11 deletes every old source owner, generated symbol, route, fixture,
   test, doc and runtime caller without a compatibility shim, while physical
   legacy schema/data deletion is deferred to W12's explicitly authorized reset
   and no production path can reach the dormant schema between those closures.
7. Verify current `MCA-001` source claims and
   `native-desktop-runtime-cells` runtime/source claims are parked and never
   overwritten by this plan.
8. Verify local checkpoint authorization and conditional existing-profile deploy
   are scoped correctly, while reset, environment creation, push, PR, and history
   rewrite remain behind their explicit authorization boundaries. Verify every
   deploy activates the named profile, parses `make config`, atomically
   acquires/holds/releases the canonical live lease through `make station`, and
   never relies on `make station-restart PROFILE=...`. Verify W0R implements the
   accepted Local Dev Control Plane rather than a Secure Content-specific lease.
9. Verify each completion claim has a named command, receiver-perspective
   evidence, matching Journey/runtime resource claims, and explicit `UNPROVEN`
   behavior when a runtime cell is missing. Verify command budgets exactly match
   Journey YAML and W2 proves `MP-G13` on Desktop, iOS Simulator and Android
   Emulator Native. Verify every WorkItem class is allowed by every referenced
   Journey.
10. Verify every Mobile-visible publish, read, Comment and media state is named
    in the Mobile Journey, including private image and video.
11. Identify any plan item that redesigns the accepted architecture instead of
    executing it.

## Output Format

### Overall verdict

`PASS`, `CONDITIONAL_PASS`, or `REVISE`.

### Findings

List findings in severity order with exact plan/source line references.

### Dependency and concurrency assessment

State whether the DAG, parallel lanes, source ownership, and reconcile ownership
are safe.

### Acceptance assessment

State whether every required product transition and failure mode has an executable
receiver-perspective scenario.

### Required changes

List only changes required before PLAN approval. If none, state `none`.
