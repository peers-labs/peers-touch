# LobeHub Live Audit Tracker

> **Status**: in-progress
> **Goal**: Complete live operation coverage of `https://app.lobehub.com/` before R2 prototype rewrite.
> **Canonical Inventory**: `docs/architecture/agent/prototype/lobehub-live-interaction-inventory.md`
> **Ledger Evidence**: `tmp/agent-lobehub-fullstack-ledger.md` / `EVID-010-R2-E`
> **Updated**: 2026-07-07

---

## 1. Completion Rule

No item is complete unless it has:

1. Browser operation evidence, not only source reading.
2. A corresponding `LIVE-*` row in the canonical inventory.
3. Ownership classification:
   - `base-client`
   - `base-settings`
   - `base-resource`
   - `agent-domain`
   - `agent-consumer`
   - `external/deferred`
4. Prototype implication.
5. Explicit risk/limitation if operation is blocked or destructive.

## 2. Current Coverage Summary

| Pass | Scope | Status | Current evidence | Remaining |
| --- | --- | --- | --- | --- |
| PASS-A | Left rail exhaustive | partial | LIVE-001..LIVE-010, LIVE-016..LIVE-018, LIVE-043..LIVE-050, LIVE-057, LIVE-096, LIVE-119 | Group controls resolved as action menus rather than proven collapse. Upgrade card DOM present but lacks stable accessible ref; billing click remains blocked/deferred. |
| PASS-B | Home exhaustive | partial | LIVE-011..LIVE-015, LIVE-051..LIVE-056, LIVE-097, LIVE-108..LIVE-111, LIVE-126, LIVE-130, LIVE-136, LIVE-144 | Real Agent send, Home root new-topic send, auto naming and Home Add task are now observed. `@` was verified as no-candidate/ordinary text in Agent chat. Bot Channel setup is covered without saving credentials. Remaining gaps: destructive cleanup and deeper channel execution. |
| PASS-C | Tasks | partial | LIVE-026..LIVE-030, LIVE-067..LIVE-069, LIVE-098..LIVE-099, LIVE-115, LIVE-125, LIVE-131, LIVE-136, LIVE-148, LIVE-150 | Keyboard submit, one-time tool approval, Home Add task, detail Run, scheduled state, cancel schedule, Backlog transition, awaiting-input activity and list grouping/settings controls are observed. Mouse hit-target interception remains a UI defect; empty/error states and delete cleanup remain partial. |
| PASS-D | Pages | partial | LIVE-031..LIVE-034, LIVE-064..LIVE-066, LIVE-118, LIVE-127, LIVE-137..LIVE-140, LIVE-151 | Markdown export submenu, rename autosave, version increment, delete confirmation, delayed delete projection convergence and upload/import file-input accept boundaries are covered. Actual OS file picker upload/import and download verification remain partial. |
| PASS-E | Recents | partial | LIVE-046, LIVE-091, LIVE-093, LIVE-096, LIVE-145 | Clean group collapse/More semantics, rename/delete/pin actions remain blocked or partial; topic row adjacent action still has hit-target interception. |
| PASS-F | Agents | closeout-partial | LIVE-008, LIVE-047..LIVE-049, LIVE-058..LIVE-063, LIVE-092, LIVE-094, LIVE-107..LIVE-111, LIVE-120..LIVE-122, LIVE-128..LIVE-130, LIVE-134..LIVE-136, LIVE-143, LIVE-149, LIVE-154, LIVE-157, LIVE-160 | Params, hydrated Profile, profile model selector, autosave, real chat send, bound skill tag, Skill picker detail and composer Files/Libraries picker restriction are proven. Agent-local skill binding mutation and resource binding success remain live-unresolved after final short pass; R2 must model visible-but-unbound/error states instead of claiming success. |
| PASS-G | Generation | partial | LIVE-070..LIVE-072, LIVE-114, LIVE-124, LIVE-132, LIVE-147 | Actual Generate execution, generated topic, 2 image outputs, preview overlay and preview close/prev/next boundary are observed. Refine, download/export result actions, quota/error states and weakly labeled result actions remain partial. |
| PASS-H | Community | partial | LIVE-073..LIVE-074, LIVE-100..LIVE-106, LIVE-141 | MCP Installation Method, local NPM/stdio config, external Discord help link and weak copy feedback are covered. Actual local install/use/fork-like flows remain deferred/platform-external. |
| PASS-I | Resources | closeout-partial | LIVE-075..LIVE-076, LIVE-095, LIVE-109, LIVE-112..LIVE-113, LIVE-123, LIVE-133, LIVE-142..LIVE-143, LIVE-152, LIVE-154, LIVE-160 | List, view mode, import/connect menu, upload file-input boundary, generated image resource detail/preview, Batch actions ambiguity, search no-op behavior and Agent picker visibility restriction are covered. Actual file selection/upload/import execution and chunking/indexing transitions remain tool-limited; Agent binding execution remains live-unresolved after final pass. |
| PASS-J | Memory | partial | LIVE-019..LIVE-025, LIVE-041, LIVE-116, LIVE-146 | Empty memory, analysis modal and long-running `Processed 0 / 11 conversations` state are covered. Real memory record detail/edit/delete remain unavailable because no records were produced. |
| PASS-K | Global overlays | partial | LIVE-001..LIVE-004, LIVE-016, LIVE-035..LIVE-044, LIVE-050, LIVE-056..LIVE-057, LIVE-077..LIVE-090 | Sign out remains blocked/session-ending; external desktop download was inspected by href only. |

