# Agent LobeHub Prototype Review Entry

> **Status**: pending-review
> **Version**: v0.2
> **Created**: 2026-07-07 | **Updated**: 2026-07-08
> **Owner**: Peers-Touch Agent Team
> **Plan Step**: PLAN-P2 / Pending-review transition after source-backed revision
> **Evidence**: EVID-010-PROTOTYPE-REBUILD-N, EVID-011-P-pre, EVID-011-Y-pre, EVID-011-AA-pre, EVID-011-AC-pre, EVID-011-AD-pre, EVID-011-AE-pre, EVID-011-AF-pre, EVID-011-AG-pre, EVID-011-AH-pre, EVID-011-AI-pre, EVID-011-AJ-pre, EVID-011-AK-pre, EVID-011-AL-pre, EVID-011-AM-pre, EVID-011-AN-pre, EVID-011-Z-owner, EVID-011-AO-pre, EVID-011-AP-pre, EVID-011-AQ-pre, EVID-011-AR-pre, EVID-011-AS-pre, EVID-011-AT-pre, EVID-011-AU-pre, EVID-011-AV-pre, EVID-011-AW-pre, EVID-011-AX-pre, EVID-011-AY-pre, EVID-011-AZ-pre, EVID-011-BA-pre, EVID-011-BB-pre, EVID-011-BC-pre, EVID-011-BD-pre, EVID-011-BE-pre, EVID-011-BF-pre, EVID-011-BG-pre, EVID-011-BH-pre, EVID-011-BI-pre, EVID-011-BJ-pre, EVID-011-BK-pre, EVID-011-BL-pre, EVID-011-BM-pre, EVID-011-BN-pre, EVID-011-BO-pre, EVID-011-BP-pre, EVID-011-BQ-pre, EVID-011-BR-pre, EVID-011-BS-pre, EVID-011-BT-pre, EVID-011-BU-pre, EVID-011-BV-pre, EVID-011-BW-pre, EVID-011-BX-pre, EVID-011-BY-pre, EVID-011-BZ-pre, EVID-011-CA-pre, EVID-011-CB-pre, EVID-011-CI-pre, EVID-011-CJ-pre, EVID-011-CC-pre, EVID-011-CK-pre, EVID-011-CZ-pre, EVID-011-DA-pre, EVID-011-DB-pre, EVID-011-CD-pre, EVID-011-CL-pre, EVID-011-DD-pre, EVID-011-CE-pre, EVID-011-CM-pre, EVID-011-CF-pre, EVID-011-CN-pre, EVID-011-CG-pre, EVID-011-CO-pre, EVID-011-CH-pre, EVID-011-CP-pre, EVID-011-SI-pre, EVID-011-CQ-pre, EVID-011-SS-pre, EVID-011-CR-pre, EVID-011-CS-pre, EVID-011-GA-pre, EVID-011-VD-pre, EVID-011-VL-pre, EVID-011-L23-pre, EVID-011-CT-pre, EVID-011-CU-pre, EVID-011-CV-pre, EVID-011-CW-pre, EVID-011-CX-pre, EVID-011-CY-pre, EVID-011-DC-pre

---

## Purpose

This is the pending-review entry for the Peers-Touch Agent LobeHub parity prototype.

It records the Owner review result and the updated revision boundary:

