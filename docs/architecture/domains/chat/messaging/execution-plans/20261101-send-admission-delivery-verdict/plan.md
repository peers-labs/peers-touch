# Send Admission Idempotency And Delivery Verdict — Execution Plan

> **Created**: 2026-11-01
> **Decisions**: MP-D33, MP-D34 (`../decisions.md`)
> **Amendments**: design.md §6.5, §9.1
> **Scope class**: product behavior, Desktop full; Mobile schema/protocol follow only
> **Authorization**: Owner accepted design + four scope forks on 2026-11-01.
> Push/PR/release remain denied until Owner verification.

## Goal

1. A send action has exactly one durable admission outcome, regardless of
   double click, ambiguous timeout, or worker-wake failure: no duplicate
   messages and no "queued + failed" contradiction.
2. The sender eventually sees an honest verdict — queued-with-reason,
   submitted, delivered (x/N in groups), terminal failure with reason, or a
   clearly labeled *unconfirmed* judgment after a horizon — with one explicit
   retry action. Delivery is not guaranteed and retries never stop.
3. Normal-scenario load is continuously observable end to end, including
   Station logs, runtime, and host load, through horizontal acceptance.

## Non-Goals

- Guaranteed delivery, post-admission cancel, or negative transport facts.
- Mobile verdict UI (Mobile follows shared schema only).
- Station-persisted send-intent or cross-device admission dedupe (documented
  future option in MP-D33).
- A new delivery-truth owner, polling protocol, or SLO enforcement gate.

## Fixed Parameters

- Command convergence horizon: 60s after admission without `submitted`.
- Delivery horizon: 24h after `submitted` without a positive delivery fact.
- Both are device-local projection constants; neither stops outbox retry.
- Load gate environments: whatever the selected reviewed Profile provides
  (same-station / cross-station topology is read from the Profile, not
  hardcoded).

## Phase 0 — Incident Attribution (read-only, must precede claims)

- Recover the 2026-10-31 15:31 event from corpdebug Station logs and the
  sender's local messaging store: confirm the draft-deferred path and the
  exact typed error (`station_unavailable` / plan prepare / wake).
- If the evidence contradicts MP-D33's ledger claims, amend the decision
  before implementation. Evidence lives in the debug workspace, not Git.

## Phase 1 — MP-D33 Send Admission (Desktop + shared core)

Shared core / local store:

- `messaging-store-v1` single-writer migration: add `send_intent_id` to the
  pending-message admission row and a unique constraint
  `(sender_device_id, send_intent_id)`; idempotent read-before-create returns
  the existing message's current outcome. Mobile adapter compiles against the
  migrated schema (no renderer behavior).
- Engine `submit_message` accepts the intent, takes the existing send-intent
  lock, and returns the same `message_id`/state for repeat intents; attachment
  upload batches share the intent and are not duplicated.
- Wake failure after admission no longer fails the command; it is logged and
  left to the lifecycle worker.

BFF/IPC:

- `messaging_send_message` envelope carries `send_intent_id`; the command
  result is a typed tri-state (`admitted:draft|pending` | `rejected:<code>`);
  internal errors before durable write map to rejected with typed cause.
- Expose renderer-readable post-admission reconciliation (message/command
  state query reusing MP-D31 truth).

Renderer:

- Renderer mints one intent per user send action; composer in-flight dedupe is
  intent-keyed; clear composer on any `admitted` (including deferred draft);
  restore content only on `rejected`; never auto-resend; resolve uncertainty
  via the state query.
- Remove the `requireQueuedMessagingSendOutcome` throw semantics for drafts.

Verification: Rust unit tests (duplicate intent, deferred-draft idempotency,
wake failure admission survives), TS store/composer tests, tsc/check/build,
static gate additions, native Journey — double click + Station-down admission
produces one row and one outcome.

## Phase 2 — MP-D34 Verdict Projection

Projection enrichment (existing data, no new transport facts):

