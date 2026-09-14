# Secure Content Hard Cut - Execution Plan

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-13 | **Updated**: 2026-09-13
> **Owner**: Architecture Team
> **Entry Stage**: PLAN

---

## 1. Goal

Deliver E2EE private Social Posts through one portable crypto implementation while
Social and Conversation remain independent route, transaction, table, grant, and
object authorities.

The plan first performs an atomic shared-kernel/Chat-preservation closure, then
reaches one real Social Desktop sender/receiver `FUNCTIONAL_PASS` before broad
Social subtype, Mobile, hard-cut, or Acceptance expansion.

## 2. Accepted Sources

Product:

- `docs/architecture/social/product-definition.md`
- `docs/architecture/social/experience-contract.md`
- `docs/architecture/social/product-state-model.md`
- `docs/architecture/social/acceptance-matrix.md`
- `SOC-SEC-C01..C09`, `SOC-SEC-J01..J09`, `SOC-SEC-AS01..AS16`

Architecture:

- `docs/architecture/secure-content/{README,design,security,operations,data-model,integration,module-layout}.md`
- `docs/architecture/secure-content/decisions.md`
- `SC-A01..SC-A08`
- `SC-D01..SC-D13`

Retained authorities:

- `docs/architecture/api-ownership/`
- `docs/architecture/messaging-platform/`
- `docs/architecture/messaging-platform/product-definition.md` (`MP-C13`)
- `docs/architecture/messaging-platform/experience-contract.md` (`MP-J11`)
- `docs/architecture/messaging-platform/acceptance-matrix.md` (`MP-G13`)
- `docs/architecture/encryption/`
- `docs/architecture/local-dev-control-plane/` (`LDCP-D01..LDCP-D09`)
- `docs/client/desktop/runtime-projections.md`
- `docs/architecture/mobile/`

## 3. Worktree Binding

| Field | Value |
|---|---|
| Worktree | `peers-touch-federation (<repo-root>)` |
| Branch | `feat/federation` |
| Workspace ID | `9eb2cb904c9ae460` |
| Initial HEAD | `2d54851f95994d717928105aca6470c30adf3657` |
| Expected HEAD | `2d54851f95994d717928105aca6470c30adf3657` |
| Worktree-set digest | `4b41b36f2a0a6704e9779efc97495b76bbe1cd0b1427a1d564baf306025281c4` |

Initial HEAD is immutable. Expected HEAD advances only through authorized local
checkpoint commits or an explicitly authorized merge/rebase.

## 4. Authorization Envelope

The Owner delegated autonomous stage/task orchestration on 2026-09-13.

| Capability | Authorization |
|---|---|
| Architecture-conformant source edits | allowed on conflict-free declared paths |
| Parallel subagents | allowed for disjoint write sets; integrator owns shared files |
| Local checkpoint commits | allowed for exact-source Development execution |
| Current worktree registration | allowed for verified `peers-touch-federation`, tracked profile `four`, workspace slot 5 |
| Existing remote profile inspection/connect | allowed when registered and unleased |
| Remote Station deploy/restart | requires an exact selected existing profile and exclusive lease |
| Environment/profile creation | denied without exact human authorization |
| Destructive reset | denied until exact Station/profile/table/object scope is approved |
| Push | denied until final Owner acceptance |
| Pull request | denied until final Owner acceptance |
| History rewrite | denied |

No authorization may be widened by implementation convenience.

## 5. Scope

In scope:

- shared Secure Content proto, Rust core, and stateless Station Go kernel;
- endpoint/recovery Content PreKeys and strict Optional JWT;
- Social FRIENDS/GROUP/follower/circle/custom snapshots;
- private Post/Comment/object persistence and all Post subtypes;
- Desktop pilot, expanded Desktop, Mobile parity, and Chat internal-core reuse;
- source/schema/route/generated hard cut and authorized development-data reset;
- Development-first functional closure and later formal Acceptance.
- implementation of the already-accepted machine workspace registration and
  Station capability lease contract required by every remote functional run;

Out of scope:

- private Social federation;
- Conversation membership, event, Direct, MLS, receipt, history, route, UOW,
  table, or grant semantic changes;
- Browser private content;
- production data migration;
- DRM or deletion of malicious recipient copies.

## 6. Current-State Inventory

| Surface | Current owner/path | Required action |
|---|---|---|
| Social wire | `model/domain/social/{post,media,comment,poll}.proto` | add typed private contracts; remove legacy envelope/visibility |
| Generated bindings | Station Go, Desktop TS/build-time Rust, Mobile TS/build-time Rust | regenerate only the Secure Content/Common/Social/Key Exchange allowlist under one integrator |
| Private Post | plaintext `SocialPrivatePost` | encrypted canonical payload |
| Private Comment | shared plaintext `SocialComment` | physically separate encrypted table |
| Friendship | accepted `social_relationship_projections` plus legacy reads | accepted projection only |
| GROUP | production Noop checker | Conversation revision-bound query port |
| Social object path | Desktop bespoke crypto + public OSS | Social-owned encrypted-object plane |
| Social envelopes | TS + signaling envelope | Native one-time HPKE plans |
| Point GET auth | no optional JWT | shared strict Optional JWT |
| Chat reusable core | `messaging-core::{attachment,codec}` | extract atomically with shared core and prove MP-J11 before Social consumes it |
| Conversation objects | Conversation routes/UOW/tables/grants | retain ownership and behavior |
| Recovery | whole opaque Messaging archive | actor recovery PreKeys and paginated envelopes |
| Operational readers | stats, Dashboard, moderation, notifications, migrations | migrate with schema |
| Acceptance | existing Social/Mobile/Chat gates | inject only after functional pass |
| Machine runtime control | observed registry only; no authoritative registration/lease CLI | implement accepted workspace binding plus atomic `station.deploy`/`station.reset` lease enforcement before remote use |

## 7. Plan-Derived Resource Intent

Each workstream publishes only its ready write set before mutation. The full
potential source set is:

```text
model/domain/secure_content
model/domain/social
model/domain/key_exchange
model/domain/common
tooling/scripts/proto-gen-secure-content.sh
tooling/scripts/local-dev
tooling/scripts/lib/machine-dev-paths.mjs
tooling/scripts/local_dev_profile_resolution_test.py
tooling/scripts/deploy/deploy.sh
tooling/acceptance/tests/test_profile_lease.py
tooling/make/local-dev.mk
tooling/skills/pt-local-dev-env
packages/secure-content-core
packages/messaging-core
apps/station/app/internal/securecontent
apps/station/app/subserver/social
apps/station/app/subserver/key_exchange
apps/station/app/subserver/recovery
apps/station/app/subserver/conversation
apps/station/app/subserver/dashboard
apps/station/app/subserver/oss
apps/station/frame/core/auth
apps/station/frame/touch/model
apps/desktop
apps/mobile
tooling/acceptance
docs/architecture/secure-content
docs/architecture/social
docs/architecture/messaging-platform
docs/knowledge
```

Pure source and bounded in-process service work has no external runtime claim.
Native functional workstreams add exact existing profile, Station deploy,
client storage, Fixture and local-slot claims before acquisition.

## 8. Development Work Item Contracts

Machine-shaped authoritative contracts:

- `docs/architecture/secure-content/execution-plans/20260913-secure-content-work-items.yaml`
- `docs/architecture/secure-content/execution-plans/20260913-secure-content-journeys.yaml`

All work items use:

```text
planRef = docs/architecture/secure-content/execution-plans/20260913-secure-content-hard-cut.md
```