## 3. Detailed Task Queue

### PASS-A Left Rail Exhaustive

| ID | Task | Status | Evidence | Ownership |
| --- | --- | --- | --- | --- |
| A-001 | Account menu open/close and nested Language menu | done | LIVE-001..LIVE-004, LIVE-016 | base-client/base-settings |
| A-002 | Command palette via Search / Meta+K | done | LIVE-017..LIVE-018/LIVE-096 | base-client |
| A-003 | Search row mouse click target and accessibility behavior | partial | LIVE-005/LIVE-096; click works with delay but target remains non-standard/inaccessible | base-client |
| A-004 | Sidebar collapse / expand controls | done | LIVE-043 | base-client |
| A-005 | Notification bell panel | done | LIVE-044 | base-client |
| A-006 | Primary nav active states Home/Tasks/Pages | partial | LIVE-006, LIVE-026, LIVE-031 | base-client |
| A-007 | Recents group collapse/expand and More expansion | partial | LIVE-045/LIVE-119; visible section controls resolve to section menus/actions rather than clean collapse; More overlay covered separately | base-client + agent/resource consumers |
| A-008 | Recents item overflow menus | done | LIVE-046 | base-client + owning target module |
| A-009 | Agents group collapse/expand | partial | LIVE-047/LIVE-119; controls open `Add New Category` and `Create Agent`, not a proven collapse state | agent-domain + base-client |
| A-010 | Agent item overflow menus | done | LIVE-049 | agent-domain |
| A-011 | Create Agent left rail action | done | LIVE-047/LIVE-048 | agent-domain |
| A-012 | Help Center overlay | done | LIVE-050 | external/deferred |
| A-013 | Upgrade plan card | partial | LIVE-057/LIVE-119; card DOM and copy observed, no stable accessible ref; billing navigation not opened | base-settings/external |

### PASS-B Home Exhaustive

