# Desktop Prototype <-> Platform Alignment Scope Ledger

> **Audit date**: 2026-10-14
> **Historical source**: `d2c487e27:docs/architecture/engineering/prototypes/desktop-alignment-gaps.md`
> **Current source**: dirty worktree at `19e45f851`
> **Owner**: Desktop Platform Alignment effort

## Status contract

- `IMPLEMENTED/UNPROVEN`: the current source contains the intended production path, but the prototype, exact-source functional proof, or formal Acceptance closure is still open.
- `PARTIAL`: only part of the intended path exists, or the UI remains deliberately disabled.
- `NOT_STARTED`: no alignment delta for this ledger item is present in the current worktree.
- Every row remains `OPEN` until its owning Task closes production behavior, prototype truthfulness, focused checks, and required receiver-side proof.

Current source-side count: `81 IMPLEMENTED/UNPROVEN`, `12 PARTIAL`, `18 NOT_STARTED`, `0/111 formally closed`.

## Shell, identity, and login

| ID | Required outcome | Source state | Current evidence | Task |
|---|---|---|---|---|
| C1 | Persist display name and bio with revision conflict handling | IMPLEMENTED/UNPROVEN | canonical `profile` store and explicit Save/Discard draft; conflicts preserve the draft; prototype mirrors those controls | DUI-01 |
| C2 | Upload avatar through Native picker and OSS | IMPLEMENTED/UNPROVEN | `AccountTab.tsx` uses `pickImageFile` and `profileUploadAvatarOss`; prototype has static initials | DUI-01 |
| C3 | Upload cover through OSS and remove unsupported local history | IMPLEMENTED/UNPROVEN | production uses revision-fenced `profileUploadHeaderOss`; prototype cover history is removed and Native upload availability is explicit | DUI-01 |
| C4 | Use free-text region and IANA timezone | IMPLEMENTED/UNPROVEN | production free-text region and IANA `AutoComplete`; prototype uses text input and timezone suggestions | DUI-01 |
| C5 | Expose profile tags and links | IMPLEMENTED/UNPROVEN | production and prototype expose tags/link rows with explicit draft save/discard | DUI-01 |
| C6 | Render PTID/handle/home Station from one canonical projection | IMPLEMENTED/UNPROVEN | Account reads canonical `profile`; `settingsRuntime` reconciles shell identity through session/generation-fenced `identityRuntime` | DUI-01 |
| C7 | Bind searchable, paginated notification center and inline decisions | IMPLEMENTED/UNPROVEN | shared production `NotificationCenter` searches loaded rows, paginates, and resolves exact pending Social requests; Social produces notification records after commit; Native proof remains open | DUI-01 |
| C8 | Edit real per-category notification preferences and push registrations | PARTIAL | revision-fenced category preferences and redacted push-device readback; registration mutations remain Mobile-owned and provider delivery unproven | DUI-01 |
| C9 | Bind unread badge to authoritative counts and reconciliation | IMPLEMENTED/UNPROVEN | `socialRealtime` owns polling, resync and session reset; mutations reload authoritative counts; list/date publication is session/generation fenced | DUI-01 |
| C10 | Bind PIN set/change/remove, launch unlock, and lockout | IMPLEMENTED/UNPROVEN | Reviewed: production uses canonical account commands; prototype now exercises set/change/remove instead of no-op actions | DUI-02 |
| C11 | Remove unsupported inactivity auto-lock or land accepted ownership | IMPLEMENTED/UNPROVEN | Reviewed: no accepted idle-lock owner exists; production and prototype expose no control | DUI-02 |
| C12 | Keep biometric unlock absent until an accepted Native contract exists | IMPLEMENTED/UNPROVEN | Reviewed: no biometric command, setting, prototype control, or accepted contract exists; no change required | DUI-02 |
| C13 | Remove fictional online-status preference | IMPLEMENTED/UNPROVEN | Reviewed: production has no preference and the prototype toggle is removed | DUI-02 |
| C14 | Remove fictional receipt opt-out unless backend semantics are accepted | IMPLEMENTED/UNPROVEN | Reviewed: receipts remain unconditional and the prototype toggle is removed | DUI-02 |
| C15 | List blocked actors and unblock with revision fencing | IMPLEMENTED/UNPROVEN | Reviewed: `PrivacySettings.tsx` and `store/relationships.ts` own the revision-fenced path; prototype unblock and empty states are interactive | DUI-02 |
| C16 | List authorized devices and support real remote revoke | IMPLEMENTED/UNPROVEN | Reviewed: `FederationTab.tsx` confirms and invokes `revokeDevice(deviceId, profileVersion)` with loading/error feedback | DUI-02 |
| C17 | Switch Station through remote logout, unbind/remove, and account picker | IMPLEMENTED/UNPROVEN | Reviewed: `identityRuntime.switchStation()` performs logout, active `stationRemove`, then account-gate projection; incomplete logout skips detach | DUI-02 |
| C18 | Present real multi-account picker, not mock device rows | IMPLEMENTED/UNPROVEN | Reviewed: production uses the restorable account registry; prototype fixtures remain account-shaped mock data, not device rows; no change required | DUI-02 |
| C19 | Remove unshipped dark theme and density controls | PARTIAL | production correctly ships one light theme; prototype still exposes System/Light/Dark and density | DUI-03 |
| C20 | Offer only shipped locale packs and bind persisted language | IMPLEMENTED/UNPROVEN | production `LanguageSwitcher` uses shipped packs; prototype still advertises Japanese | DUI-03 |
| C21 | Render server-driven OAuth providers and real loopback lifecycle | IMPLEMENTED/UNPROVEN | `useOAuth2Store` loads providers and owns start/poll/cancel/resume; prototype remains hardcoded | DUI-03 |
| C22 | Remove fake credentials and use canonical Access login gate | IMPLEMENTED/UNPROVEN | password login runs `accessStart` and typed login submission; prototype still contains fake credentials | DUI-03 |
| C23 | Render invite, terms, custom, blocked, and maintenance Access gates | IMPLEMENTED/UNPROVEN | `LoginPage`, `LoginFormView`, and `accessGate.ts` render typed invite/generic/blocked/maintenance states | DUI-03 |
| C24 | Bind Station picker add/select/remove/probe lifecycle | IMPLEMENTED/UNPROVEN | `StationPicker.tsx` implements list, probe, add, select, remove, and copy; prototype remains static | DUI-03 |
| C25 | Expose forgot-PIN and encrypted-message recovery journeys | IMPLEMENTED/UNPROVEN | Reviewed: production paths are live; prototype now exposes interactive PIN replacement and 24-word encrypted-key restore states | DUI-02 |