| ID | Work class | Product / acceptance refs | Architecture refs | Journey IDs | Include / exclude |
|---|---|---|---|---|---|
| `secure-content-w0` | documentation | accepted PRODUCT set | all Secure Content docs | none | docs/plan/tracking only; exclude code/runtime |
| `secure-content-w0r` | infrastructure | none; runtime prerequisite only | `LDCP-D01..D06/D08/D09` | machine registration and lease-control Journey | canonical Local Dev Control Plane only; exclude env creation/product runtime |
| `secure-content-w14` | infrastructure | none; W1 preparation only | `SC-A01/SC-A03`; `SC-D02` | none | scoped generator and its isolated tests only; exclude proto/generated/runtime changes |
| `secure-content-w1` | infrastructure | `SOC-SEC-C02/C03/C04/C05/C08`; `SOC-SEC-AS03/04/08/13/14/16` | `SC-A03/A04/A08`; `SC-D02/D05/D07/D09/D12` | `SOC-SEC-J01/J02/J03/J05/J06/J07` | allowlisted proto/generated consumers only; exclude unrelated generated output/runtime |
| `secure-content-w2` | refactor | `MP-C13`; `MP-G13` | `SC-A01/A03`; `SC-D02/D03/D13`; `MP-D23` | `MP-J11` Desktop and Mobile Native | shared kernels + Chat internal adapters; exclude Chat wire/API/schema/behavior |
| `secure-content-w3` | infrastructure | `SOC-SEC-C04/C05`; `SOC-SEC-AS08/16` | `SC-A04/A08`; `SC-D05/D09/D12` | `SOC-SEC-J01/J07` | Content PreKeys only; exclude Direct/MLS |
| `secure-content-w4` | infrastructure | `SOC-SEC-C03`; `SOC-SEC-AS04` | `SC-A05`; `SC-D08` | `SOC-SEC-J03` | Optional JWT plus generic Development runner bootstrap; exclude domain policy and later scenario logic |
| `secure-content-w5` | infrastructure | `SOC-SEC-C04/C06/C08`; `SOC-SEC-AS08` | `SC-A02/A08`; `SC-D05/D09` | `SOC-SEC-J07` | recovery derivation/query; exclude Messaging history redesign |
| `secure-content-w6` | product-behavior | `SOC-SEC-C01/C02/C03/C05/C07`; `SOC-SEC-AS01/03/04/05/06/07/10/12/13/15/16` | `SC-A01..A08`; `SC-D01..D08/D11..D13` | `SOC-SEC-J01/J02/J03/J04/J06/J09` | FRIENDS text+image Social minimum and outer-UOW atomicity; exclude remaining subtypes/Mobile |
| `secure-content-w7` | product-behavior | `SOC-SEC-C01/C02/C03/C05/C07`; `SOC-SEC-AS01/02/03/04/05/07/10/11/13/15` | `SC-A01..A08`; `SC-D01..D08/D11..D13` | `SOC-SEC-J01/J02/J03/J06/J09` | Desktop pilot plus authenticated Browser boundary Journeys; exclude Acceptance |
| `secure-content-w8` | product-behavior | `SOC-SEC-C01..C07/C09`; `SOC-SEC-AS05/06/07/09/10/11/12/15/16` | `SC-A01..A08`; `SC-D01..D13` | `SOC-SEC-J04/J05/J08/J09` | remaining Social behavior; exclude Mobile/Chat |
| `secure-content-w9` | product-behavior | `SOC-SEC-C01..C08`; `SOC-SEC-AS01..AS16` | `SC-A01..A08`; `SC-D01..D13` | `SOC-SEC-J01..J09` | Mobile parity; exclude Chat authority change |
| `secure-content-w10` | refactor | `MP-C13`; `MP-G13` | `SC-D02/D03/D13`; `MP-D23` | `MP-J11` | Chat regression only; exclude wire/API/schema changes |
| `secure-content-w11` | refactor | `SOC-SEC-C01..C09`; `SOC-SEC-AS01..AS16`; `MP-C13/MP-G13` | `SC-A07`; `SC-D02/D03/D10/D11/D13`; `MP-D23` | `SOC-SEC-J01..J09`; `MP-J11` | source/route/generated hard cut; exclude destructive schema/data removal |
| `secure-content-w12` | product-behavior | `SOC-SEC-C01..C09`; `SOC-SEC-AS01..AS16`; `MP-C13/MP-G13` | `SC-A01..A08`; `SC-D01..D13`; `MP-D23` | `SOC-SEC-J01..J09`; `MP-J11` | authorized physical schema/data reset + complete Development matrix; exclude formal Acceptance |
| `secure-content-w13` | infrastructure | `SOC-SEC-C01..C09`; `SOC-SEC-AS01..AS16`; `MP-G13` | `SC-A01..A08`; `SC-D01..D13`; `MP-D23` | `SOC-SEC-J01..J09`; `MP-J11` | Acceptance injection/evidence only; exclude product/design changes |

Each workstream uses the global authorization envelope plus its exact resource
row below. Pending or parked workstreams are not active Development Sessions.

### Machine-Shaped Resources And Authorization

`20260913-secure-content-work-items.yaml` is the sole declaration input for:

- exact `shared-read` and `exclusive-write` path prefixes;
- exact runtime kinds, resource IDs and modes;
- checkpoint, delivery, deploy, reset and history authorization arrays.

Every item ID satisfies the machine ledger identifier regex
`/^[a-z0-9][a-z0-9._-]{0,127}$/i`; Secure Content IDs additionally use a
lowercase project convention. A new workstream uses `dev-start`, never
`dev-update` against a missing ID. `dev-update` is reserved for the same live
item's heartbeat, Journey, claim or source-HEAD refresh. W1/W2/W3/W6/W7/W9
remain parked against the current external declaration. W12 declares the intended
`station-four-social-private` and `station-five-arm-social-private` reset
resources but keeps `destructiveResetScopes: []`; execution remains impossible
until an exact Owner authorization updates that array.

W3-W6 service Journeys boot production handlers/adapters with isolated
in-process persistence and object fixtures. They do not connect to or mutate a
registered Station profile, so their runtime claim arrays are intentionally
empty.

#### Declaration Transition

The current ad hoc PLAN declaration is replaced by the machine-shaped W0
integrator declaration before EXECUTE. W0 remains the sole owner of plan/status
documents through W10, while each code workstream has its own non-overlapping
declaration. W4 is the one-time code bootstrap because the YAML projector does
not exist yet:

```bash
make dev-release \
  WORK_ITEM=post-security-hard-cut \
  SESSION=post-security-20260913
make dev-start \
  WORK_ITEM=secure-content-w0 \
  SESSION=secure-content-w0 \
  PURPOSE='Own Secure Content plan status and execution reconciliation' \
  SOURCE_CLAIMS='exclusive-write:docs/architecture/secure-content;exclusive-write:docs/architecture/social;exclusive-write:docs/README.md'
make dev-start \
  WORK_ITEM=secure-content-w0r \
  SESSION=secure-content-w0r \
  JOURNEY=sc-dj-runtime-lease-control \
  PURPOSE='Implement canonical machine registration and Station capability leases' \
  SOURCE_CLAIMS='exclusive-write:Makefile;exclusive-write:tooling/make/local-dev.mk;exclusive-write:tooling/scripts/lib/machine-dev-paths.mjs;exclusive-write:tooling/scripts/lib/machine-dev-paths.test.mjs;exclusive-write:tooling/scripts/local-dev;exclusive-write:tooling/skills/pt-local-dev-env;exclusive-write:docs/architecture/local-dev-control-plane;exclusive-write:docs/global/local-dev-environment.md' \
  RUNTIME_CLAIMS='shared:profile:four;exclusive:local.slot:5'
make dev-start \
  WORK_ITEM=secure-content-w4 \
  SESSION=secure-content-w4 \
  JOURNEY=sc-dj-optional-auth \
  PURPOSE='Implement strict Optional JWT and bootstrap the Secure Content Development runner' \
  SOURCE_CLAIMS='exclusive-write:apps/station/frame/core/auth;exclusive-write:apps/station/app/subserver/social/subserver.go;exclusive-write:apps/station/app/subserver/social/handler.go;exclusive-write:apps/station/app/subserver/social/handler_test.go;exclusive-write:tooling/development/secure_content'
make dev-check WORK_ITEM=secure-content-w0 SESSION=secure-content-w0
make dev-check WORK_ITEM=secure-content-w0r SESSION=secure-content-w0r
make dev-check WORK_ITEM=secure-content-w4 SESSION=secure-content-w4
```

W4 delivers `tooling.development.secure_content.work_item`. It validates the
manifest against the Development Workflow schema, validates the selected
Journey belongs to the item, materializes the exact source/runtime arrays,
invokes the canonical `dev-work.mjs` argv interface without a Make/shell
interpolation boundary, and read-backs the declaration digest. Every later item
starts with this exact shape after the prior declaration is released:

```bash
make dev-release WORK_ITEM=<prior-item-id> SESSION=<prior-session-id>
python3 -m tooling.development.secure_content.work_item start \
  --manifest docs/architecture/secure-content/execution-plans/20260913-secure-content-work-items.yaml \
  --workstream W1 \
  --journey sc-dj-contract-consumers
make dev-check WORK_ITEM=secure-content-w0 SESSION=secure-content-w0
make dev-check WORK_ITEM=secure-content-w1
```

Multi-Journey items use the same helper's `update --journey <id>` between
Journeys. The helper refuses unknown fields, path escape, unsupported runtime
kinds, undeclared Journey IDs, nonempty reset intent without exact
`destructiveResetScopes`, or a ledger readback that differs from YAML. After an
authorized checkpoint, it executes `make dev-update` for the same live item
before the next mutation. It never releases another workspace's declaration.
W0 is released immediately before W11, whose declared documentation root then
owns hard-cut reconciliation. W12 and W13 each own the exact plan file while
updating their status, and all remaining declarations are released at handoff.

After W0R, every Station mutation uses the canonical sequence
`make profile PROFILE=<name>` -> parsed `make config` preflight -> `make station`.
The W0R-owned Local Dev Control Plane verifies registration and matching
Development intent, atomically acquires the exact `station.deploy` lease, holds
it through deploy/restart/health readback, and releases it on success, failure,
signal or timeout. A declaration alone never establishes possession. No plan
command uses the ineffective `make station-restart PROFILE=...` form.

### Execution Closure Map