| ID | Task | Status | Evidence | Ownership |
| --- | --- | --- | --- | --- |
| B-001 | Home selected agent header and Agent selector popover | done | LIVE-011/LIVE-051 | agent-domain |
| B-002 | Home/Agent composer type/send and disabled/enabled states | done | LIVE-012/LIVE-052/LIVE-130/LIVE-144; existing-topic send succeeded and Home root composer created a new topic with assistant response `OK` | agent-domain |
| B-003 | `@` assignment flow | partial | LIVE-053/LIVE-108/LIVE-130; `@` typed in Agent chat and no candidate popup exposed, rendering as ordinary text | agent-domain with Actor boundary |
| B-004 | Plus/add context menu | done | LIVE-013/LIVE-054/LIVE-109/LIVE-110 | agent-consumer/base-resource/tool platform |
| B-005 | Model selector popover and provider+model identity | done | LIVE-013/LIVE-014/LIVE-055/LIVE-111 | base-settings consumed by Agent |
| B-006 | Send button behavior from Agent topic/Home root | done | LIVE-130/LIVE-144; send enabled, user message persisted, assistant response completed, Home root navigated into new topic and composer disabled after empty | agent-domain |
| B-007 | Bot channel create/promo row | done | LIVE-126 covers route, channel tabs, credential fields, advanced policy and no-save boundary | base-settings/integration/security with agent-consumer |
| B-008 | Recommended model chips click behavior | partial | LIVE-014/LIVE-056; locked premium model opens billing gate | base-settings consumed by Agent |
| B-009 | Recommendations refresh | done | LIVE-015/LIVE-097 | agent-domain |
| B-010 | Add task from Home recommendation cards | done | LIVE-136; created `T-2 Must-read papers weekly` and navigated to task detail | agent-domain |

### PASS-C Tasks

| ID | Task | Status | Evidence | Ownership |
| --- | --- | --- | --- | --- |
| C-001 | Tasks shell and creation form | done | LIVE-026 | agent-domain |
| C-002 | Task instruction editor | partial | LIVE-027 | agent-domain |
| C-003 | Assignee selector | partial | LIVE-028 | agent-domain with Actor boundary |
| C-004 | Priority selector | done | LIVE-029 | agent-domain |
| C-005 | Attachment/context action | partial | LIVE-125/LIVE-131; bottom composer controls visible but click target remains intercepted by task list layer | base-resource consumed by Agent |
| C-006 | Create task enabled path | partial | LIVE-131; Enter submits and opens tool approval, but mouse submit remains intercepted and no durable new task appeared in list | agent-domain |
| C-007 | Add task template flow | done | LIVE-067; `Add task` immediately created task detail `T-1` | agent-domain |
| C-008 | Task detail page/panel | done | LIVE-067 | agent-domain |
| C-009 | Task status controls | done | LIVE-068 | agent-domain |
| C-010 | Filters/list/empty/error states | partial | LIVE-099/LIVE-115/LIVE-136/LIVE-150/LIVE-156 cover scheduled/backlog grouping, direct route hydration, settings popover, grouping/sub-grouping/ordering controls, completed/canceled visibility switch and post-delete list reconciliation; empty/error variants still pending | agent-domain |
| C-011 | Task schedule controls | done | LIVE-069/LIVE-136; schedule popover observed and `T-2` showed `Every Sun at 20:00` plus `Cancel schedule` affordance | agent-domain |
| C-012 | Run task execution | partial | LIVE-136/LIVE-148/LIVE-155; Run entered `In progress`, then produced an awaiting-input/clarification activity; Cancel schedule moved task to Backlog with `Set schedule`; Show more expanded task history and assistant clarification | agent-domain |
| C-013 | Task overflow/delete cleanup | done | LIVE-156; top ellipsis exposed `Copy ID`, `Copy Link`, `Delete`, confirmation `Cancel/Delete`, and confirming Delete removed `T-2 Must-read papers weekly` from `/tasks` list projection | agent-domain |

### PASS-D Pages