## Social chat

| ID | Required outcome | Source state | Current evidence | Task |
|---|---|---|---|---|
| S1 | Real DM/group send and receive through Conversation projections | IMPLEMENTED/UNPROVEN | `socialChat` and `im-service` use canonical send plus runtime projections; prototype remains local append | DUI-04 |
| S2 | Real sent/delivered/read/retry state | IMPLEMENTED/UNPROVEN | production outbox, receipts, forward-only status, and retry are live; prototype uses timers | DUI-04 |
| S3 | Persist reactions and per-actor projection | IMPLEMENTED/UNPROVEN | production reaction facts, mutations, and visible projection are wired; prototype state is local | DUI-04 |
| S4 | Persist reply/quote target | IMPLEMENTED/UNPROVEN | production send carries reply relation and renders reply preview; prototype remains local | DUI-04 |
| S5 | Bind thread list and counts | IMPLEMENTED/UNPROVEN | production thread list/count commands and panel are wired; prototype panel is local | DUI-04 |
| S6 | Bind pinned message projection and banner | IMPLEMENTED/UNPROVEN | production pin command and projection are wired; prototype uses a local Set | DUI-04 |
| S7 | Bind author-only edit with real policy | IMPLEMENTED/UNPROVEN | production edit command and UI are wired; prototype mutates local data | DUI-04 |
| S8 | Preserve delete-for-me versus retract semantics | IMPLEMENTED/UNPROVEN | production hide and retract paths remain distinct; prototype uses local filters | DUI-04 |
| S9 | Implement one accepted forward semantic end to end | PARTIAL | picker sends plaintext as a new message and drops attachments/forward provenance despite generated forward facts | DUI-04 |
| S10 | Bind typing pulses and stale sweep | IMPLEMENTED/UNPROVEN | production typing submission, realtime projection, and stale sweep are live; prototype uses a timer | DUI-04 |
| S11 | Carry validated group person/all mentions through encrypted message | IMPLEMENTED/UNPROVEN | chat proto, Conversation aggregate, Rust DTO, composer picker and tests | DUI-04 |
| S12 | Record/upload/render real voice notes | IMPLEMENTED/UNPROVEN | recorder, staged `voice_note`, duration, playback, seek, retry, and failure states are live | DUI-05 |
| S13 | Upload encrypted attachments with availability states | IMPLEMENTED/UNPROVEN | Native pick/capture, staging, encrypted transfer, projection, open/download, and availability states are live | DUI-05 |
| S14 | Bind friend request send/accept/decline and DM creation | IMPLEMENTED/UNPROVEN | Social commands, Contacts decisions, realtime convergence, and DM opening are wired | DUI-05 |
| S15 | Separate exact handle resolution from directory search | IMPLEMENTED/UNPROVEN | `FindPeopleModal` separates federation resolve from catalog search; prototype filters local contacts | DUI-05 |
| S16 | Bind federated friend requests and receiver policy | IMPLEMENTED/UNPROVEN | federated request delivery and contact policy enforcement exist; prototype remains local | DUI-05 |
| S17 | Add contextual block/unblock to Social surfaces | NOT_STARTED | C15 settings surface exists; Social UI remains absent | DUI-05 |
| S18 | Create groups through prepare/create and MLS welcomes | IMPLEMENTED/UNPROVEN | group prepare/create, device selection, MLS packages, and modal flow are live | DUI-06 |
| S19 | Enforce roles, authority, and owner transfer in UI | IMPLEMENTED/UNPROVEN | generated roles, permission helpers, member controls, and owner transfer are wired | DUI-06 |
| S20 | Bind add/invite/leave intent lifecycle | IMPLEMENTED/UNPROVEN | membership transition, member-authority, add, remove, and leave paths are live | DUI-06 |
| S21 | Bind group settings, leave, dissolve, and member preferences | IMPLEMENTED/UNPROVEN | settings, member preferences, leave, and owner-only dissolve are wired | DUI-06 |
| S22 | Surface group-invite decision inbox | NOT_STARTED | membership proposals exist; client inbox is missing | DUI-06 |
| S23 | Derive session unread/pin/mute/last-message state | IMPLEMENTED/UNPROVEN | session list derives durable conversation/member/read projections; prototype remains static | DUI-06 |
| S24 | Bind hide/clear/retention and physical reclamation | IMPLEMENTED/UNPROVEN | hide, per-conversation clear, retention, batch clear, and storage governance are wired | DUI-06 |
| S25 | Scope search to canonical per-conversation FTS or build accepted global API | IMPLEMENTED/UNPROVEN | production uses canonical per-conversation FTS; prototype still claims optional global search | DUI-07 |
| S26 | Render profile, federation markers, and identity rows | IMPLEMENTED/UNPROVEN | `PublicProfileCard`, identity rows, federated handles, and peer profile projection are live | DUI-07 |
| S27 | Bind safety-number/key verification | IMPLEMENTED/UNPROVEN | `SafetyVerificationPanel` is wired to real identity fingerprints and verification | DUI-07 |
| S28 | Use real social statistics or remove fabricated counts | IMPLEMENTED/UNPROVEN | Actor/profile and Social stats are projected into account, contact, and chat detail surfaces | DUI-07 |
| S29 | Replace simulator label with real 1:1 WebRTC calls | IMPLEMENTED/UNPROVEN | production `CallSurface` and call runtime are live; prototype still labels simulator controls | DUI-07 |
| S30 | Add real multi-party group-call surface | IMPLEMENTED/UNPROVEN | production `GroupCallSurface` and authority join path exist; prototype omits them | DUI-07 |
| S31 | Expose accepted moderation/follow/circle scope without invented controls | IMPLEMENTED/UNPROVEN | moderation facts, follow graph, circles, and management surfaces exist; prototype coverage is absent | DUI-07 |