| Closure | Tasks | Completion boundary |
|---|---|---|
| EC0 | W0 | reviewed PLAN and synchronized tracking |
| EC0R | W0R | authoritative current-workspace registration and atomic capability leases pass isolated concurrency/recovery tests |
| EC1 | W1 | focused generated consumers compile and canonical vectors decode without touching unrelated outputs |
| EC2 | W2 | atomic shared-kernel/Chat cut plus Desktop and Mobile Native exact-source MP-J11 `FUNCTIONAL_PASS` |
| EC3 | W3 | real Social prepare consumer claims/replays Content PreKeys |
| EC4 | W4 | real HTTP requests pass the complete Optional JWT matrix |
| EC5 | W5 | recovery query/core opens never-read content in a real consumer integration |
| EC6 | W6 + W7 | Social outer-UOW failpoint matrix plus minimal source and Desktop receiver `FUNCTIONAL_PASS` |
| EC7 | W8 | every subtype/relationship micro-slice reaches its own `FUNCTIONAL_PASS` |
| EC8 | W9 | complete required Mobile matrix reaches `FUNCTIONAL_PASS` |
| EC9 | W10 | reconciled exact-source MP-J11 remains `FUNCTIONAL_PASS` |
| EC10 | W11 | source/route/generated hard-cut checkpoint passes Social and Chat regression Journeys while legacy physical data remains untouched and unreachable |
| EC11 | W12 | explicitly authorized physical legacy schema/data reset and complete final Development matrix pass |
| EC12 | W13 | formal Acceptance/quality evidence is current |

## 9. Dependency Graph

```text
W0 Plan approval and conflict reconciliation
  -> W0R Machine registration and Station lease owner
  -> W4 Optional JWT + Development runner bootstrap
       -> W14 Scoped generator groundwork
            -> W1 Contracts/generated substrate

W0R + W1 + W4
  -> W2 Atomic shared-kernel extraction + Desktop/Mobile Chat FUNCTIONAL_PASS

W2
  -> W3 Content PreKeys

W2 + W3
  -> W5 Recovery

W2 + W3 + W4
  -> W6 Minimal Social FRIENDS text+image closure
       -> W7 Desktop pilot FUNCTIONAL_PASS

W7 FUNCTIONAL_PASS
  -> W8 Remaining Social subtypes/relationships

W5 + W7 + W8
  -> W9 Mobile parity

W9 FUNCTIONAL_PASS
  -> W10 Chat exact-source regression revalidation

W5 + W8 + W9 + W10
  -> W11 Atomic source/route/generated hard cut
       -> W12 Authorized physical schema/data cut + full Development FUNCTIONAL_PASS
            -> W13 Acceptance promotion and delivery evidence
```

The early W7 product Journey is the expansion fence. W8-W10 cannot begin merely
because source checks pass.

### Estimated Schedule

The source-owned critical path is 8-12 engineering workdays:

| Critical-path segment | Estimate |
|---|---:|
| W0R + W4 bootstrap, W1 contracts | 1-2 days |
| W2 atomic Chat/shared-core cut and Native regression | 2-3 days |
| W3-W7 PreKeys, recovery, Social minimum and Desktop pilot | 2-3 days |
| W8-W10 Social expansion, Mobile and Chat reconciliation | 2-3 days |
| W11-W13 hard cut, authorized reset and formal Acceptance | 1-2 days |

This is engineering time, not wall-clock certainty. Waiting for active MCA/
Station owners to release claims, exact W12 destructive authorization, remote
availability or mandatory failure remediation is excluded and keeps the ETA
explicitly `unknown` while blocked.

## 10. Concurrency And Conflict Decision

Mode: `hybrid`.

- W1 allowlisted generated outputs are serial under one integrator; the broad
  `model/build.sh` and `proto-gen-mobile.sh` generators are forbidden in W1.
- W14 may implement and isolate-test only the scoped generator while W1's
  Desktop write set remains unavailable. It cannot add or modify proto source,
  generated output, or Rust consumer declarations.
- After W0, W0R and W4 are independent when claims permit. W0R owns the
  canonical registration/lease implementation, and W4 owns the dynamically
  discovered Development runner and YAML projector bootstrap. W1 follows W4;
  W2 follows W0R/W1/W4 and atomically moves Chat to the shared kernels before W3
  or Social consumers begin.
- W5 follows W2/W3.
- W6 is serial because one Social UOW/schema owner integrates the minimal slice.
- W7 checkpoint, deploy, runtime and Journey are serial.
- After W7 `FUNCTIONAL_PASS`, W8 runs its subtype Journeys; W9 consumes the
  resulting complete Social contract and remains serial behind W8.
- W10 is parked until `native-desktop-runtime-cells` releases Conversation,
  Messaging Core, Desktop and generated Chat paths.
- W11 generated/deletion and legacy-schema access reconciliation is serial;
  physical schema/data deletion remains W12-only.
- W12 reset/deploy/runtime is serial.
- W13 formal Gates are scheduled by resource compatibility, with one evidence
  integrator.

Current machine snapshot at the latest review:

- `MCA-001` owns `apps/desktop/src`, `apps/desktop/src-tauri/src` and Agent
  sources, so W1/W2/W7/W8/W10/W11 remain parked on its Desktop overlap.
- `native-desktop-runtime-cells` owns `station-four`/`station-five-arm` deploy
  and reset resources plus slots 3/4 and Acceptance paths, so all overlapping
  Native/runtime work remains parked.
- `peers-touch-federation` is not yet an authoritative machine registration.
  W0R owns that migration and binds only the verified workspace to tracked
  profile `four` and free workspace slot 5; it creates no profile or environment.
- Every `work_item start` re-reads the live ledger and registry rather than
  relying on this snapshot or on `active_work`.

The execution guardian parks only conflicting workstreams and recomputes the
remaining ready frontier. It never overwrites another declaration.

## 11. Command And Journey Budgets

| Action | Timeout | Retry |
|---|---:|---|
| focused Go/Rust/TS unit or contract command | 10 minutes | none; diagnose first failure |
| Desktop focused build/check | 20 minutes | none |
| Mobile full check | 30 minutes | none |
| proto generation | 20 minutes | none; digest drift is failure |
| checkpoint creation | 5 minutes | none |
| Station deploy/restart | 20 minutes | no automatic retry |
| one functional Journey | exact `functionalRunSeconds` in Journey YAML (10-120 minutes) | one idempotent observation retry only where the Journey permits it |
| cleanup | exact `cleanupSeconds` in Journey YAML (2-20 minutes) | one bounded observation retry |
| formal Gate | 10-60 minutes per W13 Gate table | Gate policy only |

First actionable failure stops the active Journey, records the failure, and
returns to its owning implementation workstream. Broad unrelated checks do not run.
Every `--budget-seconds` value below equals its Journey YAML
`functionalRunSeconds`; changing one requires changing both in the same plan
revision.

### Capacity And Performance Contract

| Workload / resource | Required bound or target |
|---|---|
| private payload ciphertext | `<= 1 MiB` |
| objects per resource | `<= 10` |
| object plaintext / chunks | `<= 2 GiB`; `<= 2048` fixed 1 MiB chunks |
| recipient actors / total slots | `<= 256`; `<= 1000` |
| active plans / uploads per actor-domain | `<= 4`; `<= 4` |
| envelope bytes / plan lifetime / recovery page | `<= 4 MiB`; `5m`; `100` resources |
| comments | `30` per actor/Post/hour; `600` per Post/hour |
| unattached object TTL | `24h` |
| 1 MiB encrypt/decrypt | five warm-ups, `>=30` samples; Desktop P95 `<=100ms`, Mobile P95 `<=200ms` |
| 256 envelope seals | Desktop P95 `<=2s`, Mobile P95 `<=4s` |
| policy-limit admission | complete or reject before encryption within `5s` |
| 100 MiB interrupted transfer | resume missing chunks only; LAN first-byte P95 `<=2s` |
| transfer working set | `<= 2 * chunk_size + 16 MiB`, no whole-object buffer |

Release-mode performance evidence reports P50/P95/P99, sample count and peak RSS.

## 12. Workstreams

### SC-W0: Governance And Plan Closure

- **Responsibility**: accepted sources, formal plan, active_work, authorization,
  conflict controls and review.
- **Dependencies**: none.
- **Deliverables**: this plan and review prompt; final plan-derived declaration.
- **Checks**: links, metadata, traceability, dependency and binding validation.
- **Done**: independent plan review passes and autonomous execution authorization
  is recorded.

### SC-W0R: Machine Registration And Runtime Lease Closure

- **Responsibility**: implement the accepted Local Dev Control Plane registration,
  binding, slot allocation, runtime observation and OS-backed capability leases
  under `LDCP-D01..LDCP-D06`, `LDCP-D08` and `LDCP-D09`.
- **Dependencies**: W0.
- **Deliverables**: authoritative `env-register`, `env-update`, `env-check` and
  `env-status-all` commands; current-workspace registration; atomic `local.slot`,
  `station.deploy` and `station.reset` lease acquisition/hold/release;
  `make profile`, `make config`, `make station` and reset integration;
  PID/process-start stale-owner rejection; synchronized `pt-local-dev-env`
  operating instructions.
- **Authorization boundary**: register only verified workspace
  `9eb2cb904c9ae460` to the existing tracked `four` profile and workspace slot 5.
  Do not create/copy/edit any profile, deploy environment or creation grant.
- **Failure**: unregistered workspace, dirty/untracked selected definition,
  loopback/local/compose Station, mismatched deployment target, stale lease
  metadata or competing holder fails before mutation.