| ID | Task | Status | Evidence | Ownership |
| --- | --- | --- | --- | --- |
| D-001 | Pages shell and list | done | LIVE-031 | base-resource |
| D-002 | Create new page | done | LIVE-032 | base-resource |
| D-003 | Page Agent surface | partial | LIVE-033/LIVE-034 | agent-consumer |
| D-004 | Upload Files card | partial | LIVE-031/LIVE-140; Upload Files is a non-semantic div card and hidden inputs accept `.md,.markdown,.pdf,.docx`; native file picker execution remains outside browser MCP | base-resource |
| D-005 | Import from Notion card | done | LIVE-064 | base-resource/external connector |
| D-006 | Page editor blocks and typing | partial | LIVE-034/LIVE-066; content observed, typing not executed to avoid mutating real page | base-resource |
| D-007 | Title rename persistence | done | LIVE-138; rename to `Audit Page Rename` autosaved, page title updated and Version History moved to `2 versions` | base-resource |
| D-008 | Share menu | done | LIVE-065 | base-resource/base-client |
| D-009 | Page item overflow menu | done | LIVE-066 | base-resource |
| D-010 | Page destructive actions | partial | LIVE-139/LIVE-151; Delete confirmation and confirm path observed, and later `/page` recheck converged to `Pages 4` without `Audit Page Rename`; immediate projection was stale, delayed reconciliation observed | base-resource |
| D-011 | Page duplicate/export/version/copy actions | partial | LIVE-066/LIVE-118/LIVE-127/LIVE-137/LIVE-138; duplicate was accidentally executed earlier via stale ref; Version History/Copy Link covered; Markdown export action showed success check-circle but actual download file is not verified | base-resource |

### PASS-E Recents

| ID | Task | Status | Evidence | Ownership |
| --- | --- | --- | --- | --- |
| E-001 | Recents group collapse/expand | partial | LIVE-007 initial; LIVE-096 expanded overlay and Recents search observed; true group collapse still unproven | base-client |
| E-002 | More expansion | partial | LIVE-045 section show-count menu observed; LIVE-096 expanded overlay observed, but clean More click semantics remain unclear | base-client |
| E-003 | Open chat topic from Recents | done | LIVE-093 | agent-domain |
| E-004 | Open page doc from Recents | done | LIVE-091 | base-resource |
| E-005 | Recents item overflow menu | done | LIVE-046 | owning target module |
| E-006 | Rename/delete/pin/actions if present | partial | LIVE-046 shows rename/delete; LIVE-145 shows `Mark as Completed` from new topic row and adjacent action hit-target interception; cleanup actions not executed | owning target module |

### PASS-F Agents

| ID | Task | Status | Evidence | Ownership |
| --- | --- | --- | --- | --- |
| F-001 | Agent list navigation | partial | LIVE-008/LIVE-058/LIVE-059; Agent chat/profile navigation observed, full Agents index still pending | agent-domain |
| F-002 | Create Agent flow | partial | LIVE-047/LIVE-048; create panel observed, no submit/start-blank executed | agent-domain |
| F-003 | Connect Agent flow | partial | LIVE-039/LIVE-128/LIVE-135; feature flag was toggled on and restored off, but inspected create menus did not reveal a visible `Connect Agent` entry | base-runtime + agent-domain |
| F-004 | Agent profile page | done | LIVE-060 | agent-domain |
| F-005 | Agent settings fields | partial | LIVE-060/LIVE-121/LIVE-134; hydrated profile autosave proven and restored to `Lobe AI`; controlled input replacement behavior is risky | agent-domain |
| F-006 | Agent model/runtime tab | partial | LIVE-062/LIVE-092/LIVE-094/LIVE-107/LIVE-111/LIVE-120/LIVE-121/LIVE-129; model search, profile model combobox, Chat advanced settings and Params panel observed; direct profile route empty-shell remains | agent-consumer/base-settings |
| F-007 | Agent tools tab | partial | LIVE-061/LIVE-122/LIVE-129/LIVE-134/LIVE-149/LIVE-157; catalog/detail and Add Skill menu proven, bound `Web Browsing` display proven, and `Skill Management` routes to global `/settings/skill`; actual Agent-local binding mutation remains unresolved | agent-consumer/tool platform |
| F-008 | Agent knowledge/files tab | partial | LIVE-058/LIVE-063/LIVE-092 show Documents/Web tabs and empty states; LIVE-109/LIVE-143/LIVE-154 resource picker opened from composer, showed public-agent workspace-resource restriction and visible workspace mp3, but item/ellipsis clicks produced no deterministic binding | agent-consumer/base-resource |
| F-009 | Agent memory tab | partial | LIVE-110/LIVE-122/LIVE-157 shows composer Memory entry and profile Skill picker Memory catalog result, but hydrated Agent Profile body has no `Memory` text or dedicated memory data tab | agent-domain + base-settings |
| F-010 | Agent item overflow menu | done | LIVE-049 | agent-domain |

