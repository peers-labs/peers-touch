# Operational Knowledge Layer

> Status: Canonical. Owner: Architecture.
> Audience: humans AND AI agents acting on this codebase.
> Updated: 2026-09-19

---

## 1. What this directory is

The **operational knowledge layer** captures the kind of project knowledge that doesn't fit anywhere else:

- Things that are **true across multiple subsystems** but cannot live in any one of them.
- Things we **already paid for** (bugs hit, near-misses caught at review) and don't want to pay for again.
- Things that **describe how to do recurring work** without prescribing implementation.
- Project-specific **terminology** that isn't in any standard glossary.

This sits **below** architecture / design and **above** code comments in the documentation source hierarchy (see `AGENTS.md §3`):

```
Architecture        — what / why at the system level     (docs/architecture/)
Platform / spec     — how each platform implements it    (docs/{client,station,global}/)
Decisions           — point-in-time trade-offs           (docs/context/decisions/)
► Operational KB ◄  — invariants / pitfalls / playbooks  (THIS DIR)
Subsystem           — surface API + local README         (per-dir README.md)
Code                — line-level intent                   (in-file comments)
```

Anything that would otherwise be lost in PR descriptions, commit messages, or session memory belongs here.

---

## 2. Three kinds of files

### 2.1 `invariants/` — what must always hold

Cross-cutting properties that any code touching the named paths MUST respect.

Examples in this repo:

- "the relay readLoop must never block on disk I/O or contended mutexes"
- "every locator-publisher caller is either user-driven (broadcast) or maintenance (no broadcast); there is no third category"

Invariants are written as **negative space** — what cannot happen — not as "how to do things". They tend to be small (a few hundred lines) and stable (rare edits).

### 2.2 `pitfalls/` — what we already paid for

A pitfall captures a specific bug or near-miss with enough context that the next person doesn't repeat it. Format:

- **Symptom**: what was observed.
- **Root cause**: the system property that allowed it.
- **Mitigation**: what was done in code AND what guards it from regression.
- **How to detect a recurrence**: a grep / metric / test that fires if the bug returns.

Pitfalls are typically born from review findings, incidents, or "I almost shipped …" moments. They are append-only — never delete a pitfall, mark `status: superseded-by:<path>` if a follow-up made the original obsolete.

### 2.3 `playbooks/` — how to do a recurring class of task

A playbook is the standard operating procedure for a category of work that we've done at least twice and will do more.

Examples:

- "adding a federation broadcast topic" — covers proto + relay allow-list + handler + receiver gate + metrics
- "introducing a new actor visibility state" — covers proto + DB column + UI + locator-hook + republisher

Playbooks reference the relevant invariants and pitfalls so that following one automatically respects them.

---

## 3. Frontmatter contract

Every file in `invariants/`, `pitfalls/`, `playbooks/` has YAML frontmatter at the top:

```yaml
---
kind: invariant | pitfall | playbook
title: <one line, human-readable>
status: active | deprecated | superseded-by:<relative-path>
owns:
  - <repo path that this knowledge governs>
  - <repo path>
referenced-by:
  - <other knowledge file path>
related:
  - <ADR / architecture doc / external link>
detected: YYYY-MM-DD
---
```

The `owns:` field is **machine-readable** and load-bearing:

- `tooling/skills/pt-read-before-edit/` greps every `owns:` entry across this directory before any Edit tool fires. Files matching one or more `owns:` paths cause the corresponding knowledge file to be loaded into the agent's context as a reviewer's voice.
- A knowledge file with no `owns:` is allowed (e.g. cross-cutting glossary) but will never auto-trigger; humans must reference it explicitly.

Non-knowledge files (`README.md`, `_TEMPLATE.md`, `glossary.md`) are exempt.

---

## 4. Lifecycle

| Event | Action |
|-------|--------|
| Bug shipped, root cause identified | Add a `pitfall/` entry in the same PR as the fix |
| Invariant discovered (e.g. during review) | Add an `invariant/` entry, link it from any subsystem `CONSTRAINTS.md` |
| Same task done ≥ 2× with the same shape | Promote the procedure to a `playbook/` |
| Knowledge becomes obsolete | Mark `status: superseded-by:<path>` and link to the replacement; never delete |
| New term coined for the domain | Add to `glossary.md` |

Promotion path:

```
session insight ──► PR comment ──► commit message ──► .localenv note
                                                           │
                                                           ▼
                                                  pitfall / invariant
                                                  (in this directory)
                                                           │
                                                           ▼
                                              playbook / architecture doc
                                              (when generalized to a class)
```