- `pending-review` means the revised prototype package is ready for Owner review, not Owner-confirmed.
- The current revision hides review/evidence annotations from the default product view and has source-backed fidelity passes for active Home, Agent Chat, Profile, Tasks, Pages, Resources, Memory, Settings and Skills surfaces.
- Profile BU evidence adds deeper ProfileEditor / EditorCanvas / AgentTool / AgentBuilder review states for avatar picker, config hydration/edit lock, ModelSelect, tool menu, slash commands, Builder topics, suggestion feedback and Builder composer, with L2 screenshot plus browser snapshot/DOM proof.
- Tasks BV evidence adds deeper AgentTasks / AgentTaskManager review states for inline create draft/attachments/error, context menu, schedule config, detail editors, TopicChatDrawer, right-panel resize and compact task-agent controls, with L2 screenshot plus browser snapshot/DOM proof.
- Pages BW evidence adds deeper Pages / PageEditor review states for display-count menu, page item dropdown, All Pages drawer, autosave/edit-lock banners, version history, compare modal and Page Copilot panel/composer, with L2 screenshot plus browser snapshot/DOM proof.
- Home BX evidence adds deeper AgentHome / ChatInput / Home route review states for AgentSelect async/retry, daily hint, input notice, context/file/typo controls, tools/model/history popovers, StarterList states and Recents drawer/menu/rename, with L2 screenshot plus browser snapshot/DOM proof.
- Cross-surface BY evidence adds an Owner-review consistency sweep covering all active surfaces' latest L2/L3 anchors, deferred Image/Community boundary and fail-closed gate claims.
- Owner decision BZ evidence adds a decision capture packet that turns the BY sweep into per-surface Owner actions while preserving `pending-review` and blocked product migration.
- Home CA evidence adds a live side-by-side visual delta triage and keeps Home `revision-required` for a compact LobeHub-like dashboard revision.
- Home CB evidence implements that compact dashboard revision with connector strip, narrower composer, model chips, Brief/task card and recommendation cards.
- Home CI evidence adds a follow-up Home compact dashboard density revision aligned to LobeHub `HomeContent -> InputArea -> DailyBrief -> TaskTemplateCard` source structure, with connector auth state, Brief divider/artifacts/actions and recommendation schedule/auth/add semantics.
- Home CJ evidence adds a clean scoped Home CI screenshot (`.pt-home-shell.is-compact-home`, no Portal chrome) and promotes CI screenshot/DOM artifacts into the active compact-baseline artifact gate for Home while keeping Owner confirmation and product migration blocked.
- Agent Chat CC evidence implements a compact New Topic default with left action stack, `New Topic` header, `Lobe AI` greeting, compact composer, Allow List and Send while preserving BT deep-chat inspection.
- Agent Chat CK evidence adds the first clean scoped Agent Chat compact screenshot as historical baseline; DA/DB evidence replaces it as the active compact-baseline artifact with live-like icon rail, agent switcher popover, topic grouping, `Agent` / `No device` / `Allow List` footer and `Space` / `Params` affordance while keeping Owner confirmation and product migration blocked.
- Agent Profile CL evidence adds a clean scoped Agent Profile screenshot (`.pt-profile-shell.is-compact-profile`, no Portal chrome), preserves the compact editor default from CD, proves Add Skill and Core Instructions are visible without right-edge truncation, and records CL as historical compact artifact evidence. DD evidence keeps the compact editor and promotes the Builder-visible first screen, including Agent Builder prompt, suggestion cards, `Switch`, composer and rail upgrade card, into the active compact-baseline artifact gate for Profile while keeping Owner confirmation and product migration blocked.
- Tasks CM evidence adds a clean scoped Tasks screenshot (`.pt-task-compact-shell`, no Portal chrome), preserves the compact `All tasks` default from CE, proves the grouped rows and right Task Agent composer are visible, and promotes CM screenshot/DOM artifacts into the active compact-baseline artifact gate for Tasks while keeping Owner confirmation and product migration blocked.
- Pages CN evidence adds a clean scoped Pages screenshot (`.pt-pages-layout.is-compact-pages`, no Portal chrome), preserves the compact `/page` placeholder default from CF, proves the left Pages rail and three start action cards are visible, and promotes CN screenshot/DOM artifacts into the active compact-baseline artifact gate for Pages while keeping Owner confirmation and product migration blocked.
- EVID-011-CO-pre adds a clean scoped Resources screenshot (`.pt-resource-layout.is-compact-resources`, no Portal chrome), preserves the compact ResourceManager default from CG, proves the Resource rail and explorer rows are visible, and promotes CO screenshot/DOM artifacts into the active compact-baseline artifact gate for Resources while keeping Owner confirmation and product migration blocked.
- EVID-011-CP-pre adds a clean scoped Memory screenshot (`.pt-memory-layout.is-compact-memory`, no Portal chrome), preserves the compact `/memory` Home default from CH, proves the Memory nav, RoleTagCloud and Persona content are visible, and promotes CP screenshot/DOM artifacts into the active compact-baseline artifact gate for Memory while keeping Owner confirmation and product migration blocked.
- EVID-011-CQ-pre adds a clean scoped Skills / Tools screenshot (`.pt-skill-settings-layout.is-compact-skills`, no Portal chrome), preserves the compact Settings > Skill default from SI, proves the connector rail and Web Search detail cards are visible, and promotes CQ screenshot/DOM artifacts into the active compact-baseline artifact gate for Skills / Tools while keeping Owner confirmation and product migration blocked.
- EVID-011-CR-pre adds a clean scoped Settings screenshot (`.pt-settings-compact-layout`, no Portal chrome), preserves the compact Settings > Provider `all` default from SS, proves the grouped Settings nav, Provider menu and provider grid are visible, and promotes CR screenshot/DOM artifacts into the active compact-baseline artifact gate for Settings while keeping Owner confirmation and product migration blocked.
- EVID-011-CS-pre synchronizes the Owner review package so the review entry, sweep, visual ledger, confirmation gap audit and gate reports all name the 9 active compact-baseline surfaces through clean scoped L2/L3 artifacts while keeping every Owner disposition undecided or revision-required and product migration blocked.
- Portal smoke evidence confirms the current worktree exposes `Agent LobeHub Parity` as `pending-review`, loads the Agent Home preview, and can switch to the Tasks surface without leaking evidence/debug markers into the default Owner-facing view.
- Gate-hardening evidence confirms Owner/evidence automation now parses the `agent-lobehub-parity` registry row status directly, so other prototypes in `drafting` no longer pollute the target pending-review state.
- Visual-ledger gate evidence confirms automation now checks the side-by-side comparison ledger for active/deferred surface coverage, source/live/prototype references, deltas and allowed verdicts.
- Visual-delta checklist evidence confirms Owner review must use a per-surface side-by-side LobeHub live/source vs Peers prototype comparison row before any confirmation decision can feed PLAN-P5.
- Visual-delta surface-shape evidence confirms the Owner checklist must contain exactly one known row per required surface; duplicate or unknown surface rows now fail closed before Owner review can be treated as deterministic.
- Visual-comparison ledger surface-shape evidence confirms the L1/L2/L3 comparison ledger must contain exactly one known row per required surface; duplicate or unknown surface rows now fail closed before Owner review can rely on the ledger.
- Active compact artifact evidence confirms the 9 active compact-baseline surfaces must have readable L2 PNG screenshots, parseable L3 DOM JSON, true compact markers and `forbiddenHits=[]`; invalid artifacts now fail closed before Owner review can rely on the compact baseline.
- Active review source reachability evidence confirms the 9 active compact review URLs must map to implemented prototype source branches, handled state tokens and compact DOM markers before Owner review can rely on those URLs.
- Pre-confirmation handoff evidence confirms the confirmation gap audit and pre-implementation readiness docs stay synchronized with the latest CS/L23/CT/CU/CV/CW guard chain before PLAN-P5 can rely on them.
- Canonical prototype evidence confirms the `prototype-lobehub-parity` README stays synchronized with the latest CS/GA/L23/CT/CU/CV/CW/CX guard chain before Owner review can rely on it.
- Handoff summary freshness evidence confirms Owner/P5 decision docs no longer carry stale "only through CT" summaries after later guard evidence lands.
- Visual-delta source-anchor evidence confirms each row must preserve both a LobeHub live URL and an `external/lobehub` source path, not one or the other.
- Visual-delta anchor-report evidence confirms generated reports expose live/source/prototype anchor coverage as separate counts.
- Visual-delta disposition-report evidence confirms generated reports expose active `undecided` and Owner-deferred `deferred` coverage as separate counts.
- Visual-comparison verdict-report evidence confirms generated reports expose active/deferred verdict coverage as separate counts.
- Readiness-claim evidence confirms generated reports explicitly state the proven scope is gate/review evidence only and keep prototype confirmation, product migration and EVID-012 authorization false.
- Resources revision evidence adds ResourceManager-like search overlay, library hierarchy, table/list density and file drawer behavior to the prototype; BO adds a reliable `1440x1100` Chrome headless L2 screenshot for overlay + drawer, while Resources remains `revision-required` for remaining full ResourceManager parity deltas.
- Resources BP evidence adds deeper ResourceManager-like action menu, drag/drop overlay, upload dock and chunk drawer review states with L2 screenshots and DOM proof; Resources still remains `revision-required` for remaining virtualization, real upload/editor and store-backed parity gaps.
- Visual-delta disposition evidence confirms active review rows remain `undecided` before Owner confirmation and only Owner-deferred rows may be marked `deferred`.
- Every surface must now pass the side-by-side control in `docs/architecture/agent/lobehub-parity/prototype-visual-comparison-ledger.md`; source-only or memory-only claims are invalid.
- Current active review scope defers `Community Marketplace` and `Image Generation` by Owner request. Deferred surfaces remain listed in the comparison ledger for later parity work and cannot be claimed complete.
- Product migration remains blocked until the prototype becomes `confirmed`.