### PASS-G Generation

| ID | Task | Status | Evidence | Ownership |
| --- | --- | --- | --- | --- |
| G-001 | Generation page shell | done | LIVE-070 | generation domain/base-resource |
| G-002 | Prompt input and model/settings | done | LIVE-071/LIVE-072/LIVE-114 | generation domain + base-settings |
| G-003 | Generate action and result state | done | LIVE-132; Generate created `Image Topic 1`, 2 raw images and cover | generation domain |
| G-004 | History/result actions | partial | LIVE-124/LIVE-132/LIVE-147/LIVE-153; generated result preview observed with close/prev/next, result download icon triggered R2 object GET request, and history copy produced `Failed to Copy Prompt`; actual native download completion and refine/export remain unproven | generation domain/base-resource |
| G-005 | Error/empty/quota states | partial | LIVE-071 shows disabled/enabled state; no quota/error execution | base-settings + generation domain |

### PASS-H Community

| ID | Task | Status | Evidence | Ownership |
| --- | --- | --- | --- | --- |
| H-001 | Community page shell | done | LIVE-073/LIVE-100 | marketplace/base-resource |
| H-002 | Search/filter/category/sort | done | LIVE-073/LIVE-074/LIVE-100/LIVE-106; category tabs, search URL/filter/counts and sort dropdown/reorder observed | marketplace/base-client |
| H-003 | Detail page | done | LIVE-101..LIVE-105; hydrated MCP detail, tabs, schema, score, related, agents empty state and version switching observed | marketplace |
| H-004 | Install/fork/use action | partial | LIVE-102/LIVE-103/LIVE-141 show schema plus Installation Method as local NPM/stdio config; actual local install/use not executed | agent-consumer/marketplace |
| H-005 | External links | partial | LIVE-101/LIVE-141; Discord help link opened a new external invite tab and was closed; other external targets remain href-only | external/deferred |

### PASS-I Resources

| ID | Task | Status | Evidence | Ownership |
| --- | --- | --- | --- | --- |
| I-001 | Resources page shell | done | LIVE-075 | base-resource |
| I-002 | Files/resources list | done | LIVE-075 | base-resource |
| I-003 | Upload/import/connect | partial | LIVE-076/LIVE-112/LIVE-133; Add menu and hidden file inputs prove folder/multi-file/ZIP boundaries; actual system file picker selection not executable by browser MCP | base-resource |
| I-004 | Search/filter/detail | partial | LIVE-076/LIVE-152 covers search/sort/view and search no-op/controlled-clear risk; LIVE-095/LIVE-123 cover row selection/query-param and list click limitation; LIVE-142 proves generated image detail with `Image preview` and disabled `Chunking` | base-resource |
| I-007 | Batch actions | partial | LIVE-113/LIVE-152; click in selected-detail state was intercepted; root list click produced no visible menu/selection mode | base-resource |
| I-005 | Knowledge binding to Agent | partial | LIVE-058/LIVE-063 show Documents/Web tabs; LIVE-109/LIVE-143/LIVE-154 opens Files/Libraries picker with Add, public-agent workspace-resource restriction and visible workspace `msg_tkBFQp2tdTurb6.mp3`; item/ellipsis clicks did not create a visible binding | agent-consumer/base-resource |
| I-006 | Connector resources | partial | LIVE-042 settings; LIVE-076/LIVE-112 show Resources `Connect...` and Notion ZIP import flow; actual import not executed | base-resource/tool platform |

### PASS-J Memory