## AI

| ID | Required outcome | Source state | Current evidence | Task |
|---|---|---|---|---|
| AI1 | Bind provider CRUD, credentials, models, and real test | IMPLEMENTED/UNPROVEN | production Provider surfaces use Station CRUD, encrypted credentials, connectivity, and model discovery | DUI-08 |
| AI2 | Use accepted scenario routing instead of a fictional global catalog | IMPLEMENTED/UNPROVEN | `ModelServiceTab` persists scenario routes against real provider/model options | DUI-08 |
| AI3 | Bind real memory config/test/CRUD/import/export | IMPLEMENTED/UNPROVEN | production memory settings and APIs cover config, test, CRUD, import, export, and tuning | DUI-08 |
| AI4 | Bind signed skill import, verify, versions, and rollback | IMPLEMENTED/UNPROVEN | `SkillsTab` uses catalog, signature/scan state, install, patch, versions, and delete paths | DUI-08 |
| AI5 | Bind Station-owned MCP config and real reconcile/readiness | IMPLEMENTED/UNPROVEN | typed MCP server/tool/resource lifecycles and capability readiness are wired | DUI-08 |
| AI6 | Bind Agent roster/create/duplicate/delete | IMPLEMENTED/UNPROVEN | Agent store and rails use Station create, duplicate, delete, update, and persisted pin state | DUI-09 |
| AI7 | Persist SOUL/AGENTS/system prompt with version conflicts | IMPLEMENTED/UNPROVEN | `AgentProfilePage` persists `soulMd`, `agentsMd`, system prompt, and Agent config | DUI-09 |
| AI8 | Bind provider/model/effort to available-model projection | IMPLEMENTED/UNPROVEN | `ModelSelect` and profile/create controls use real provider/model options and persisted effort | DUI-09 |
| AI9 | Remove fictional temperature knob | PARTIAL | production correctly exposes effort instead; Agent prototypes still declare temperature | DUI-09 |
| AI10 | Bind governed tools/skills/MCP/connectors/knowledge | IMPLEMENTED/UNPROVEN | capability authority, inventory, bindings, connectors, and knowledge descriptors are wired | DUI-09 |
| AI11 | Bind Builder quick completion | IMPLEMENTED/UNPROVEN | `BuilderPanel` calls Station `agent_quick_completion` and renders returned guidance | DUI-09 |
| AI12 | Bind streaming turns, tool calls, approvals, and recovery | IMPLEMENTED/UNPROVEN | Agent runtime renders typed stream, tool, approval, intervention, resume, and recovery state | DUI-10 |
| AI13 | Bind activity, diagnostics, and trace export | IMPLEMENTED/UNPROVEN | runtime activity, turn details, operation trays, diagnostics, and trace export are live | DUI-10 |
| AI14 | Replace fictional nine-role council with real orchestration events | IMPLEMENTED/UNPROVEN | `AgentCanvasPage` consumes Station collaboration tasks, nodes, engines, judge, and synthesis | DUI-10 |
| AI15 | Expose real workspace isolation controls | IMPLEMENTED/UNPROVEN | profile and workspace surfaces persist mode, roots, files, tasks, todos, and artifacts | DUI-09 |
| AI16 | Bind real Evaluation console and runs | IMPLEMENTED/UNPROVEN | production Evaluation page/runtime use typed suites, cases, runs, retry, compare, and export | DUI-11 |
| AI17 | Expose Agent export/import portability | IMPLEMENTED/UNPROVEN | Agent sidebar/rail call typed package export/import through Native and Station | DUI-11 |
| AI18 | Bind Home projection for pinned agents/topics/tasks | IMPLEMENTED/UNPROVEN | Home runtime/page consume Station readiness, pinned-agent, topic, task, and recent-work projections | DUI-11 |