## Current Prototype

| Field | Value |
| --- | --- |
| Prototype ID | `agent-lobehub-parity` |
| Prototype path | `packages/prototypes/desktop/features/agent-lobehub-parity/` |
| Prototype docs | `docs/architecture/agent/prototype-lobehub-parity/README.md` |
| Portal registry | `docs/architecture/prototypes/README.md` |
| Manifest | `packages/prototypes/desktop/features/agent-lobehub-parity/prototype.manifest.ts` |
| Status | `pending-review` |

## Review Commands

```bash
make run-prototype
pnpm --dir packages/prototypes/desktop/features/agent-lobehub-parity build
pnpm --filter @peers-touch/prototype-portal build
```

Build outputs are verification artifacts and must not be committed.

## Review Inputs

- Source-backed prototype evidence: `docs/architecture/agent/prototype-lobehub-parity/README.md`
- Owner review runbook: `docs/architecture/agent/prototype/owner-review-runbook.md`
- Owner checklist: `docs/architecture/agent/prototype/owner-review-checklist.md`
- Confirmation gap audit: `docs/architecture/agent/lobehub-parity/prototype-confirmation-gap-audit.md`
- Fullstack ledger: `tmp/agent-lobehub-fullstack-ledger.md`
- Gate control snapshot: `docs/architecture/agent/lobehub-parity/owner-decision-status-snapshot.md`
- Pre-implementation readiness: `docs/architecture/agent/lobehub-parity/pre-implementation-readiness.md`
- Cross-surface review sweep: `docs/architecture/agent/lobehub-parity/prototype-cross-surface-review-sweep.md`
- Owner decision packet: `docs/architecture/agent/lobehub-parity/prototype-owner-review-decision-packet.md`
- Home visual delta triage: `docs/architecture/agent/lobehub-parity/home-ca-visual-delta-triage.md`
- Home compact dashboard revision: `docs/architecture/agent/lobehub-parity/home-cb-compact-dashboard-revision.md`
- Home compact dashboard density follow-up: `docs/architecture/agent/lobehub-parity/home-ci-compact-dashboard-density-revision.md`
- Agent Chat compact New Topic revision: `docs/architecture/agent/lobehub-parity/chat-cc-compact-new-topic-revision.md`
- Agent Profile compact editor revision: `docs/architecture/agent/lobehub-parity/profile-cd-compact-editor-revision.md`; active Builder follow-up artifact: `docs/architecture/agent/lobehub-parity/profile-dd-compact-builder-follow-up-revision.md`
- Tasks compact default revision: `docs/architecture/agent/lobehub-parity/tasks-ce-compact-default-revision.md`
- Pages compact default revision: `docs/architecture/agent/lobehub-parity/pages-cf-compact-default-revision.md`
- Resources compact default revision: `docs/architecture/agent/lobehub-parity/resources-cg-compact-default-revision.md`
- Memory compact default revision: `docs/architecture/agent/lobehub-parity/memory-ch-compact-default-revision.md`
- Skills compact default revision: `docs/architecture/agent/lobehub-parity/skills-si-compact-default-revision.md`
- Settings compact default revision: `docs/architecture/agent/lobehub-parity/settings-ss-compact-default-revision.md`