---

## 5. What this layer is NOT

To prevent dilution:

- **Not architectural design.** If the knowledge defines a system relationship or boundary, it goes to `docs/architecture/` instead.
- **Not coding style.** If the knowledge is "name things this way" / "format files like that", it goes to `docs/global/coding-guide/`.
- **Not a runbook.** Operational steps for running the system live next to the deployment artifacts (`tooling/scripts/`, `tooling/docker/`, `.localenv`).
- **Not a wiki.** A knowledge file that doesn't end with a verifiable rule (an `invariant`'s "must hold", a `pitfall`'s "how to detect a recurrence", a `playbook`'s checklist) is incomplete and should not be merged.

When in doubt: if the file doesn't tell you what to **do or not do** the next time you touch a specific path, it doesn't belong here.

---

## 6. Reading entry points

Pick one based on intent:

- **"I'm about to edit code in path X"** → grep `owns: $X` here, read every match.
- **"I want to do task class Y"** → check `playbooks/` first.
- **"I'm reviewing a PR that touches federation"** → start with `invariants/relay-readloop-discipline.md` and `invariants/locator-publisher-symmetry.md`.
- **"What does term Z mean in this project?"** → `glossary.md`.

---

## 7. Index

### Invariants (active)

- [`invariants/relay-readloop-discipline.md`](invariants/relay-readloop-discipline.md) — readLoop goroutines must dispatch blocking work asynchronously.
- [`invariants/locator-publisher-symmetry.md`](invariants/locator-publisher-symmetry.md) — `PublishVisibility` callers split into "user-driven" (broadcast) and "maintenance" (no broadcast); no third category.
- [`invariants/chat-message-boundaries.md`](invariants/chat-message-boundaries.md) — Chat message content must not be covered by actions, metadata, composers, safe areas, or floating layers.
- [`invariants/mobile-chat-layout-boundaries.md`](invariants/mobile-chat-layout-boundaries.md) — Mobile Chat bottom layers must participate in one bottom clearance model.
- [`invariants/desktop-chat-layout-boundaries.md`](invariants/desktop-chat-layout-boundaries.md) — Desktop Chat actions must respect conversation pane bounds and collision handling.
- [`invariants/composite-form-control-boundaries.md`](invariants/composite-form-control-boundaries.md) — composite form controls that represent one semantic input must share one parent frame and state model.
- [`invariants/desktop-identity-lifecycle-closure.md`](invariants/desktop-identity-lifecycle-closure.md) — Desktop identity/profile/account/avatar projections must close through the identity state machine.
- [`invariants/access-gate-wire-contract.md`](invariants/access-gate-wire-contract.md) — `AccessDecision` consumers must tolerate snake_case-first keys and match enums by both number and string name across Go→Rust→TS.
- [`invariants/actor-ref-account-is-persisted-identity.md`](invariants/actor-ref-account-is-persisted-identity.md) — `ActorRef.acct` comes from the persisted federated handle, never request transport.
- [`invariants/actor-presence-ownership.md`](invariants/actor-presence-ownership.md) — actor presence belongs to the global presence owner, not chat subservers or chat proto models.
- [`invariants/direct-receipt-endpoint-truth.md`](invariants/direct-receipt-endpoint-truth.md) — Direct receipt aggregation uses immutable event commitments, not Group/MLS device rows.
- [`invariants/dev-resource-declaration-before-write.md`](invariants/dev-resource-declaration-before-write.md) — non-trivial work publishes machine-visible source/runtime intent before mutation and releases it after cleanup.
- [`invariants/plan-mount-is-run-bound.md`](invariants/plan-mount-is-run-bound.md) — an explicit mount binds one frozen Plan Version to one execution worktree for the full run.
- [`invariants/bound-plan-acceptance-impact-is-scoped.md`](invariants/bound-plan-acceptance-impact-is-scoped.md) — a bound Plan computes Acceptance impact only from its exclusive-write source closure.
- [`invariants/workspace-active-work-is-local.md`](invariants/workspace-active-work-is-local.md) — workflow code is distributed, while each consuming worktree exclusively owns its own machine-local active-work record.
- [`invariants/continuous-plan-run.md`](invariants/continuous-plan-run.md) — one authorized Plan Run continues across Task, Goal, review, Anchor, and context boundaries until completion or a true hard stop.
- [`invariants/host-neutral-agent-execution.md`](invariants/host-neutral-agent-execution.md) — project scheduling, runtime verification, Session, evidence, and cleanup semantics remain independent of TRAE, Cursor, Codex, or future hosts.
- [`invariants/user-skill-overlays-are-interaction-only.md`](invariants/user-skill-overlays-are-interaction-only.md) — machine-local user overlays may shape interaction only and cannot alter project execution semantics.
- [`invariants/conversation-bound-workflow-kernel.md`](invariants/conversation-bound-workflow-kernel.md) — one host conversation has one immutable execution root; tool subject roots cannot silently change write authority.
- [`invariants/worktree-observation-is-diagnostic.md`](invariants/worktree-observation-is-diagnostic.md) — each worktree owns its opportunity report while Dev UI discovery and freshness remain non-authoritative.
- [`invariants/desktop-vite-entry-readiness.md`](invariants/desktop-vite-entry-readiness.md) — Desktop startup and reuse require the Vite renderer entry module to respond successfully.
- [`invariants/acceptance-suite-runtime-reuse.md`](invariants/acceptance-suite-runtime-reuse.md) — multi-scenario Acceptance provisions expensive resources once at Suite scope and keeps Scenarios attach-only.
- [`invariants/desktop-sqlite-path-budget.md`](invariants/desktop-sqlite-path-budget.md) — Desktop database paths compact oversized identity-derived scopes without changing encryption identity or existing short paths.