- **Checks**:

```bash
node --test --test-timeout=1200000 \
  tooling/scripts/lib/machine-dev-paths.test.mjs \
  tooling/scripts/local-dev/*.test.mjs
python3 -m unittest tooling.scripts.local_dev_profile_resolution_test
python3 -m unittest tooling.acceptance.tests.test_profile_lease
make env-register \
  PROFILE=four \
  SLOT=5 \
  CAPABILITIES='station.connect,station.deploy' \
  PURPOSE='Secure Content implementation in peers-touch-federation'
make env-status-all
make env-check \
  WORKSPACE_ID=9eb2cb904c9ae460 \
  PROFILE=four \
  SLOT=5 \
  CAPABILITIES='station.connect,station.deploy' \
  BUDGET_SECONDS=1200
```

- **Exit**: the verified federation workspace is registered, slot 5 is allocated,
  and isolated child-process tests prove acquire/compete/hold/release and stale
  recovery for every required lease class. No Station is deployed in W0R; its
  Development declaration is released while the authoritative registration and
  slot allocation persist.

### SC-W1: Proto And Generated Contract Substrate

- **Responsibility**: shared payload/object/envelope types; Social private
  prepare/submit/read/recovery; Key Exchange Content PreKeys.
- **Dependencies**: W14; generated-path conflicts released.
- **Deliverables**: deterministic Go/Desktop/Mobile/Rust outputs.
- **Generator boundary**: add `tooling/scripts/proto-gen-secure-content.sh`.
  It accepts only `domain/common`, `domain/secure_content`, `domain/social` and
  `domain/key_exchange`, writes only the W1-declared Station Go, Desktop
  TypeScript and Mobile TypeScript roots, updates only the declared
  Desktop/Mobile Rust build-input files, rejects an applet `go_package`, and
  fails when any repository write escapes the declared output manifest. Rust
  protobuf output remains untracked under Cargo `OUT_DIR`; absent legacy
  `apps/mobile/android` and `apps/mobile/ios` trees are not consumers or claims.
- **Failure**: unknown suite/version/kind, malformed binding, or generation drift
  fails before consumer migration.
- **Functional boundary**: generated Go/Rust/Desktop/Mobile consumers decode the
  same canonical payload/envelope/object vectors without handwritten mirrors.
- **Checks**:

```bash
./tooling/scripts/proto-gen-secure-content.sh \
  --check --budget-seconds 600
git diff --check
```

- **Deletion at W11**: `AudienceKeyEnvelope`, inline media keys, legacy visibility,
  and Social generated mirrors. Chat attachment wire types remain.

### SC-W14: Scoped Generator Groundwork

- **Responsibility**: implement the W1 code-generation owner without changing
  proto contracts or generated consumers.
- **Dependencies**: W0/W4.
- **Deliverables**: thin `tooling/scripts/proto-gen-secure-content.sh` entry,
  `tooling/scripts/proto-gen-secure-content.mjs`, and isolated Node tests for
  the fixed input allowlist, output manifest, repository-boundary checks,
  tool/budget validation, and check/apply behavior.
- **Failure**: reject undeclared input/output paths, applet `go_package`,
  missing tools, timeout, and writes outside the manifest.
- **Checks**:

```bash
node --test tooling/scripts/proto-gen-secure-content.test.mjs
bash -n tooling/scripts/proto-gen-secure-content.sh
git diff --check
```

- **Exit**: generator behavior is checkpointed and independently reviewed.
  Proto source, generated files, and Rust build/module files remain untouched
  until W1 acquires its complete serial write set.

### SC-W2: Atomic Shared-Kernel Extraction And Chat Cutover

- **Responsibility**: create `packages/secure-content-core` and stateless
  `apps/station/app/internal/securecontent`; migrate Chat's generic
  crypto/validation/FSM internals and delete the old implementations atomically.
- **Dependencies**: W1 and W4; Conversation/Messaging/Desktop source claims
  released; exact Desktop and Mobile Chat runtime resources available.
- **Deliverables**: AEAD, HPKE, object crypto, transfer FSM, recovery derivation,
  Go validation/transitions and shared vectors; thin Chat wire/domain adapters;
  unchanged Chat proto, routes, tables, UOW and grants; Desktop/Mobile Chat
  scenario modules consumed by the W4-owned dynamically discovered runner.
- **Failure**: tamper, binding mismatch, invalid range, duplicate conflict,
  unsupported version, and over-limit input fail closed.
- **Checks**:

```bash
cargo test --manifest-path packages/secure-content-core/Cargo.toml
cargo test --manifest-path packages/messaging-core/Cargo.toml
(cd apps/station && go test -race -count=1 ./app/internal/securecontent/...)
(cd apps/station && go test -race -count=1 ./app/subserver/conversation/...)
cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml messaging
pnpm mobile:check
make profile PROFILE=four
make config
make station
make profile PROFILE=fiveArm
make config
make station
python3 -m tooling.development.secure_content.run \
  --runtime desktop --scenario chat-attachment-regression \
  --profiles four,fiveArm \
  --clients four-alice,four-bob,fiveArm-alice,fiveArm-bob \
  --budget-seconds 1800
python3 -m tooling.development.secure_content.run \
  --runtime mobile --scenario chat-attachment-regression \
  --profiles four,fiveArm \
  --clients secure-content-chat-ios-alice,secure-content-chat-ios-bob,secure-content-chat-android-alice,secure-content-chat-android-bob \
  --budget-seconds 3600
```

- **Development Journeys**: exact-source `sc-dj-chat-attachment-atomic` and
  `sc-dj-chat-attachment-mobile` execute the complete `MP-J11`/`MP-G13`
  Direct/Group, chunk-resume, conflict/range/hash, fresh-recovery, removed-actor
  and secrecy corpus through unchanged Conversation routes, tables and grants.
- **Exit**: Desktop plus iOS Simulator and Android Emulator Chat refactor cells
  reach `FUNCTIONAL_PASS`; no old generic crypto/FSM implementation remains
  before Social imports the shared core.

### SC-W3: Content PreKey Lifecycle

- **Responsibility**: endpoint/recovery pools, publish, inventory, exact claim,
  irreversible consumption and replenishment.
- **Dependencies**: W2 `FUNCTIONAL_PASS`; Key Exchange source claim released.
- **Deliverables**: separate Direct/MLS/Content stores and quotas.
- **Failure**: depleted pool blocks prepare; same plan/hash replays; conflicting
  hash fails; exposed key is never reused.
- **Functional boundary**: a self-hosting Key Exchange operational driver claims
  endpoint and recovery keys through the production service interface, replays
  the exact result, rejects a conflicting hash, and observes bounded
  depletion/replenishment. W6 later proves the Social consumer.
- **Checks**:

```bash
(cd apps/station && go test -race -count=1 ./app/subserver/key_exchange/...)
cargo test --manifest-path packages/secure-content-core/Cargo.toml prekey
python3 -m tooling.development.secure_content.run \
  --runtime service --scenario content-prekey --budget-seconds 600
```

### SC-W4: Strict Optional Authentication And Development Runner Bootstrap

- **Responsibility**: HTTP/Hertz optional JWT, canonical optional subject, and
  the generic dynamically discovered Development runner used by later
  Secure Content scenarios.
- **Dependencies**: W0.
- **Deliverables**: absent/valid/invalid/expired/revoked behavior with redacted
  logs; generic scenario discovery/recording; YAML-to-ledger
  `work_item start|update` projection with round-trip validation; whole-worktree
  clean-checkpoint enforcement and secret-free failure summaries before a
  `FUNCTIONAL_CHECK` result can be emitted.
- **Failure**: supplied invalid credential returns `401`, never anonymous fallback.
- **Functional boundary**: real HTTP requests prove missing, valid, malformed,
  expired and revoked behavior on one public-capable Social route.
- **Checks**:

```bash
(cd apps/station && go test -race -count=1 ./frame/core/auth/...)
python3 -m tooling.development.secure_content.run \
  --runtime service --scenario optional-auth --budget-seconds 600
```

### SC-W5: Never-Opened Recovery

- **Responsibility**: BIP39-derived recovery master and Social paginated
  recovery-envelope query/core consumer; Native UI adapters remain W7/W9.
- **Dependencies**: W1/W2/W3.
- **Deliverables**: recovery of content never opened by the prior device without
  whole-archive root-key growth.
- **Failure**: wrong phrase/key/epoch, deleted/block-revoked resource and tampered
  envelope release no plaintext.
- **Functional boundary**: the Social recovery query and Secure Content consumer
  derive and open a recovery envelope for a resource absent from the old device's
  local catalog; revoke and pagination-restart variants pass.
- **Checks**:

```bash
cargo test --manifest-path packages/secure-content-core/Cargo.toml recovery
(cd apps/station && go test -race -count=1 ./app/subserver/recovery/... ./app/subserver/social/...)
python3 -m tooling.development.secure_content.run \
  --runtime service --scenario recovery-consumer --budget-seconds 1200
```

### SC-W6: Minimal Social Private Closure

- **Responsibility**: FRIENDS truth, Social prepare/submit UOW, encrypted private
  Post/Comment foundations, Social object plane, viewer-scoped read, text+image.