## Decision Outcomes

| Outcome | Meaning | Required ledger action |
| --- | --- | --- |
| `confirmed` | Owner accepts this prototype as the migration reference. | Append a new Evidence row for Owner confirmation, update prototype status to `confirmed`, then unblock EVID-012 only after PLAN-P5 entry checks pass. |
| `revision-required` | Owner rejects or requests material revision. | Append a revision Evidence row, keep product migration blocked, update checklist gaps. |
| `deferred` | Owner does not decide yet. | Keep `pending-review`, keep product migration blocked, record missing review input. |

## Claim Boundary

Current claim: `agent-lobehub-parity` is ready for Owner review after source-backed active-scope fidelity revision through `EVID-011-SS-pre`, Home compact dashboard density follow-up `EVID-011-CI-pre`, clean scoped compact artifact promotion for Home `EVID-011-CJ-pre`, Agent Chat compact follow-up and active artifact promotion `EVID-011-DA-pre` / `EVID-011-DB-pre`, Agent Profile `EVID-011-CL-pre` plus Builder-visible active artifact follow-up `EVID-011-DD-pre`, Tasks `EVID-011-CM-pre`, Pages `EVID-011-CN-pre`, Resources `EVID-011-CO-pre`, Memory `EVID-011-CP-pre`, Skills / Tools `EVID-011-CQ-pre` and Settings `EVID-011-CR-pre`, all-active-surface scoped artifact review-package sync `EVID-011-CS-pre`, confirmation gap audit refresh `EVID-011-GA-pre`, Visual Delta Checklist surface-shape hardening `EVID-011-VD-pre`, visual comparison ledger surface-shape hardening `EVID-011-VL-pre`, active compact L2/L3 artifact validation `EVID-011-L23-pre`, Owner checklist/runbook scoped execution evidence hardening `EVID-011-CT-pre`, Owner review URL allowlist hardening `EVID-011-CU-pre`, active review URL source reachability hardening `EVID-011-CV-pre`, pre-confirmation handoff evidence sync hardening `EVID-011-CW-pre`, canonical prototype evidence sync hardening `EVID-011-CX-pre`, stale handoff summary guard hardening `EVID-011-CY-pre`, and Chat DA/DB handoff freshness guard `EVID-011-DC-pre`.