### Pitfalls

- [`pitfalls/c1-tombstone-only-broadcast.md`](pitfalls/c1-tombstone-only-broadcast.md) — first cut of Tier C1 fired invalidation only on tombstone, leaving BY_HANDLE/INDEXED transitions and profile updates on the slow path.
- [`pitfalls/republisher-broadcast-spam.md`](pitfalls/republisher-broadcast-spam.md) — naive "broadcast on every PublishVisibility success" turns periodic republisher into a relay traffic generator.
- [`pitfalls/social-ui-identity-surface-fragmentation.md`](pitfalls/social-ui-identity-surface-fragmentation.md) — Social UI surfaces must not fragment content rail, action row, trust meta, thread, or incomplete-capability states.
- [`pitfalls/mobile-chat-conversation-actions-right-drawer.md`](pitfalls/mobile-chat-conversation-actions-right-drawer.md) — Mobile Chat conversation actions must use bottom sheets or settings pages, not phone-width right drawers.
- [`pitfalls/mobile-private-runtime-policy-readiness-divergence.md`](pitfalls/mobile-private-runtime-policy-readiness-divergence.md) — Private Mobile runtimes must reuse shared Station-origin policy and publish asynchronous activation failures through lifecycle readiness.
- [`pitfalls/acceptance-core-transport-import-cycle.md`](pitfalls/acceptance-core-transport-import-cycle.md) — Core attestation must receive remote source identity from a Provisioner adapter instead of importing concrete SSH transport.
- [`pitfalls/acceptance-mutable-artifact-rewrite.md`](pitfalls/acceptance-mutable-artifact-rewrite.md) — mutable runtime logs must be written once, after the producing client stops, when the Evidence Store path is immutable.
- [`pitfalls/acceptance-shared-validator-variant-assumptions.md`](pitfalls/acceptance-shared-validator-variant-assumptions.md) — shared Gate validators must derive journey and topology semantics from the active Gate variant.
- [`pitfalls/native-chat-gates-require-federation-context.md`](pitfalls/native-chat-gates-require-federation-context.md) — Native Direct and Group creation must pass a Federation shared by every participating client.
- [`pitfalls/public-api-owner-must-follow-resource-domain.md`](pitfalls/public-api-owner-must-follow-resource-domain.md) — public capabilities must be registered by their resource owner, never by an internal implementation namespace.

### Playbooks

- [`playbooks/adding-federation-broadcast-topic.md`](playbooks/adding-federation-broadcast-topic.md) — full path for a new relay-mediated broadcast topic.
- [`playbooks/ux-case-to-contract.md`](playbooks/ux-case-to-contract.md) — promote concrete UX examples into reusable contracts, platform refinements, invariants, and acceptance matrices.
- [`playbooks/adding-an-access-gate.md`](playbooks/adding-an-access-gate.md) — proto → Station gatekeeper → Dashboard → Desktop/Mobile renderer for a new access gate.
- [`playbooks/documenting-large-requirements.md`](playbooks/documenting-large-requirements.md) — required path for module-level demands, architecture work, and large cross-layer feature rebuilds.

### Reference

- [`glossary.md`](glossary.md) — project-specific terminology.
- [`_TEMPLATE.md`](_TEMPLATE.md) — file template with frontmatter.