- **Dependencies**: W2/W3/W4.
- **Deliverables**: one transaction commits snapshot, ciphertext, slot mapping,
  envelopes, delivery, objects, grants and receipt; one Social UOW scenario
  module consumed by the W4-owned Development runner with no Evidence Store
  dependency.
- **Interim behavior**: every not-yet-implemented private subtype/audience fails
  explicitly; no request falls back to legacy plaintext.
- **Failure**: stale relation/device plan, missing slot, object mismatch,
  over-limit audience, block/delete race and duplicate conflict reject atomically.
- **UOW failpoint matrix**: Post and Comment variants inject one failure after
  each plan-consumption, fact, audience snapshot, slot mapping, endpoint-envelope,
  recovery-envelope, delivery-intent, object-attachment, object-grant and
  command-receipt write boundary. Every failure leaves zero partial domain rows
  or grants; a pre-uploaded object remains `COMPLETE_UNATTACHED` and GC-eligible.
  The same command/plan reuses the irreversibly claimed PreKeys; a conflicting
  hash fails.
- **Checks**:

```bash
(cd apps/station && go test -race -count=1 ./app/subserver/social/...)
./tooling/scripts/check-go-style.sh
python3 -m tooling.development.secure_content.run \
  --runtime service --scenario social-uow-atomicity --budget-seconds 1200
```

### SC-W7: Desktop Pilot Functional Pass

- **Responsibility**: Desktop Native adapter/store/worker, FRIENDS text+image,
  strict read/deny, public continuity, draft retention and cleanup.
- **Dependencies**: W6; Desktop claim released; checkpoint/deploy/profile
  authorization and leases available.
- **Focused checks**:

```bash
pnpm --dir apps/desktop run check
pnpm --dir apps/desktop exec vitest run src/test/moments-store.test.ts
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml secure_content
make profile PROFILE=four
make config
make station
python3 -m tooling.development.secure_content.run \
  --runtime desktop --scenario desktop-pilot --profile four \
  --clients secure-content-desktop-alice,secure-content-desktop-bob,secure-content-desktop-eve \
  --budget-seconds 1200
python3 -m tooling.development.secure_content.run \
  --runtime browser --scenario browser-private-boundary --profile four \
  --clients secure-content-browser-authenticated,secure-content-browser-anonymous \
  --budget-seconds 1200
```

- **Development Journeys**:
  Alice publishes FRIENDS text+image; Bob reads exact text/bytes; Eve is denied;
  invalid token is `401`; Bob sees only his endpoint envelope. In an independent
  Browser Journey, anonymous PUBLIC read remains available while an authenticated
  actor's private publish/read fails with the explicit unsupported states before
  plaintext or key material leaves the Browser.
- **Exit**: exact deployed checkpoint reaches `FUNCTIONAL_PASS`. No Acceptance
  injection or broad platform expansion before this result.

### SC-W8: Remaining Social Semantics

- **Responsibility**: FOLLOWERS/CIRCLE/GROUP/SELF/CUSTOM, private Comment,
  Poll/Repost/Mention/Reaction/Link/Location, delete/block and bounded abuse.
- **Dependencies**: W7 `FUNCTIONAL_PASS`.
- **Deliverables**: revision-bound GROUP port, accepted FRIENDS projection only,
  full subtype contracts and negative races.
- **Failure**: invalid poll option, widened repost, out-of-audience mention,
  stale group epoch and comment limit reject without partial rows.
- **Checks**:

```bash
(cd apps/station && go test -race -count=1 ./app/subserver/social/...)
pnpm --dir apps/desktop exec vitest run src/test/moments-store.test.ts
```

- **Development loop**: execute one subtype/relationship slice at a time in this
  order: audience matrix; Comment; IMAGE/VIDEO object states; Poll; Repost;
  Mention/Reaction; Link/Location; object attach/replay; GC cleanup/retry;
  delete/block; bounded abuse/storage-full. Each slice performs focused checks,
  checkpoint, exact-source deploy and this receiver Journey before the next
  slice starts:

```bash
make profile PROFILE=four
make config
make station
python3 -m tooling.development.secure_content.run \
  --runtime desktop --scenario social-expansion --slice <slice-id> \
  --profile four \
  --clients secure-content-desktop-alice,secure-content-desktop-bob,secure-content-desktop-eve \
  --budget-seconds 1200
```

- **Exit**: SC-AS03/04/06/07/09/11/13/14 each has a current `FUNCTIONAL_PASS`.

### SC-W9: Mobile Native Parity

- **Responsibility**: Mobile Native adapters/store/worker and every required
  Social private state.
- **Dependencies**: W5; W7 `FUNCTIONAL_PASS`; W8 contracts; Mobile claim released.
- **Deliverables**: same core, no copied crypto, exact Desktop semantic parity.
- **Mobile scenario matrix**: `MSC-M01..MSC-M06` from section 13, including
  recovery, subtype, lifecycle, bounds and public continuity.
- **Checks**:

```bash
pnpm --dir apps/mobile run check:social-wire
pnpm --dir apps/mobile run check:social-runtime-boundaries
pnpm mobile:check
make profile PROFILE=four
make config
make station
python3 -m tooling.development.secure_content.run \
  --runtime mobile --scenario mobile-required-matrix --profile four \
  --clients secure-content-ios-alice,secure-content-ios-bob,secure-content-ios-eve,secure-content-android-alice,secure-content-android-bob,secure-content-android-eve \
  --budget-seconds 7200
```

- **Development Journey**: execute every named iOS and Android publish, read,
  Comment, image/video media, lifecycle, recovery, attach/GC and bounded-overload
  state transition from `sc-dj-mobile-matrix`, stopping on the first
  receiver-visible failure.
- **Exit**: every required Mobile scenario has an exact-source `FUNCTIONAL_PASS`
  before W10/W11.

### SC-W10: Conversation Internal Reuse

- **Responsibility**: revalidate exact-source Chat behavior after all Social and
  Mobile consumers use the shared kernels.
- **Dependencies**: W2 `FUNCTIONAL_PASS`; W9 `FUNCTIONAL_PASS`; Chat runtime
  resources available.
- **Retained unchanged**: Chat proto wire, `/conversation/attachments/*`, tables,
  UOW, grants, Direct/MLS, receipts, recovery and product behavior.
- **Source changes**: none. A regression returns to its owning W2/W8/W9 item;
  W10 does not widen its read claims to repair code in place.
- **Checks**:

```bash
cargo test --manifest-path packages/messaging-core/Cargo.toml
(cd apps/station && go test -race -count=1 ./app/subserver/conversation/...)
python3 -m unittest tooling.acceptance.gates.chat.messaging_platform_contract_test
make profile PROFILE=four
make config
make station
make profile PROFILE=fiveArm
make config
make station
python3 -m tooling.development.secure_content.run \
  --runtime desktop --scenario chat-attachment-regression \
  --profiles four,fiveArm \
  --clients four-alice,four-bob,fiveArm-alice,fiveArm-bob \
  --budget-seconds 1800
python3 -m tooling.development.secure_content.run \
  --runtime mobile --scenario chat-attachment-regression \
  --profiles four,fiveArm \
  --clients secure-content-chat-ios-alice,secure-content-chat-ios-bob,secure-content-chat-android-alice,secure-content-chat-android-bob \
  --budget-seconds 3600
```

The unittest command is a direct structural test, not formal Acceptance evidence.
The workstream exits only after the exact-source `MP-J11` attachment Journey
passes again on Desktop, iOS Simulator and Android Emulator Native on the
reconciled checkpoint.

### SC-W11: Atomic Source, Route And Generated Hard Cut

- **Responsibility**: migrate every consumer and delete all retired source,
  route, generated, fixture and doc paths. Prepare the scoped legacy-schema/data
  reset, but do not execute physical table, row or object deletion.
- **Dependencies**: W8/W9/W10.
- **Deliverables**: one source for crypto/validation; Moments-only Social API;
  canonical physically separate public/private stores for new writes; complete
  operational-consumer migration; `tooling/scripts/secure-content-hard-cut-check.py`;
  dormant legacy private schema has no production reader, writer or model owner.
- **Failure**: any old live reference, compatibility path, generated residue or
  schema owner mismatch fails closure.
- **Checks**:

```bash
python3 tooling/scripts/secure-content-hard-cut-check.py
./tooling/scripts/proto-gen-secure-content.sh
git diff --check
python3 -m tooling.development.secure_content.schema_audit \
  --profile four --phase pre \
  --output development/secure-content/W11/schema-pre.json
make profile PROFILE=four
make config
make station
make profile PROFILE=fiveArm
make config
make station
python3 -m tooling.development.secure_content.schema_audit \
  --profile four --phase post \
  --compare-public development/secure-content/W11/schema-pre.json \
  --require-no-legacy-private-access \
  --allow-dormant-legacy-private-schema \
  --output development/secure-content/W11/schema-post.json
python3 -m tooling.development.secure_content.run \
  --runtime desktop --scenario hard-cut-regression --profile four \
  --clients secure-content-hardcut-four-alice,secure-content-hardcut-four-bob,secure-content-hardcut-four-eve \
  --budget-seconds 7200
python3 -m tooling.development.secure_content.run \
  --runtime desktop --scenario chat-attachment-regression \
  --profiles four,fiveArm \
  --clients four-alice,four-bob,fiveArm-alice,fiveArm-bob \
  --budget-seconds 1800
python3 -m tooling.development.secure_content.run \
  --runtime mobile --scenario hard-cut-mobile-regression --profile four \
  --clients secure-content-hardcut-ios-alice,secure-content-hardcut-ios-bob,secure-content-hardcut-ios-eve,secure-content-hardcut-android-alice,secure-content-hardcut-android-bob,secure-content-hardcut-android-eve \
  --budget-seconds 7200
python3 -m tooling.development.secure_content.run \
  --runtime mobile --scenario chat-attachment-regression \
  --profiles four,fiveArm \
  --clients secure-content-hardcut-ios-alice,secure-content-hardcut-ios-bob,secure-content-hardcut-android-alice,secure-content-hardcut-android-bob \
  --budget-seconds 3600
python3 -m tooling.development.secure_content.run \
  --runtime browser --scenario browser-private-boundary --profile four \
  --clients secure-content-browser-authenticated,secure-content-browser-anonymous \
  --budget-seconds 1200
```

Expected search result: zero production reference, excluding explicit negative
hard-cut fixtures.

`secure-content-hard-cut-check.py` must inspect, not merely grep:

- model sources and every generated Go/Rust/Desktop/Mobile binding;
- `/api/v1/social/posts*`, `PostVisibility`, and `audienceFromLegacyVisibility`;
- `AudienceKeyEnvelope`, inline-key descriptors, signaling-envelope Social calls,
  and Social-local chunk cipher functions;
- production use of private `TextBody`, attachment/mention/link JSON, shared
  private Comment rows and old audience-envelope columns; names may remain only
  in the W12 reset implementation and explicit negative fixtures;
- Social stats, Dashboard, moderation, notification, delivery, migration and
  storage-inventory consumers;
- Desktop/Mobile gateways, stores, runtimes, pages, Native commands and fixtures;
- Chat generic algorithm/FSM implementations while allowing retained Chat wire
  adapters, routes, tables and grants;
- stale tests, Acceptance declarations, docs and knowledge.

- **Development Journey**: deploy the hard-cut checkpoint non-destructively to
  the selected existing profiles and rerun Desktop SC-AS01 through SC-AS14,
  service SC-AS16, Browser SC-AS10, Mobile SC-AS15, and Desktop/Mobile Chat
  SC-AS12. Physical legacy tables and old private objects remain untouched but
  unreachable.
- **Exit**: source/route/generated deletion is complete and the post-deletion
  checkpoint has `FUNCTIONAL_PASS`; prior source-bound results are not reused.

### SC-W12: Authorized Physical Schema/Data Cut And Full Functional Closure

- **Responsibility**: after exact Owner authorization, remove legacy private
  Social rows, tables and old private-media objects on the named profiles, deploy
  the final checkpoint, then run the full Desktop/Mobile/recovery/subtype/UOW/
  cleanup Development matrix.
- **Dependencies**: W5/W11; explicit reset/profile/deploy authorization and leases.
- **Reset boundary**: `station-four-social-private` and
  `station-five-arm-social-private` only; old private Social rows, legacy private
  schema and old private-media objects are removed while public hashes/counts
  remain identical. The command is forbidden while
  `destructiveResetScopes: []`. After exact authorization is recorded, the reset
  procedure first updates the current workspace registration to add
  `station.reset`, then the reset runner must acquire and hold the W0R-owned
  `station.reset` lease across pre-audit, deletion, nested canonical
  `make station` deploy/restart/health and post-audit, releasing it only after
  the complete sequence or on failure, signal or timeout. Registering
  `station.deploy` in W0R does not authorize this later reset.
- **Commands**:

```bash
make env-update \
  PROFILE=four \
  SLOT=5 \
  CAPABILITIES='station.connect,station.deploy,station.reset'
make env-check \
  WORKSPACE_ID=9eb2cb904c9ae460 \
  PROFILE=four \
  SLOT=5 \
  CAPABILITIES='station.connect,station.deploy,station.reset'
make profile PROFILE=four
make config
SOCIAL_PRIVATE_DEV_RESET=1 \
python3 -m tooling.development.secure_content.reset \
  --work-item secure-content-w12 --session secure-content-w12 \
  --scenario authorized-reset \
  --profile four --deploy-environment station-four \
  --scope station-four-social-private \
  --pre-audit-output development/secure-content/W12/schema-pre-four.json \
  --post-audit-output development/secure-content/W12/schema-post-four.json \
  --deploy-via make-station \
  --require-public-unchanged --require-no-legacy-private-schema \
  --hold-reset-lease-through-post-audit --budget-seconds 2400
make profile PROFILE=fiveArm
make config
SOCIAL_PRIVATE_DEV_RESET=1 \
python3 -m tooling.development.secure_content.reset \
  --work-item secure-content-w12 --session secure-content-w12 \
  --scenario authorized-reset \
  --profile fiveArm --deploy-environment station-five-arm \
  --scope station-five-arm-social-private \
  --pre-audit-output development/secure-content/W12/schema-pre-fiveArm.json \
  --post-audit-output development/secure-content/W12/schema-post-fiveArm.json \
  --deploy-via make-station \
  --require-public-unchanged --require-no-legacy-private-schema \
  --hold-reset-lease-through-post-audit --budget-seconds 2400
make env-update \
  PROFILE=four \
  SLOT=5 \
  CAPABILITIES='station.connect,station.deploy'
python3 -m tooling.development.secure_content.run \
  --runtime service --scenario social-uow-atomicity --budget-seconds 1200
python3 -m tooling.development.secure_content.run \
  --runtime desktop --scenario final-desktop --profiles four,fiveArm \
  --clients secure-content-desktop-alice,secure-content-desktop-bob,secure-content-desktop-eve \
  --budget-seconds 7200
python3 -m tooling.development.secure_content.run \
  --runtime mobile --scenario final-mobile --profile four \
  --clients secure-content-ios-alice,secure-content-ios-bob,secure-content-ios-eve,secure-content-android-alice,secure-content-android-bob,secure-content-android-eve \
  --budget-seconds 7200
python3 -m tooling.development.secure_content.run \
  --runtime browser --scenario browser-private-boundary --profile four \
  --clients secure-content-browser-authenticated,secure-content-browser-anonymous \
  --budget-seconds 1200
python3 -m tooling.development.secure_content.run \
  --runtime desktop --scenario chat-attachment-regression \
  --profiles four,fiveArm \
  --clients four-alice,four-bob,fiveArm-alice,fiveArm-bob \
  --budget-seconds 1800
python3 -m tooling.development.secure_content.run \
  --runtime mobile --scenario chat-attachment-regression \
  --profiles four,fiveArm \
  --clients secure-content-ios-alice,secure-content-ios-bob,secure-content-android-alice,secure-content-android-bob \
  --budget-seconds 3600
```

- **Journey order**: `sc-dj-authorized-reset`, SC-AS16 service atomicity,
  SC-AS01 through SC-AS14 Desktop, SC-AS10 Browser boundary, SC-AS15 explicit
  iOS/Android state matrix, then Desktop/Mobile Chat SC-AS12; stop at first
  failure.
- **Exit**: all required exact-source receiver assertions pass and Development
  state reaches final `FUNCTIONAL_PASS`.

### SC-W13: Acceptance Promotion And Delivery Evidence

- **Responsibility**: add/extend Domain, Feature, Gate and Fixture declarations;
  promote W12 Journey actions/assertions; run formal Gates, Gap Detector, Quality
  Check and completion audit.
- **Dependencies**: W12 `FUNCTIONAL_PASS`.
- **Candidate Gates**:

| Gate | Budget |
|---|---:|
| `secure-content-contract-static` | 10m |
| `secure-content-crypto-vectors` | 10m |
| `social-private-content-station` | 20m |
| `social-private-content-security-negative` | 20m |
| `social-private-content-desktop-native-e2e` | 30m |
| `social-private-content-mobile-native-e2e` | 45m |
| `social-private-content-recovery-e2e` | 30m |
| `social-private-content-hard-cut` | 10m |
| `secure-content-performance-native` | 60m |
| `messaging-platform-contract` | 20m |

- **Commands**:

```bash
python3 tooling/scripts/acceptance-plan.py \
  --root tooling/acceptance \
  --range 2d54851f95994d717928105aca6470c30adf3657...HEAD
python3 tooling/scripts/acceptance-run.py --gate secure-content-contract-static
python3 tooling/scripts/acceptance-run.py --gate secure-content-crypto-vectors
python3 tooling/scripts/acceptance-run.py --gate social-private-content-station
python3 tooling/scripts/acceptance-run.py --gate social-private-content-security-negative
python3 tooling/scripts/acceptance-run.py --gate social-private-content-desktop-native-e2e
python3 tooling/scripts/acceptance-run.py --gate social-private-content-mobile-native-e2e
python3 tooling/scripts/acceptance-run.py --gate social-private-content-recovery-e2e
python3 tooling/scripts/acceptance-run.py --gate social-private-content-hard-cut
python3 tooling/scripts/acceptance-run.py --gate secure-content-performance-native
python3 tooling/scripts/acceptance-run.py --gate messaging-platform-contract
make acceptance-report
python3 tooling/scripts/acceptance-gap-detect.py \
  --claim "Secure Content hard cut is product-ready" \
  --range 2d54851f95994d717928105aca6470c30adf3657...HEAD
make quality-evidence REVIEW_RANGE=2d54851f95994d717928105aca6470c30adf3657...HEAD
```