Memory BQ evidence adds deeper Memory route review states for analysis status/modal, timeline rail, detail action menu, edit modal, loading and not-found panel, with L2 screenshots plus DOM proof.

Skills BR evidence adds deeper Settings > Skill / SkillStore / Custom MCP review states for Add Skill menu, URL import failure, Skill Store tabs/detail/schema, OAuth waiting, connector sync error and MCP drawer, with L2 screenshots plus DOM proof.

Skills SI evidence adds the default compact Settings > Skill visual revision for Owner review, with L2 screenshot plus DOM proof that the default view shows the global settings rail, 300px left panel, Connectors / Skills tabs, Add and Store icon actions, grouped connector sections and selected Web Search detail while hiding Add menu, Store, import, OAuth, sync and custom MCP overlays by default.

Settings SS evidence adds the default compact Settings > Provider `all` visual revision for Owner review, with L2 screenshot plus DOM proof that the default view shows grouped Settings navigation, a 280px provider menu, Search providers, Add custom provider, All Providers active row and enabled/custom/disabled provider grid while hiding provider detail, create provider, sort, model config and delete confirmation overlays by default.

Settings CR evidence promotes the Settings compact default into the active clean scoped artifact gate with `.pt-settings-compact-layout` screenshot plus DOM proof, keeping Settings pending Owner judgment and product migration blocked.

Settings BS evidence adds deeper Settings Provider / Service Model / Storage review states for provider search/add/sort, model-list retry, create provider, model config/delete confirmation, service assignment permission recovery and storage loading/retry panels, with L2 screenshots plus DOM proof.

Chat BT evidence adds deeper ChatList / MessageItem / ChatMiniMap review states for cached-topic refresh, virtualized-list meta, thread hydration, message context menu, tool detail, intervention bar, BackBottom, MiniMap preview, forward selection and WorkingSidebar resize, with L2 screenshot plus browser snapshot/DOM proof.

Chat CC evidence adds the default compact New Topic visual revision for Owner review, with L2 screenshot plus DOM proof that the default view shows the compact action stack, `New Topic`, `Lobe AI`, compact composer, Allow List and Send while hiding deep message stream and WorkingSidebar.

Chat DB evidence adds clean scoped L2 screenshot `tmp/agent-lobehub-l2-screenshots/chat-da-compact-new-topic-scoped.png`, metadata `tmp/agent-lobehub-chat-da-scoped-screenshot-meta.json`, and DOM `tmp/agent-lobehub-chat-da-dom.json`; the active compact artifact gate now validates Agent Chat against DA scoped screenshot plus DA DOM instead of the earlier CK baseline. DA/DB do not confirm Chat and do not authorize product migration.