## Applets

| ID | Required outcome | Source state | Current evidence | Task |
|---|---|---|---|---|
| AP1 | Bind launcher/search to installed and catalog projections | IMPLEMENTED/UNPROVEN | `AppletsPage.tsx`, `store/applets.ts`; prototype still hardcoded | DUI-12 |
| AP2 | Use directory-based local import, not `.bundle` fiction | IMPLEMENTED/UNPROVEN | production import path exists; applet-workspace prototype still `.bundle` | DUI-12 |
| AP3 | Expose Station catalog/install surface | IMPLEMENTED/UNPROVEN | catalog cards and install action exist in `AppletsPage.tsx` | DUI-12 |
| AP4 | Launch real Lynx surface through kernel/session gateway | NOT_STARTED | production runtime exists; prototype renders skeleton | DUI-13 |
| AP5 | Project seven-state lifecycle and reclaim semantics | NOT_STARTED | kernel FSM exists; prototype shows a binary dot | DUI-13 |
| AP6 | Support accepted multi-instance applet contexts end to end | NOT_STARTED | current kernel remains applet-id keyed | DUI-13 |
| AP7 | Use real detached OS window semantics | IMPLEMENTED/UNPROVEN | production detach path exists; prototype still shows in-shell card | DUI-13 |
| AP8 | Align pin to Desktop sidebar semantics | NOT_STARTED | `appletPins` exists; prototype says pin to system | DUI-13 |
| AP9 | Uninstall non-bundled applets from UI | IMPLEMENTED/UNPROVEN | `AppletsPage.tsx`, `uninstallAppletRuntime` | DUI-14 |
| AP10 | Surface permissions, approvals, audit, and quotas | NOT_STARTED | enforcement exists; prototype has one trust label | DUI-14 |
| AP11 | Surface revoked/disabled/update/offline status | IMPLEMENTED/UNPROVEN | `RuntimeAppletStatus`, catalog/status tags | DUI-14 |
| AP12 | Remove fictional launcher badges or land an accepted event contract | NOT_STARTED | no canonical badge projection | DUI-14 |
| AP13 | Use real applet identities | IMPLEMENTED/UNPROVEN | production defaults `peers.note`/`peers.atelier`; shell settings still fictional | DUI-12 |
| AP14 | Delete dead legacy registry path | NOT_STARTED | `apps/desktop/src/applets/registry.ts` remains a stub target | DUI-12 |