- **Exit**: every required cell is current and `PROVEN`, or the exact missing
  cell remains explicit `UNPROVEN`. Evidence is stored only under the canonical
  `~/.peers-touch/dev/acceptance/` root.

## 13. Acceptance Scenarios

All statuses start `pending`.

| ID | User action | Expected result | Failure variant | Evidence |
|---|---|---|---|---|
| SC-AS01 | Alice publishes FRIENDS text+image; Bob opens from HOME and direct link, restarts, then opens again; Eve opens it | Alice/Bob exact plaintext/bytes before and after restart; Eve not-found | missing PreKey preserves draft | UI + ciphertext/grant/readback |
| SC-AS02 | no/valid/invalid/expired/revoked token reads public/private | anonymous public only; invalid supplied token `401` | no anonymous downgrade | HTTP trace |
| SC-AS03 | Bob/Eve request the same private image and video through placeholder, grant, download and decrypt states | Bob reaches MEDIA_READY with exact bytes for both media kinds; Eve/wrong device/object reaches denial; offline remains retryable | integrity failure releases no plaintext | HTTP state trace + receiver hash |
| SC-AS04 | Bob edits, encrypts, submits, retries and rate-limits private Comments across overlapping recipients | COMMENT_POSTED is exact; failed/rate-limited drafts persist; deleted parent becomes unavailable; slots differ | no stable principal correlation or duplicate post | UI state trace + plan/envelope commitments |
| SC-AS05 | Bob never opens; Bob2 restores, pages history, restarts and reads | recovery envelope opens exact authorized history | wrong phrase/revoked resource fails; missing envelope shows RECOVERY_KEY_UNAVAILABLE | recovery cursor/trace + UI |
| SC-AS06 | FRIENDS and GROUP happy paths run, then friend/group/device changes after prepare | authorized members read; stale submit rejects atomically | no Noop/mutual-follow fallback | revision/head hash + zero rows |
| SC-AS07 | all Post subtypes and interactions, including TEXT, IMAGE, VIDEO, LINK and LOCATION | exact typed content and media bytes; policy holds | invalid poll/repost/mention or object binding rejected | receiver UI + authority readback |
| SC-AS08 | interrupt/restart/cancel object transfer; cancel/timeout publish before and after durable admission | resume missing chunks; pre-admission cancel preserves draft; post-admission receipt resolves outcome | conflict/stale generation fails | bitmap, receipt + byte hash |
| SC-AS09 | account switch, delete/block, then fetch/recover | prior actor keys/projection clear; future access denied | no false remote-delete claim | UI, local-store scan + grant denial |
| SC-AS10 | anonymous Browser/Native reads PUBLIC, then Browser attempts private publish and direct private read | public remains available; private publish/read show explicit unsupported states | Browser sends no private plaintext and receives no private body/key/media fallback | HTTP/UI/network trace |
| SC-AS11 | at-limit/over-limit audience/comment/object load, storage-full/queue saturation, and abandoned object cleanup | at-limit bounded; over-limit/overload returns typed retry-after; GC delete failure retries to completion | no truncation, partial grant, silent metadata loss or unbounded queue | metrics + row/byte/GC audit |
| SC-AS12 | Direct/Group Chat attachment after extraction on Desktop, iOS Simulator and Android Emulator Native | exact existing behavior and bytes on every required Native client | no Social dependency/new route/table or Browser/API substitute | Chat source/runtime regression |
| SC-AS13 | Alice selects an unsupported remote private recipient | publish rejects before encryption and commits nothing | no partial local-recipient publish | UI/network trace + zero rows |
| SC-AS14 | Bob inspects a multi-recipient/multi-device response | only Bob's current endpoint envelope appears | no recipient/device list leakage | wire response and slot scan |
| SC-AS15 | Alice/Bob/Eve repeat required flows on Mobile Native | iOS Simulator and Android Emulator Native cells match Desktop states and receiver outcomes | no Browser/API substitute for either declared Native cell | Mobile UI + Station readback |
| SC-AS16 | the service injects failure after every Post/Comment outer-UOW write boundary, then replays the same command and one conflicting hash | every boundary commits all-or-none; exact retry reuses claimed PreKeys; conflict is terminal | no partial fact/snapshot/envelope/delivery/attachment/grant/receipt rows and no PreKey reactivation | failpoint trace + per-table/object delta |

### Product Acceptance Mapping

| Product scenario | Plan scenario |
|---|---|
| `SOC-SEC-AS01` | `SC-AS01`, `SC-AS16` |
| `SOC-SEC-AS02` | `SC-AS01` |
| `SOC-SEC-AS03` | `SC-AS02`, `SC-AS03` |
| `SOC-SEC-AS04` | `SC-AS02` |
| `SOC-SEC-AS05` | `SC-AS01`, `SC-AS06` |
| `SOC-SEC-AS06` | `SC-AS04`, `SC-AS07`, `SC-AS16` |
| `SOC-SEC-AS07` | `SC-AS03`, `SC-AS08`, `SC-AS16` |
| `SOC-SEC-AS08` | `SC-AS05` |
| `SOC-SEC-AS09` | `SC-AS09` |
| `SOC-SEC-AS10` | `SC-AS10` |
| `SOC-SEC-AS11` | `SC-AS10` |
| `SOC-SEC-AS12` | `SC-AS13`, `SC-AS16` |
| `SOC-SEC-AS13` | `SC-AS14` |
| `SOC-SEC-AS14` | `SC-AS15` |
| `SOC-SEC-AS15` | `SC-AS11`, `SC-AS16` |
| `SOC-SEC-AS16` | `SC-AS04`, `SC-AS16` |

### Journey Execution Matrix

Development runner:

```bash
python3 -m tooling.development.secure_content.run \
  --runtime <source-only|service|desktop|mobile> \
  --scenario <SC-AS-ID> \
  --profile <profile> \
  --budget-seconds <journey-functionalRunSeconds>
```

| Scenario | Workstream/runtime | Focused budget | Functional budget | Retry | Development evidence |
|---|---|---:|---:|---|---|
| SC-AS01 | W7 Desktop; W9 Mobile | 20m | 20m | one observation retry | `W7/SC-AS01/result.json`; `W9/MSC-M01/SC-AS01/result.json` |
| SC-AS02 | W4 service; W7 Desktop; W9 Mobile | 10m | 10m W4 / 20m Native | none for invalid auth | `W4/SC-AS02/result.json`; `W9/MSC-M01/SC-AS02/result.json` |
| SC-AS03 | W8 Desktop; W9 Mobile | 20m | 20m | one range observation retry | `W8/SC-AS03/result.json`; `W9/MSC-M01/SC-AS03/result.json` |
| SC-AS04 | W8 Desktop; W9 Mobile | 20m | 20m | one observation retry | `W8/SC-AS04/result.json`; `W9/MSC-M03/SC-AS04/result.json` |
| SC-AS05 | W5 source; W9/W12 Native | 20m | 20m per recovery page/restart | none after crypto failure | `W5/SC-AS05/result.json`; `W9/MSC-M04/SC-AS05/result.json` |
| SC-AS06 | W8 Desktop; W9 Mobile | 20m | 20m | none after stale-plan rejection | `W8/SC-AS06/result.json`; `W9/MSC-M02/SC-AS06/result.json` |
| SC-AS07 | W8 Desktop; W9 Mobile | 20m per subtype | 20m per subtype | none after policy failure | `W8/SC-AS07/subtype-results.json`; `W9/MSC-M03/SC-AS07/result.json` |
| SC-AS08 | W7/W8 Desktop; W9 Mobile | 20m | 20m | one receipt/status observation retry | `W8/SC-AS08/result.json`; `W9/MSC-M05/SC-AS08/result.json` |
| SC-AS09 | W8 Desktop; W9 Mobile | 20m | 20m | none after revoke | `W8/SC-AS09/result.json`; `W9/MSC-M05/SC-AS09/result.json` |
| SC-AS10 | W7/W11/W12 Browser; W9 Mobile public continuity | 20m | 20m | one public-read observation retry | per-workstream `SC-AS10/browser-result.json`; `W9/MSC-M06/SC-AS10/result.json` |
| SC-AS11 | W8 Desktop; W9 Mobile | 20m | 20m | none after bounded rejection | `W8/SC-AS11/result.json`; `W9/MSC-M06/SC-AS11/result.json` |
| SC-AS12 | W2/W10/W11/W12 Desktop and Mobile Chat | 30m | 30m Desktop / 60m Mobile | one idempotent read observation retry | per-workstream `SC-AS12/desktop-result.json` and `SC-AS12/mobile-result.json` |
| SC-AS13 | W8 Desktop; W9 Mobile | 20m | 20m | none | `W8/SC-AS13/result.json`; `W9/MSC-M02/SC-AS13/result.json` |
| SC-AS14 | W7/W8 Desktop; W9 Mobile | 20m | 20m | none | `W7/SC-AS14/result.json`; `W9/MSC-M01/SC-AS14/result.json` |
| SC-AS15 | W9/W11/W12 Mobile | 30m focused check | 120m aggregate per full matrix run | one observation retry | per-workstream `SC-AS15/mobile-matrix-result.json` |
| SC-AS16 | W6/W12 service | 20m | 20m | none after injected failure | `W6/SC-AS16/result.json`; `W12/SC-AS16/result.json` |