| ID | Task | Status | Evidence | Ownership |
| --- | --- | --- | --- | --- |
| J-001 | Memory app shell | done | LIVE-019 | agent-domain |
| J-002 | Memory analysis modal | partial | LIVE-020/LIVE-146; modal and submit path observed, background progress remained at `Processed 0 / 11 conversations` | agent-domain + Station |
| J-003 | Identities category tabs/search | done | LIVE-021 | agent-domain |
| J-004 | Contexts/Preferences/Experiences/Activities | done | LIVE-022..LIVE-025 | agent-domain |
| J-005 | Real memory record detail | pending | LIVE-146; analysis was requested but account still shows `No Memories Yet` and no record detail exists | agent-domain |
| J-006 | Edit/delete memory record | blocked | no record available; destructive | agent-domain |
| J-007 | Settings memory enable/aggressiveness | done | LIVE-041 | base-settings + agent-domain data plane |
| J-008 | Memory empty/error/disabled state | done | LIVE-019..LIVE-025/LIVE-116 | agent-domain |

### PASS-K Global Overlays And Settings

| ID | Task | Status | Evidence | Ownership |
| --- | --- | --- | --- | --- |
| K-001 | Settings shell/profile | done | LIVE-035/LIVE-036 | base-settings |
| K-002 | Provider registry | done | LIVE-037 | base-settings |
| K-003 | Storage operations | done | LIVE-038 | base-settings |
| K-004 | Advanced flags | done | LIVE-039 | base-settings + agent-consumer |
| K-005 | Service Model routing | done | LIVE-040 | base-settings |
| K-006 | Memory settings | done | LIVE-041 | base-settings + agent-domain data plane |
| K-007 | Skills/connectors registry | closeout-partial | LIVE-042/LIVE-157/LIVE-158/LIVE-159/LIVE-160; Settings Skills covers Connectors, Built-in Tools, Skill Store, import-by-URL, invalid URL validation error, generated SKILL.md fixture import failure after fetch/API call, and source-confirmed `lambdaClient.agentSkills.importFromUrl` success contract. Success install remains unproven. | base-resource/tool platform |
| K-008 | Statistics | done | LIVE-077 | base-settings |
| K-009 | Appearance/theme | done | LIVE-078 | base-client/base-settings |
| K-010 | Devices | done | LIVE-079 | base-client/base-settings |
| K-011 | Hotkeys | done | LIVE-080 | base-client/base-settings |
| K-012 | Notifications settings + notification panel | done | LIVE-044/LIVE-081 | base-client/base-settings |
| K-013 | Plans/Usage/Credits/Billing/Referral Rewards | done | LIVE-056/LIVE-082..LIVE-086 | base-settings/external |
| K-014 | Credentials | done | LIVE-087 | base-settings/security |
| K-015 | Messenger | done | LIVE-088 | base-client/integration |
| K-016 | About | done | LIVE-089 | base-client |
| K-017 | Help Center overlay | done | LIVE-050 | external/deferred |
| K-018 | Desktop app entry | done | LIVE-090; href inspected, external navigation not opened | external/deferred |
| K-019 | Sign out confirmation | blocked | LIVE-090; destructive/session-ending | base-settings |

## 4. Next Exploration Order