## Advanced settings

| ID | Required outcome | Source state | Current evidence | Task |
|---|---|---|---|---|
| AD1 | Show measured storage only and bind retention/cache cleanup | NOT_STARTED | `ChatStorageSettings.tsx`; prototype invents buckets | DUI-15 |
| AD2 | Bind real OSS file lifecycle | NOT_STARTED | `MyFilesSettings.tsx`; prototype shows a static count | DUI-15 |
| AD3 | Replace fictional whole-data export with real recovery/export journeys | NOT_STARTED | only memory export and encrypted chat recovery are canonical | DUI-15 |
| AD4 | Bind and place real onboarding reset consistently | NOT_STARTED | production reset exists; prototype button is no-op | DUI-15 |
| AD5 | Use real outbound channels and remove Email/Matrix/core-messaging rows | NOT_STARTED | `ChannelsSettings.tsx`; prototype mixes fictional channels | DUI-15 |
| AD6 | Bind applet settings to real install/enable/disable state | NOT_STARTED | runtime exists; settings prototype uses six mock cards | DUI-15 |
| AD7 | Delete fabricated user statistics section | PARTIAL | production legacy API is absent; prototype still renders hardcoded heatmap/ranks | DUI-15 |
| AD8 | Bind live logs/filter/follow/export | NOT_STARTED | production logs API exists; prototype uses fixed rows | DUI-15 |
| AD9 | Bind real cron builder/run/history and remove fake backup target | NOT_STARTED | production scheduler exists; prototype rows are static | DUI-15 |
| AD10 | Bind real command palette entry | NOT_STARTED | production palette exists; prototype button is isolated | DUI-15 |
| AD11 | Render actual version/build/platform/runtime metadata | IMPLEMENTED/UNPROVEN | `AboutSettings.tsx`; help catalog is still empty/unproven | DUI-15 |