Development paths are rooted under
`~/.peers-touch/dev/workspaces/9eb2cb904c9ae460/development/secure-content/`.
They are not Acceptance evidence and never use `PROVEN`.

### Mobile Required Matrix

Each row runs on both `mobile-ios-simulator-native` and
`mobile-android-emulator-native` against the exact deployed Station source.
Physical-device claims remain `UNPROVEN` unless those resources are separately
available and required by the promoted Acceptance Gate.

| Mobile cell | Actors | Plan scenarios | Required receiver result |
|---|---|---|---|
| MSC-M01 publish/read | Alice/Bob/Eve isolated client storage | SC-AS01/02/03/14 | Bob exact content and one envelope; Eve denied; invalid token `401` |
| MSC-M02 audience | Alice/Bob/Eve | SC-AS06/13 | FRIENDS/GROUP success, stale plan rejection, remote private rejection |
| MSC-M03 comments/subtypes | Alice/Bob/Eve | SC-AS04/07 | every Comment state and TEXT/IMAGE/VIDEO/Poll/Repost/Mention/Reaction/Link/Location projection is observed |
| MSC-M04 recovery | Bob1/Bob2 | SC-AS05 | never-opened history recovers; wrong phrase/revoked resource fails |
| MSC-M05 lifecycle | Alice/Bob | SC-AS08/09 | restart, timeout, cancel, account switch, delete/block, attach replay and cleanup retry hold |
| MSC-M06 bounds/public | Alice/Bob/Eve/Anonymous | SC-AS10/11 | public continuity, storage-full/overload rejection and GC hold |

Each cell must emit the exact named state transitions from
`sc-dj-mobile-matrix`; a single aggregate `MSC-Mxx=PASS` without per-state
observations is invalid.

## 14. Atomic Cutover Matrix

| Concern | New source | Cutover | Delete |
|---|---|---|---|
| client crypto | Secure Content Core | W2 atomically cuts Chat; W7/W9 cut Social clients | Chat generic implementation in W2; Social bespoke implementation in W11 |
| Station validation | internal Go kernel | Social and Conversation conformance | copied validators/FSMs |
| private Post/Comment | encrypted domain resources | receiver readback and stats/dashboard parity | W11 removes model/read/write owners; W12 removes physical legacy columns/tables |
| envelopes | one-time endpoint/recovery plans | normal/recovery Journeys | signaling/Audience envelope path |
| Social objects | Social object plane | UOW/object Journey | public private-media OSS path |
| auth | strict Optional JWT | credential matrix | missing-JWT/invalid-as-anonymous behavior |
| API | Moments-only | all clients migrated | `/posts*` and visibility fallback |
| source/route/generated | canonical contracts and consumers | W11 non-destructive hard cut | old runtime callers, routes, generated symbols and compatibility code |
| physical legacy data/schema | W12 scoped reset owner | explicit two-profile authorization plus public preservation audit | old private rows, tables and media |

## 15. Status

| Workstream | Journey | State | Checkpoint | Functional | Acceptance | Blocker |
|---|---|---|---|---|---|---|
| W0 | governance | complete | plan-review-v14 | N/A | N/A | none |
| W0R | machine runtime control | complete | `8a7722c93` | PASS | NOT_RUN | none |
| W14 | scoped generator groundwork | complete | `69fe979b3` | SOURCE_CHECK/PASS | N/A | none |
| W1 | contracts | parked | none | NOT_RUN | NOT_RUN | proposed `SC-D14` passed independent review; Owner acceptance required |
| W2 | atomic kernels/Chat | parked | none | NOT_RUN | NOT_RUN | W0R/W1/W4; active MCA Desktop source and Station deploy/slot owner |
| W3 | PreKeys | parked | none | NOT_RUN | NOT_RUN | W2 |
| W4 | auth | complete | `8260e4330` | PASS (`sc-dj-optional-auth`) | NOT_RUN | none |
| W5 | recovery | parked | none | NOT_RUN | NOT_RUN | W1/W2/W3 |
| W6 | Social minimum | parked | none | NOT_RUN | NOT_RUN | W2/W3/W4 |
| W7 | Desktop pilot | parked | none | NOT_RUN | NOT_RUN | W6; active MCA Desktop claim and Station runtime owner |
| W8 | Social expansion | parked | none | NOT_RUN | NOT_RUN | W7 FUNCTIONAL_PASS |
| W9 | Mobile | parked | none | NOT_RUN | NOT_RUN | W5/W7/W8; Mobile claim |
| W10 | Chat regression | parked | none | NOT_RUN | NOT_RUN | W2/W9 FUNCTIONAL_PASS; active Desktop/Station runtime owners |
| W11 | source/route/generated hard cut | parked | none | NOT_RUN | NOT_RUN | W8/W9/W10 |
| W12 | physical schema/data cut + full functional | parked | none | NOT_RUN | NOT_RUN | W5/W11; exact two-profile reset/deploy authorization |
| W13 | Acceptance | parked | none | NOT_RUN | NOT_RUN | W12 FUNCTIONAL_PASS; active Acceptance owner |

Overall: `4/16`. DWF-D13 removed the cross-worktree source-lock blocker and a
real W1 declaration reached `ACTIVE`. The missing wire contracts are now defined
by proposed `SC-D14`, including bounded subtype payloads, canonical replay,
viewer commit proof, PUBLIC/private repost proof, source-owned media, mention
commitments, and recovery locators. Independent review v11 passes all six
invariants with no findings. W1 remains parked at the mandatory Owner acceptance
gate; a reviewed proposal is not an accepted architecture decision.

Current evidence:

- W0R: 33 Node control-plane tests, 23 profile/lease Python tests, independent
  review PASS, and authoritative `four` / slot 5 registration readback for
  workspace `9eb2cb904c9ae460`.
- W4: Auth/Social Go race suites PASS, 14 Development runner/projector tests
  PASS, independent review PASS, and
  `~/.peers-touch/dev/workspaces/9eb2cb904c9ae460/development/secure-content/W4/SC-AS02/result.json`
  records an exact-source `FUNCTIONAL_CHECK/PASS` at checkpoint `8260e4330`.
- W14: 13 isolated generator tests, hard-rules, shell/Node syntax and work-item
  schema checks PASS at `69fe979b3`; final independent review PASS. The real
  check entry fails closed with `PROTO_INPUT_MISSING` until W1 adds the accepted
  contract roots, and that expected failure leaves the repository unchanged.
- Development Workflow DWF-D13 was integrated at `9271a8868` with federation
  reconciliation at `93bfdcabc`; 18/18 focused ledger tests and `skill-check`
  pass. A W1 declaration then reached `ACTIVE` despite the independent
  MCA/NDR source overlap and was released cleanly after the design gap was
  confirmed.
- Proposed `SC-D14` is checkpointed at `1ecc92ad2`; eleven defect-driven
  independent review rounds resolved all findings. Final review result:
  `PASS`, with metadata minimization, bounded decoding, exact replay,
  viewer-scoped projection, cross-language proto-first generation, and
  ownership/transaction boundary all `PASS`.
- PR #111 continuation `b5f42f721` was integrated by merge commit
  `e43dd257e`. The semantic base `2d54851f9` proved zero overlap between
  the 13 incoming files and the 62-file Secure Content delta; blob-level
  verification preserved both sides without an overwrite resolution.
- Formal Acceptance remains `NOT_RUN`. The Acceptance Gap Detector itself
  passes 22 tests, but a claim scan remains unavailable until the canonical
  Acceptance plan artifact exists; no `PROVEN` claim is made.

## 16. Risks And Escalation

Return to DESIGN if implementation needs stable recipient identifiers, a shared
stateful authority, Station plaintext, changed Chat behavior, a compatibility
window, or weaker recovery.

Return to PRODUCT if private audience limits, Browser support, federation scope,
deletion promises, or required Post subtypes change.

Hard governance boundaries:

- another active source owner retains an overlapping write/read claim;
- exact deploy/profile/reset resource is unavailable or unauthorized;
- push/PR/history rewrite remains unauthorized.

## 17. Plan Review Gate

`PLAN_READY_FOR_EXECUTION` requires:

- independent review returns `PASS`;
- function-first ordering and per-workstream contracts remain intact;
- active-work state matches this table;
- the next Ready Queue action has conflict-free source claims;
- implementation begins through `pt-execution-plan-guardian`.

Result: `PASS` from independent review `secure_content_plan_review_v14` on
2026-09-13. The Owner's autonomous-execution delegation authorizes immediate
execution; destructive W12 scope remains separately unauthorized.
