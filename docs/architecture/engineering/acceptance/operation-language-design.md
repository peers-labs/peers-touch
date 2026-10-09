# Acceptance Operation Language Design

> **Status**: accepted (architecture self-review passed in a findings-first
> pass; 6 findings fixed and re-reviewed on 2026-10-09)
> **Created**: 2026-10-09
> **Owner**: Architecture Team
> **Module**: `tooling/acceptance/`
> **Layer**: Engineering / Acceptance
>
> Defines the target mechanism by which product acceptance is authored in
> human-readable **operation language** ("tap what, see what") and executed by
> machine from that same source. This is an architecture design; task
> decomposition and sequencing belong to a later execution plan.

---

## 1. Verified Problem Statement

This design starts from an evidence-backed infrastructure problem, not a new
product contract. Evidence classes follow the architecture design methodology.

| # | Claim | Class | Evidence |
|---|-------|-------|----------|
| P1 | A gate launches a really installed app through Appium. | verified_fact | `simulator_e2e.py` creates an Appium session against the built `.app`; observed via `acceptance-run`. |
| P2 | After login, business actions are invoked as internal harness calls (`window.__PEERS_MOBILE_ACCEPTANCE__[action]`), not through visible controls. | verified_fact | `apps/mobile/src/acceptance/registry.ts`; gate `call_action(...)`. |
| P3 | Harness actions call the same production functions as the UI (not mocks). | verified_fact | Both `actions.ts` `messaging.send` and the UI store `socialStore.sendMessage` call `messagingSendMessage` (`services/mobileCommands.ts`). |
| P3b | The call contracts are not identical: the UI path passes `admissionDomain` (write-admission gate); the harness `messaging.send` omits it. | verified_fact | Compare `socialStore.ts` `sendMessage` (passes `admissionDomain`) with `actions.ts` `messaging.send` (does not). Same function, but the harness path bypasses the write-admission argument. |
| P4 | Success is asserted against an internal projection object, not the rendered screen. | verified_fact | gate asserts on `messaging.projection.read` / `social.projection.read`. |
| P5 | Interaction-layer defects (unreachable/occluded/incorrect visible controls, hard-coded copy) can therefore leave the gate green. | inference | From P2 + P4: those layers are not traversed or observed. |
| P6 | The operation intent is encoded as action names and payload keys, with no step boundary and no human-readable "tap/see" layer. | verified_fact | gate source; flat `call_action` sequences. |
| P7 | Human reviewers cannot read the current acceptance as "how to operate, what is shown", and machine acceptance effectiveness is judged poor. | verified_fact | Stated problem; consistent with P5/P6. |

The central defect is a **language and assertion-boundary mismatch**: the
framework proves "production functions return the expected internal state", but
it is read and trusted as "a user can operate the product and see the right
result". It does **not** claim the business logic is fake (P3 refutes that),
but "same production function" is weaker than "same user path": the harness
can omit gates the real UI applies, such as write admission (P3b).

---

## 2. Design Goals And Non-Goals

### Goals

1. Operation language is the **single authored source**: an ordered list of
   steps, each stating the human operation and the expected visible result.
2. The human-readable manual, the machine executor, and the evidence narrative
   are all **derived** from the same steps; they cannot diverge.
3. A business action that a claim depends on is performed through **visible
   controls** by default.
4. Assertions target the **rendered, visible outcome**; internal projections are
   supporting readback, never the sole proof of a user-visible claim.
5. Every step is an explicit boundary: numbered, individually executed and
   evidenced; a failure reports the exact step.
6. Harness use is explicit and confined to environment setup, fault injection,
   and authoritative readback — never to the user operation under claim.
7. Clean cut only: the operation-language mechanism replaces the current one.
   There is no compatibility layer, no dual-running, no adapter/shim, and no
   translation of the old flat `call_action` journeys. The old mechanism is
   deleted, not preserved.

### Non-Goals

- Replacing unit tests or language-level tests.
- Changing Station business logic or the proto contracts.
- Removing the harness; it remains valuable for provisioning and readback.
- Defining task batches, owners, or task sequencing (execution-plan scope).
- Forcing physical-device hardware proof; platform-cell policy is unchanged.