## Network and federation

| ID | Required outcome | Source state | Current evidence | Task |
|---|---|---|---|---|
| N1 | Persist global hidden/by-handle/indexed discoverability | IMPLEMENTED/UNPROVEN | `actor.proto`, `store/federation.ts`, `FederationTab.tsx` | DUI-16 |
| N2 | Persist per-federation visibility with privacy-safe master hide | IMPLEMENTED/UNPROVEN | federation visibility proto/map/table/profile update path | DUI-16 |
| N3 | Enforce inbound contact policy at receiver | IMPLEMENTED/UNPROVEN | `contact_policy` replaced legacy `message_permission`; Social enforcement added | DUI-16 |
| N4 | Fan out indexed catalog search across Federation members | IMPLEMENTED/UNPROVEN | `federation/catalog.go`, peer route, trie-like local index and tests | DUI-16 |
| N5 | Complete operator serve switch, limits, timeout, and metrics UI | PARTIAL | backend env switch/rate/fanout timeout exists; Dashboard control/metrics absent | DUI-16 |
| N6 | Enable Desktop join/leave/roster/role/counts | PARTIAL | Settings remains read-only with disabled join/leave | DUI-17 |
| N7 | Route non-sequencer leave through authenticated sequencer proposal | IMPLEMENTED/UNPROVEN | governance handler and `TestMemberLeaveUsesSequencerProposalAndConvergesLocally` | DUI-17 |
| N8 | Complete authorized-device revoke in Your Station | PARTIAL | same source gap as C16 | DUI-17 |
| N9 | Complete Station switch logout/unbind/remove/reselect | PARTIAL | same source gap as C17 | DUI-17 |
| N10 | Project degraded/lagging/fork health to operator surface | PARTIAL | backend has healthy/fork cursor; rich Dashboard projection absent | DUI-17 |
| N11 | Populate authoritative visible/member/peer counts | PARTIAL | proto fields exist; end-to-end population/readback remains incomplete | DUI-17 |
| N12 | Bind Station/federation health without fabricated tiles | PARTIAL | binding projection exists; health is not fully rendered/proven | DUI-17 |

## Closure rules

1. Source implementation is not completion. Each row needs focused checks, the required functional journey, prototype truthfulness, and exact-source evidence.
2. `FICTION` from the historical register closes by removal unless an accepted product/architecture contract now owns the capability.
3. `CUT` closes only after production/prototype references and fabricated data are absent.
4. A shared implementation may close two IDs such as `C16/N8`, but both ledger rows need explicit evidence.
5. No row may move to closed from static source inspection alone.
6. Re-review every row at Task entry. If exact current evidence already proves
   the required outcome, do not manufacture a code delta; update proof and
   closure state only.