Home CI evidence adds a compact dashboard density follow-up for Owner review, with L2 screenshot `tmp/agent-lobehub-l2-screenshots/home-ci-compact-dashboard-density.png` plus DOM proof `tmp/agent-lobehub-home-ci-dom.json` that the rendered Home state includes connector connected/auth states, compact composer, model chips, Brief divider/artifacts/actions, recommendation schedule/auth labels and no scoped forbidden leakage.

Home CJ evidence adds clean scoped L2 screenshot `tmp/agent-lobehub-l2-screenshots/home-ci-compact-dashboard-scoped.png` and metadata `tmp/agent-lobehub-home-ci-scoped-screenshot-meta.json`; the active compact artifact gate now validates Home against CI scoped screenshot plus CI DOM instead of the earlier CB artifact. CJ does not confirm Home and does not authorize product migration.

Profile CD evidence adds the default compact ProfileEditor visual revision for Owner review, with L2 screenshot plus DOM proof that the default view shows the agent rail, compact header, avatar, large `Enter agent name`, Model & Tools panel, Add Skill and Core Instructions editor while hiding the old identity card/settings preview/editor dashboard.

Profile CL evidence adds clean scoped L2 screenshot `tmp/agent-lobehub-l2-screenshots/profile-cl-compact-profile-scoped.png`, metadata `tmp/agent-lobehub-profile-cl-scoped-screenshot-meta.json`, and DOM `tmp/agent-lobehub-profile-cl-dom.json`; the active compact artifact gate now validates Agent Profile against CL scoped screenshot plus CL DOM instead of the earlier CD full-root artifact. CL does not confirm Profile and does not authorize product migration.

Profile DD evidence adds clean scoped-isolated L2 screenshot `tmp/agent-lobehub-l2-screenshots/profile-dd-compact-builder-scoped.png`, metadata `tmp/agent-lobehub-profile-dd-scoped-screenshot-meta.json`, and DOM `tmp/agent-lobehub-profile-dd-dom.json`; the active compact artifact gate now validates Agent Profile against DD scoped screenshot plus DD DOM instead of the earlier CL artifact. DD proves the Builder-visible first screen, suggestion cards, `Switch`, composer placeholder and rail upgrade card, but does not confirm Profile and does not authorize product migration.

Tasks CE evidence adds the default compact Tasks visual revision for Owner review, with L2 screenshot plus DOM proof that the default view shows `All tasks`, grouped task rows, search/create/settings controls, right Topic / Task Agent composer, model chip and Send while hiding the deep task detail/editor dashboard by default.

Tasks CM evidence adds clean scoped L2 screenshot `tmp/agent-lobehub-l2-screenshots/tasks-cm-compact-tasks-scoped.png`, metadata `tmp/agent-lobehub-tasks-cm-scoped-screenshot-meta.json`, and DOM `tmp/agent-lobehub-tasks-cm-dom.json`; the active compact artifact gate now validates Tasks against CM scoped screenshot plus CM DOM instead of the earlier CE workspace/full artifact. CM does not confirm Tasks and does not authorize product migration.

Pages CF evidence adds the default compact Pages visual revision for Owner review, with L2 screenshot plus DOM proof that the default view shows the `/page` placeholder, Private / Workspace navigation and New document / Upload files / Import Notion action cards while hiding drawer/history/compare/editor/Page Agent UI by default.

Resources CG evidence adds the default compact Resources visual revision for Owner review, with L2 screenshot plus DOM proof that the default view shows Resource sidebar, categories, Knowledge bases, NavHeader actions and compact resource rows while hiding search overlay, drawer, chunk drawer, upload dock, drag overlay and detail preview by default.

Memory CH evidence adds the default compact Memory visual revision for Owner review, with L2 screenshot plus DOM proof that the default view shows `/memory` Home, Search/Home/category nav, RoleTagCloud and Persona content while hiding filter bar, memory list, detail panel, analysis modal/status and edit modal by default.

Forbidden claim: Owner confirmed the prototype, product migration can start, product code reached LobeHub parity, or GATE-008 is verified.