---

## 3. Source Of Truth And Ownership

| Artifact | Owner | Authority |
|----------|-------|-----------|
| Operation-language journeys (`*.journey`) | Acceptance authors | The only authored intent: what is operated and what must be visible. |
| Visible control identity (`data-acceptance-id`, accessible name) | Each client | Binds an operation target to a real rendered control. |
| Visible display text | i18n (`packages/locales`) via locale keys referenced by the step | No hard-coded natural-language strings in journeys or components. |
| Authoritative receiver / business truth | Station, read via existing production actions | Supporting readback for the visible outcome. |
| Internal projection | Client runtime | Diagnostic only; cannot be the sole evidence of a visible claim. |

A journey references controls by **visible identity** (accessible role + name)
and a stable `acceptance-id`. Display names resolve through locale keys so a
journey remains valid across languages without embedding literals.

### 3.1 Serialization and variable rules

- A journey is serialized as **JSON** (the same shape convention as
  `gates.yaml`), parsed through the existing strict object loader. No YAML
  parser or new serialization dependency is introduced.
- Variable interpolation (`${...}`) is allowed only for **named values from
  the run manifest / fixtures** (e.g. Station URL, actor id, receiver id). The
  set of bindable names is a closed allow-list per journey; unknown names fail
  validation.
- Interpolation substitutes scalar, already-validated values with proper
  escaping. Arbitrary expressions, code, or reads outside the allow-list are
  forbidden, so a journey cannot inject behavior or reach outside the run.

---

## 4. Core Model: Operation, Result, Step

Three primitives replace the flat `call_action` sequence:

- **Operation** — one human action on a visible target: `tap`, `type`, `select`,
  or `observe`. Described by visible names, not internal action names.
- **Visible Result** — what an observer must see on a rendered surface: an
  element identified by visible identity appears/disappears, shows given text,
  or a named receiver sees it.
- **Step** — one Operation + one expected Visible Result + a declared execution
  channel + an observer, with a stable id. It is the smallest unit of execution,
  evidence, and failure.

### 4.1 Canonical step shape

Keys are machine-stable; the prose is the human contract. Both describe the
same intent and are validated together.

```yaml
- id: L0-S2
  actor: alice
  channel: ui            # ui | harness
  event: touch           # ui only: touch | dom-event
  operate:
    kind: type-and-tap
    targets:
      - { role: textbox, nameKey: station.address, id: station-address }
      - { role: button, nameKey: station.add, id: station-add }
    input: { station-address: "${station.url}" }
  expect:
    observe: alice-screen
    visible:
      - { role: listitem, nameKey: station.entry, id: station-entry,
          shows: "${station.url}" }
  readback: { source: station, as: supporting }   # optional
```

Semantics:

- `channel: ui` — the operation must be performed by resolving `targets` to
  real, on-screen, non-occluded controls and applying events through the same
  gates the real UI applies (including write admission; see P3b). Resolution
  failure, invisibility, occlusion, or timeout fails the step before any
  assertion. The `event` field states the mechanism and its proof strength:
  - `touch` — a synthesized touch at the resolved control (Appium native tap /
    keyboard input). This is the strongest evidence of "an ordinary user can
    perform it".
  - `dom-event` — a genuine DOM event dispatched at the resolved, visible
    control (its real handler chain runs). It proves the control and handler
    path but not the physical touch surface. It may never be labeled or
    aggregated as `touch`.
  A step defaults to `touch`; `dom-event` is an explicit, weaker choice that
  the derived manual and the aggregate verdict keep visible.
- `channel: harness` — an existing production function is called directly.
  Permitted only for environment setup, fault injection, or readback, and only
  when the step's claim does not depend on a user performing it. Harness steps
  are visually distinguished in the derived manual and excluded from the
  "ordinary user can do it" claim.