1. PASS-F closeout: actual Agent-local skill add/remove binding execution remains live-unresolved because the live Memory detail popup exposes no stable Add/Enable/Remove control and Skill Management routes to global `/settings/skill`. Dedicated Agent memory data tab is live-unavailable in hydrated Agent Profile. Resource binding success also remains live-unresolved after hover/click/Enter and hidden row-action attempts. These are R2 prototype unresolved/error states, not blockers to starting R2 rewrite.
2. PASS-D remaining: actual OS file picker upload/import and export download file verification remain partial. Markdown export action, title rename/version increment, upload accept boundaries, delete confirmation and delayed delete convergence are covered by LIVE-137..LIVE-140/LIVE-151.
3. PASS-C remaining: empty/error variants remain partial. Keyboard submit, approval, Home Add task, Run, schedule states, cancel schedule, awaiting-input state, task activity expansion, list settings and T-2 delete cleanup are covered by LIVE-131/LIVE-136/LIVE-148/LIVE-150/LIVE-155/LIVE-156.
4. PASS-G/I closeout: image refine/quota/error, native download file verification, resource actual file selection/import execution/chunking transition and Agent knowledge binding execution remain partial. Resource binding is explicitly live-unresolved after LIVE-160. These must be represented in R2 as error/unavailable states and should not block prototype rewrite.
5. PASS-B remaining: deeper channel execution and destructive cleanup remain partial; Home root composer send, existing Agent topic real send, `@` no-candidate behavior, recommendation refresh, Add task and Bot Channel setup are covered by LIVE-097/LIVE-126/LIVE-130/LIVE-136/LIVE-144.
6. PASS-A remaining: no further non-destructive evidence found for true collapse; current evidence says section controls are action menus and upgrade billing click is deferred.
7. PASS-H remaining: actual local install/use remains deferred; category/detail/search/sort/version and MCP Installation Method/external Discord behavior are covered by LIVE-100..LIVE-106/LIVE-141.
8. PASS-K signout remains blocked unless Owner explicitly permits ending the authenticated audit session. Skills/connectors registry is covered through global `/settings/skill` in LIVE-157/LIVE-160, including generated SKILL.md fixture import failure and source-confirmed import success contract.

## 5. Known Audit Constraints

- A real `Untitled` page was created during LIVE-032. Do not delete it without explicit Owner approval.
- A real page duplicate `这是一篇Test (Copy)` was created during LIVE-066 by stale menu ref, then renamed to `Audit Page Rename` and delete-confirmed during LIVE-138/LIVE-139 after Owner authorized test-account operations. The `/page` list still showed `Audit Page Rename` afterward, so treat the page deletion state as inconsistent until rechecked.
- `/page` later converged during LIVE-151 to `Pages 4` without `Audit Page Rename`; keep the immediate stale-projection risk but treat the delete as eventually reflected in the list.
- A real task `T-1 ArXiv daily picks` was created during LIVE-067 by `Add task`. Do not run, reschedule, complete, cancel or delete it without explicit Owner approval.
- A real Agent chat message and assistant response were created in `Greetings` during LIVE-130.
- A real image generation topic `gt_IbAr3LxF7U98` / `Image Topic 1` with two generated images was created during LIVE-132.
- A real task `T-2 Must-read papers weekly` was created and run during LIVE-136; it returned to scheduled state and showed `Cancel schedule`.
- `T-2 Must-read papers weekly` schedule was canceled during LIVE-148; stable DOM showed `Backlog` and `Set schedule`.
- `T-2 Must-read papers weekly` was deleted during LIVE-156 through the task detail ellipsis `Delete` confirmation; `/tasks` recheck showed `hasT2:false` and only `T-1 ArXiv daily picks`.
- A real Home-root Agent topic `tpc_WmLL0cE7Ml9i` / `Home 新会话测试` was created during LIVE-144 with one user message and assistant response `OK`.
- Memory analysis was requested during LIVE-146 and remained in progress at `Processed 0 / 11 conversations` during the observation window.
- Resource search was typed as `mp3` during LIVE-152; the list did not visibly filter and the input did not clear via browser `clear`/keyboard attempts in the observation window.
- Agent profile name was temporarily mutated during LIVE-134 and restored to `Lobe AI`; the page showed `Saved a few seconds ago`.
- `Connect Agent` was toggled on during LIVE-135 and restored off after create-menu inspection.
- Some Settings screenshots were unreliable; browser snapshots and DOM text are canonical for those pages.
- Destructive operations are blocked unless explicitly approved: delete page, clear data, reset settings, account deletion, sign out if it would interrupt audit.
- Empty-account states limit memory record edit/delete coverage until real records exist or mock/test data is intentionally created.
- A local test fixture `tmp/lobehub-import-test-skill/SKILL.md` was created during LIVE-159. LobeHub fetched it from `http://127.0.0.1:8765/SKILL.md`, but import failed with `Unexpected token '<'... is not valid JSON`; no installed skill was observed.