- Surface `last_error_code`, `next_attempt_at_unix_ms`, attempt count from the
  attempt store in the message projection; add aggregate delivery fields
  (required/consumed/revoked/delivered/fully_delivered) from per-device
  receipt projections already delivered to the originator inbox.
- Local horizon evaluator in the messaging runtime projection (no durable
  transport writes): `submit_overdue`, `undeliverable_suspected`; terminal
  reject and later receipts always override.

Renderer:

- MetaRow states: queued / queued-retrying (+reason, next attempt) /
  submitted / delivered / fully_delivered / read / failed-terminal (+reason,
  retry) / submitted-unconfirmed horizon state with age and "retry now" using
  the same command identity; group rows show `x/N delivered`.
- i18n en + zh-CN; UX/experience contracts updated; visual design follows the
  existing chat UI identity (LobeUI/antd as per current surfaces).

Station (only if required):

- Add a Conversation-owned sender-readable aggregate query only if a fresh
  device cannot reconstruct aggregates from its receipt stream; reuses
  existing aggregate computation; no fabricated receipts.

Verification: projection unit tests (horizon transitions, receipt upgrade
after suspected, terminal override, group counts), native Journeys —
Station-down 60s overdue cue, 24h verdict (time-scaled where supported),
recovery flips to delivered, terminal reject reason + retry.

## Phase 3 — Horizontal Load Acceptance

- New feature contract `tooling/acceptance/features/chat-runtime-load.yaml`:
  normal-scenario mixed traffic (Direct + MLS Group, cross-Station where the
  Profile provides it; mostly text, a small share of attachments), bounded
  duration and actor count from the Profile capability, not hardcoded.
- New gate family `tooling/acceptance/gates/chat/chat_load_*` reusing
  profiles/leases/fixtures/native harness/fault-proxy patterns; no second
  driver framework.
- Assertions: zero duplicate admissions (send-intent uniqueness), command
  terminal convergence, p50/p95 delivery latency recorded as regression
  observation (not a hard SLO gate), no error-level Station log signatures,
  Station `/sub-oss/healthz` + bearer `/sub-oss/metrics` snapshots, host
  load/CPU/mem snapshots through the existing audited ops path (extend
  machine-dev ops only if no log/load path exists — an audited subcommand, not
  ad-hoc SSH), evidence into the Evidence Store.
- Register in the acceptance matrix and gates registry; classify as
  horizontal/normal-scenario acceptance, explicitly non-isomorphic to
  functional Journeys.

## Phase 4 — Official Site Architecture Expression

Repository: `peers-touch-show/apps/official-site`.

- New archify source `journey-send-verdict.{en,zh}.json`: send-intent
  admission -> durable outbox -> exact-bytes retry -> authority accepted
  (not delivery) -> per-device receipts/aggregate -> horizon verdict; fact vs
  local-judgment visually separated.
- AtlasPreview bilingual entry; render through the existing build-time
  pipeline. No house-style board (flow semantics use archify).

## Phase 5 — Formal Native Closure

- FUNCTIONAL_PASS only after exact-source native Journeys for: duplicate
  admission, deferred-draft failure semantics, retry-with-reason, horizon
  verdict + receipt upgrade, group x/N, terminal failure reason/retry, plus
  one normal-scenario load run on the selected Profile with Station
  logs/metrics/host evidence.
- Resource disposition and debug workspace cleanup follow the standard lease
  contract. `undeliverable_suspected` at the true 24h horizon on a recovered
  peer is UNPROVEN unless the evaluator supports bounded time acceleration in
  the acceptance build; prove the transition via the accelerated path and
  label real-time 24h behavior accordingly.

## Risk Register

- Migration risk on the shared local store: single-writer migration, old
  clients, Mobile adapter compile gate.
- Group aggregate completeness: requires correct originator routes and
  cross-Station receipt forwarding; missing proof stays UNPROVEN per surface.
- Load gate flakiness on shared remote Profiles: observation-only thresholds,
  labeled runs, no destructive reset.
- Horizon UX misread as failure: copy and meta-treatment must distinguish
  "unconfirmed, still retrying" from terminal failure; UX review gate.