- `expect.visible` is evaluated against a rendered surface (the actor's screen,
  or a named receiver's screen). It is the primary assertion.
- `readback` binds an authoritative source (Station) as **supporting** evidence;
  it can corroborate but cannot satisfy `expect.visible` on its own.

### 4.2 Readability is not optional

Each step also carries one prose line rendered from its keys, e.g.:

```text
L0-S2 在「Station 地址」输入 https://station-a:18080，点「Add Station」
      期望：Station 列表出现该地址（在 alice 屏幕可见）
```

The generated manual is a review artifact; a reviewer reads ordered "do /
expect" lines that are exactly what the executor performs.

---

## 5. Execution Mechanism (Target)

A gate run over a journey proceeds per step, strictly in order.

```text
for each step:
  1. resolve targets -> real visible controls (channel=ui) or production fn (harness)
  2. capture pre-step screenshot + DOM
  3. perform the operation via the declared event mechanism, passing the same
     gates the real UI applies (incl. write admission)
  4. evaluate expect.visible on the observer's rendered surface
  5. optionally collect authoritative readback
  6. capture post-step screenshot + DOM; write one step-evidence record
  -> first failing step stops the run; no downstream claim is produced
```

Per-step evaluation timeouts and the visibility/occlusion rules used in steps
1, 3, and 4 are part of the journey contract (specific thresholds are set in
the execution plan), so a step is judged by fixed, declared criteria.

### 5.1 Allowed and forbidden relationships

Allowed:

- Journey → visible-control resolver → real input events.
- Journey → rendered-surface assertion.
- Harness → provisioning, fault injection, and Station readback.
- Projection/diagnostic reads as attached supporting evidence.

Forbidden:

- Using a harness call to perform the **business operation** of a `ui` step.
- Omitting a gate the real user path applies (write admission and any handler
  chain), or otherwise making a weaker call than the UI does (P3b).
- Labeling a `dom-event` step as `touch`, or aggregating it as touch.
- Silently downgrading a `ui` step when a target cannot be resolved: falling
  back from `touch` to `dom-event` or to harness is forbidden; it fails the step.
- Treating an internal projection match as proof of a visible claim.
- Resolving a target by internal action name, DOM coordinates that bypass
  visibility, or any element that is absent/invisible/occluded.
- Skipping a failed step or continuing past it to emit a passing verdict.
- Hard-coded natural-language strings in steps or selectors.

### 5.2 Fail-closed behavior

Missing or ambiguous control binding, an unlocatable visible result, a `ui`
step that cannot be driven through the visible interface, or absent evidence
yields `UNPROVEN` for the journey. A product surface that does not expose a
reachable control for a required step is reported as a **product gap**, not
silently converted to a harness action.

---

## 6. Layering

The L0–L4 layers are retained; each is expressed as one or more journeys.

| Layer | Journey content | Default channel |
|-------|-----------------|-----------------|
| L0 Blocking Smoke | Cold start, add Station, login, enter Shell | ui |
| L1 Product Journeys | Chat, Contacts, Moments, Settings, Recovery business loops | ui for the claimed operation; harness for setup/readback |
| L2 Edge / Fault | Disconnect, replay, conflict, permission, capacity, recovery | ui trigger; harness for fault injection |
| L3 Quality Gates | Accessibility, performance, layout, i18n, secure storage | measured; harness for probes |
| L4 Aggregate / Evidence | Binds per-step evidence and source identity; emits the verdict | derived |

The aggregate verdict reports, per journey, how many required operations were
`touch`, `dom-event`, or `harness`. The allowed claim is derived from that and
cannot exceed it: an ordinary-user operation claim is supported only by the
`touch` count; `dom-event` supports the control/handler path but not the touch
surface. Cross-Station/Relay scope is never inferred from same-Station evidence.

---

## 7. Evidence

One **step-evidence** record per step:

```text
{ stepId, channel, event, actor,
  resolvedTargets: [{ id, role, name, bounds, visible }],
  operation,
  expected: <expect.visible>,
  actual: <observed visible outcome>,
  before/after screenshot refs, before/after DOM refs,
  readback refs, timestamps, result }
```

Validity rule against silent downgrade: a `ui` step's evidence is invalid
unless `resolvedTargets` is non-empty, every target is `visible: true`
(non-occluded), and `event` records the mechanism actually used. A `ui` record
that lacks visible targets or a real event record cannot count as product
proof and keeps the journey `UNPROVEN`.

The run binds source identity (commit, workspace digest), runtime cell, gate/run
id, and artifact hashes. The final report is an ordered step narrative a human
can read, with the failing step (if any) and the exact bounded claim. This
replaces projection-only assertions as the primary evidence form.

---

## 8. Decisions And Alternatives

### Decision A — Operation language is the single source; executor derives from it

- Context: P2/P4/P6 — machine vocabulary and projection assertions are
  unreadable and do not prove operability.
- Rationale: one authored intent removes drift between the manual, the
  execution, and the evidence.
- Alternatives rejected: keep separate manual + script (diverge; the manual is
  trusted but not executed); projection-only assertions (does not prove the
  interaction layer).
- Consequences: authoring is more disciplined; missing reachable controls
  surface as product gaps. The old flat journeys are deleted and re-authored,
  not translated.
- Reversal trigger: none anticipated; reviewed after the first exemplar journey.

### Decision B — Visible-result assertions are primary; projections are supporting

- Rationale: P5 — interaction defects must be able to fail the gate.
- Alternatives rejected: projection as sole proof (current failure mode);
  screenshot-only comparison (brittle, cannot attribute semantic failures).
- Consequences: controls must carry stable visible identity; assertions run on
  rendered surfaces. Negative: higher per-run cost.

### Decision C — A bounded harness is retained (setup/fault/readback only); business-operation actions are deleted

- Rationale: P3 — harness invokes real production functions and is the correct
  tool for provisioning, fault injection, and readback. This is a deliberate
  part of the new design, not a compatibility shim.
- Alternatives rejected: remove harness entirely (makes environment setup and
  fault injection impractical); leave it unbounded (current overclaim risk).
- Consequences: the harness is reduced to setup, fault injection, and readback
  actions per the §9 classification. Business-operation actions and any call
  that bypasses real-UI gates (P3b) are deleted. Each remaining step declares
  its channel and event mechanism; claims cannot exceed the `touch`-verified
  portion.

---

## 9. Clean Cut

The target mechanism is built and the old one is removed. Concrete task
decomposition still belongs to an execution plan, but the cut policy is fixed:

1. Build the operation-language contract and executor.
2. Express journeys directly in operation language. Any required operation with
   no reachable visible control is a product gap, not a reason to keep an old
   path.
3. Delete the superseded mechanism by an explicit action classification:
   - **Retain** actions that are provisioning/setup (`station.add`,
     `*.fixture` setup), fault injection (`reliability.fixture.configure`),
     and readback/projection-read (`*.projection.read`, feed/list reads used
     as supporting readback).
   - **Delete** business-operation actions that a user would perform — e.g.
     `messaging.send`, `messaging.interact`, `messaging.read`,
     `messaging.typing`, `social.request.send/accept`, `social.contact.open`,
     `moments.publish/react/comment`, and their create/open variants — along
     with projection-only primary assertions and their gate wiring.
   - **Delete** any invocation that bypasses a real-UI gate (the
     no-`admissionDomain` call form in P3b).
   Classification rule: an action is retained only if it is setup, fault
   injection, or readback; every action that is itself the claimed product
   operation is deleted. The retained/delete lists are audited against this
   rule so the cut is verifiable, and nothing is retained "just in case" or
   dual-run.
4. The L4 aggregate derives the verdict and bounded claim from per-step
   evidence.

There is no parallel-running period, no adapter translating old journeys, and
no compatibility flag. Keeping the harness for setup/fault/readback is a
deliberate part of the new design, not a compatibility shim.

---

## 10. Related Documents

- [Acceptance Framework README](./README.md)
- [design.md](./design.md) — current layered model and core contracts.
- [data-model.md](./data-model.md) — run manifest, Evidence Store, ArtifactRef.
- [coverage-report.md](./coverage-report.md) — current coverage projection.
