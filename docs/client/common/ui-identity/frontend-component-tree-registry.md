# Frontend Component Tree Registry

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-07-01 | **Updated**: 2026-10-18
> **Owner**: Client Platform Team
> **Module**: `docs/client/common/ui-identity/`

---

## 1. Purpose

This registry records which frontend surfaces are alive, which are not alive, and which are intentionally lazy, cached, or virtualized.

It is the operational companion to `frontend-component-tree.md`.

Architecture source: `docs/architecture/platform/client/frontend-runtime/README.md` defines the upstream runtime lifecycle, budget, and evidence model. Registry rows should be interpretable as `RuntimeSurface` entries from `docs/architecture/platform/client/frontend-runtime/data-model.md`.

Use it to answer:

- Which primary modules stay mounted across tab switches?
- Which dynamic pages use bounded LRU caching?
- Which settings/provider sections mount only on intent?
- Which surfaces are explicitly non-alive?
- Which runtime/store owns freshness for each visible tree?
- Which rows need follow-up evidence before changing behavior?

## 2. Registry Model

Each row records one user-visible surface or section.

| Field | Meaning |
|-------|---------|
| Feature / Surface | Product-facing name of the page, section, or runtime surface |
| Platform | Desktop, Mobile, Web, Applet, or Cross-client. Platform-scoped section tables (§4–§7 Desktop, §8 Mobile, §9 Applet) inherit their platform from the section header and omit a per-row Platform column; add an explicit Platform value only for cross-client rows that do not live under a platform-scoped section. |
| Owner Layer | Canonical tree owner: Shell, Navigation, PageHost, PageFrame, PageBoundary, SectionBoundary/SectionHost, OverlayHost, AppletContainerShell, RuntimeProjection |
| Alive Category | Exactly one of the enum: `eager + forever`, `idle + forever`, `on-visit + lru`, `on-visit + none`, `lazy section`, or `virtualized content`. Add clarifying scope in parentheses (e.g. `virtualized content` inside alive page), but the leading token must be one enum value. |
| Trigger | When the tree mounts or becomes active |
| Cache Policy | Forever, LRU count, selected-only, none, or virtual window |
| Runtime / Store Owner | Projection that owns freshness |
| Status | `alive`, `lazy`, `lru`, `not alive`, `needs audit`, or `deprecated` |
| Evidence | Current proof or required verification |
| Review Owner | Team or module owner responsible for changes |

Budget fields are recorded inside `Evidence` until the registry grows explicit columns. A row that lacks runtime sampling must say `unproven`, `needs audit`, or list the exact missing proof instead of implying the surface is proven.

## 3. Alive Status Vocabulary

- `alive`: The tree intentionally remains mounted while inactive.
- `lazy`: The parent is alive, but this section mounts only on user intent.
- `lru`: Dynamic instances stay mounted within a bounded cache.
- `not alive`: The tree unmounts when inactive.
- `needs audit`: The implementation exists, but lifetime or hidden render cost is not yet proven.
- `deprecated`: The surface should not receive new lifetime investment.

## 4. Desktop Primary Module Registry

| Feature / Surface | Owner Layer | Alive Category | Trigger | Cache Policy | Runtime / Store Owner | Status | Evidence | Review Owner |
|-------------------|-------------|----------------|---------|--------------|------------------------|--------|----------|--------------|
| Search overlay | OverlayHost | `on-visit + none` | Search button or Cmd/Ctrl+K | Session memory: 32 frames / 640 items, maximum 200 visible results; native bounded read cache | Session-scoped `search` runtime/store, original Messaging and Social read authorities | not alive | `components/search/SearchHost.tsx` lazy mounts one overlay in the Shell slot. Source-bound query/resolve, scoped invalidation and original-domain openers retain query/scroll; identity clears them. Social result metadata reads existing identity projections without profile loading. Current Social native Acceptance and performance distribution remain unproven | Client Platform |
| Chat primary module | PageHost | `eager + forever` | Default ready landing | Forever | `social` identity projection + session-scoped `messaging` and `call` runtime projections | alive | `pages/SocialChatPage.descriptor.tsx` is the eager landing descriptor; PageHost owns lifetime. Virtualized timeline locates historical message anchors via index and rendered node | Chat / Client Platform |
| Agent primary module and Chat / Atelier work surfaces | PageHost / PageFrame | `idle + forever` | First idle slot or first visit per surface | Forever while Desktop Shell is alive | `agentCapability`, `agentTopic`, `social`, Atelier/orchestration stores | alive | `pages/AgentChatPage.descriptor.tsx` registered (`preload: idle`, `keepAlive: forever`, `runtime-projections.md §7`); Desktop Shell owns a fixed Chat / Atelier secondary selector and Atelier absorbs orchestration; hidden render cost still needs production sampling | Agent / Client Platform |
| Settings primary module | PageHost / SectionHost | `idle + forever` | First idle slot or first visit | Forever for page shell; SectionHost policy for sections | `settings`, `chat-storage`, `federation`, provider/model, package catalog, Memory, Channels, Cron, and OSS stores | alive | `pages/SettingsPage.descriptor.tsx` registered, PageHost-owned; `kernel/SectionHost.tsx` owns section mount/cache; Discover, Memory, My Files, Cron Jobs, Channels, and Command Palette have no primary-nav or standalone-page ownership | Client Platform |
| Moments / Social primary module | PageHost | `idle + forever` | First idle slot or first visit | Forever | `moments`, `social`, `messaging` runtime/store projections | alive | `pages/moments/MomentsApp.descriptor.tsx` declares all three audience-data owners; hidden feed selector/render cost not sampled (§12) | Social / Client Platform |

## 5. Desktop Dynamic Surface Registry

| Feature / Surface | Owner Layer | Alive Category | Trigger | Cache Policy | Runtime / Store Owner | Status | Evidence | Review Owner |
|-------------------|-------------|----------------|---------|--------------|------------------------|--------|----------|--------------|
| Hidden Applets launcher | PageHost | `idle + forever` | Internal runtime or Acceptance navigation | Forever for launcher shell | `applets` runtime/store projection | alive | `pages/AppletsPage.descriptor.tsx` remains registered for runtime handoff; `AppSideNav` and the Settings registry expose no launcher or dynamic applet injection API | Applet Platform |
| Applet runtime instance | PageHost / AppletContainerShell | `on-visit + lru` | Navigate to `applet:<id>` | LRU by applet id; standalone window uses window lease | `applets` runtime/store projection; applet host bridge | lru | PageHost dispatches page runtime lease events; `appletsRuntime.acquirePage/releasePage` owns materialize/load/unload; `applet/AppletContainerShell.tsx` owns contained/immersive/standalone shell chrome; runtime sample confirmed `hello-lynx` contained shell, immersive mode, floating controls hide/show/exit, route-to-visible ~122ms, page-acquire ~792ms | Applet Platform |
| Agent profile page | PageBoundary / PageFrame | `idle + forever` | First profile visit | Forever while Agent module is alive | Agent and `agent-capability` projections | alive | Production `AgentProfilePage.tsx` now keeps only Identity, SOUL/AGENTS, avatar and selected Skill/MCP bindings beside the persistent Agent rail; model/workspace/memory/activity/diagnostic/Builder controls are removed. Hidden-render cost still needs sampling | Agent |
| Atelier orchestration mode / canvas | PageBoundary / PageFrame | `idle + forever` | First Atelier orchestration visit | Forever while Atelier is alive | Agent canvas/orchestration stores | alive | Orchestration is an Atelier-owned mode, not a sibling navigation destination; production mount cost and memory sampling remain required | Agent |
| Agent creation | PageBoundary | `on-visit + none` | Explicit Create Agent intent | New Agent persists immediately and opens Profile | Agent store | not alive | Shared create flow submits one Station creation and immediately selects Profile; no separate runtime/model form mounts | Agent |
| Agent Chat artifacts | SectionBoundary | `on-visit + none` | Open a message artifact | Panel unmounts on close or Profile navigation | Chat message artifacts + Portal view projection | not alive | ConversationRail mounts the existing PortalPanel in artifacts-only mode; list/detail reuse current Topic messages and omit working tabs and developer views. Native list/detail and cleanup proof pending | Agent |
| Agent Chat roster prototype | PageFrame / SectionBoundary | `idle + forever` within Agent | Agent module first visit | Same roster tree in chat and Profile, including collapsed state | Prototype AgentChatPage roster state | alive | Creation/search slots, group spacing, rows and scroll container remain mounted; changing width hides only labels/actions. One persisted `initial / emoji / image` avatar value projects into roster and Profile; Topic rail deliberately keeps name only. Browser QA checks identity persistence and projection; production large-list performance remains unproven | Agent |
| Agent Chat Profile Builder prototype | PageContent | `on-visit + none` | Create Local or Agent Profile action | Selected Agent only; draft persists before leaving | Prototype Agent roster and localStorage profile/binding draft; Shell ToastHost owns save feedback | not alive | One selected `AgentProfile` mounts beside the persistent roster. Its measured reference grid uses a 64px left track and 12px gap: 36px Back and 64px unframed avatar share the left edge, avatar and 64px description share the top edge, and name/description share the content edge. Autosave feedback is transient shared LobeUI Toast at the Chat-standard bottom-right placement, so no status line changes row geometry. SOUL/AGENTS fill remaining height. QA covers exact geometry, success toast, absent inline status, avatar persistence, bounded pickers, deletion, and return; production persistence is outside this evidence | Agent |
| Agent Profile avatar picker prototype | OverlayHost | `on-visit + none` | Explicit Change Agent avatar action | None; upload preview is transient and committed avatar remains in Agent owner | Prototype Agent roster identity state | not alive | Anchored Emoji/Upload dialog mounts only while open. Emoji search filters a bounded 40-item directory; Upload validates PNG/JPEG/WebP/GIF and 2 MB before preview, Cancel preserves the committed value, Save writes one data URL projection, and close restores the avatar trigger. Browser QA covers validation, Cancel, Save, persistence, and roster/Profile projection | Agent |
| Agent Profile extension picker prototype | OverlayHost / SectionBoundary | `on-visit + none` | Explicit Add skill or Add MCP tool action | None; catalog search is transient and selected binding persists in Profile owner | Shared prototype Settings catalog + Agent profile binding state | not alive | Picker mounts only on intent, searches the Settings-owned catalog, renders 12 results at a time, traps focus, restores the Add trigger, and unmounts after select/close. A 100-skill browser scenario proves Profile still renders only its single selected binding | Agent |
| Agent Chat Topic rail prototype | PageContent / SectionBoundary | `idle + forever` within Agent Chat | Agent Chat becomes active | Same rail tree remains mounted while Desktop Chat is active; Profile does not mount it; ultra-narrow uses selected-only Topic list and transient left Agent drawer projections | Prototype AgentChatPage plus production Agent/Topic/Chat projections | alive | Production `AgentSidebar.tsx` now projects the selected Agent name, three equal actions, in-place title Search, and Pin/Rename/Delete only; `ChatPage.tsx` owns Topic title and virtualized current-conversation Search. Prototype `shell/qa/agent_chat_checks.cjs` binds 11 Journeys / 121 contracts; production ultra-narrow, batch deletion and hidden-render cost remain unproven | Agent |
| Agent Chat row menus and delete dialogs prototype | OverlayHost | `on-visit + none` | Explicit Agent/Topic row or batch action | None; mutation state remains in AgentChatPage | Prototype AgentChatPage roster/thread state | not alive | Agent menus expose only Profile and allowed Delete; Start/Profile/Search stay in equal Topic-rail slots. Agent/Topic menus portal from live trigger rectangles, dismiss on Escape/outside click/source movement/resize, and restore focus. Single and batch delete dialogs trap focus and default to Cancel; batch confirmation clears selected Topic drafts, attachments, active selection, and run ownership. QA covers every emitted mutation and mobile drawer anchoring | Agent |
| Find People discovery | OverlayHost | `on-visit + none` | Explicit Find People intent from Chat | None; scope and query reset on close | Federation context and relationship stores | not alive | `FindPeopleModal` uses `destroyOnHidden`; All and Station-provided Federation contexts are the only discovery scopes; the native OAuth Gate rejects member Station directory or selector exposure | Chat / Federation |
| Import/export flows | OverlayHost / PageBoundary | `on-visit + none` | Explicit user intent | None | Owning feature store | not alive | Must preserve draft or recovery externally if interrupted | Client Platform |
| Chat attachment detail, Desktop/Mobile | OverlayHost | `on-visit + none` | Select a file card | One PDF/Word/slide page or bounded workbook viewport; no hidden decoder tree after close; verified transfers stay Runtime-owned | Messaging Runtime `ChatAttachmentAccessController`, Engine protobuf projection and client-chat-core selected decoder disposal | not alive | Native macOS 14-format local-file preview, navigation, close/reopen and revocation checks pass; Office workers terminate and images use reduced representations. Sender/receiver transport, OS export, assistive technology, dark Native theme and platform performance remain UNPROVEN | Chat |
| Notifications preview / complete viewer prototype | OverlayHost | `on-visit + none` | Rail bell; More notifications expands into centered dialog | None; at most four preview rows or six current-page rows | Prototype Shell notification state; production projection unproven | not alive | `packages/prototypes/desktop/shell/src/Notifications.tsx` reuses one list; geometry gate covers live source alignment, search/page stability, shared mutations, teardown and focus return; production runtime and high-volume search sampling remain unproven | Client Platform |
| Command palette / transient search overlay | OverlayHost | `on-visit + none` or selected draft cache | Keyboard/command intent | None or explicit draft cache | Navigation/search projection; Agent palette consumes Station command snapshot | needs audit | Agent Commands & Skills unmounts on close, restores trigger focus and retains no hidden result tree; global result virtualization remains unproven | Client Platform / Agent |
| Desktop call surface | OverlayHost | `on-visit + none` | Incoming or outgoing one-to-one call | None; call snapshot remains in runtime owner | Session-scoped `call` runtime + `callP2p` | needs audit | `ReadyView` owns the global overlay, so incoming and active calls remain visible while Chat is hidden; native media and reconnect evidence remain required | Chat / Client Platform |

## 6. Settings And Provider Section Registry

| Feature / Surface | Owner Layer | Alive Category | Trigger | Cache Policy | Runtime / Store Owner | Status | Evidence | Review Owner |
|-------------------|-------------|----------------|---------|--------------|------------------------|--------|----------|--------------|
| Settings page shell | PageHost / PageBoundary / SectionHost | `idle + forever` | Idle prewarm or first settings visit | Forever shell; section policy delegated to `SectionHost` | `settings` runtime/store projection | alive | `SettingsPage.tsx` delegates section lifecycle to `kernel/SectionHost.tsx`; first-visit-cache preserves config drafts, selected-only unmounts diagnostics/read-only sections | Client Platform |
| Provider list | SectionHost / SectionBoundary | `lazy section` within alive Settings | Open provider settings area | First-visit cache to preserve config draft | Provider/model and settings projections | lazy | Production `ProviderMenu.tsx` uses one mixed Direct/CLI list; Add Provider chooses type in one transient dialog; persisted `Show usable only` filters by the shared readiness owner. Focused provider/settings tests pass; rendered production Journey remains required | Client Platform |
| Selected provider editor | SectionBoundary | `lazy section` | Select one provider | Selected-only; optional per-provider draft cache | Provider/model store projection | lazy | Production `ProviderDetail.tsx` branches immediately to one selected Direct schema or the dedicated `CliProviderDetail.tsx`; focused contract tests pass. Provider-switch mount behavior still needs runtime sampling | Client Platform |
| CLI provider configuration | SectionBoundary | `lazy section` | Select CLI provider | Selected-only; local draft until Save | Station Provider projection | needs audit | Production exposes capability-declared default model, startup args, environment and timeout; check/restore/save; read-only registered command/workspace/capabilities; and a read-only Station model catalog with capability-driven Refresh. API key/Base URL/model mutation are absent. Real adapter check/discovery and rendered recovery evidence remain required | Client Platform |
| Cloud/API provider configuration | SectionBoundary | `lazy section` | Select Direct provider | Selected-only; optional draft cache | Provider config projection | lazy | Production Direct branch owns API key, Base URL, connection check and models; CLI metadata is absent. Focused static contract passes; rendered failure/recovery evidence remains required | Client Platform |
| Model discovery panel | SectionBoundary / RuntimeProjection | `lazy section` | Explicit refresh/discover intent | Station runtime catalog snapshot | Provider/model runtime | needs audit | Desktop proxies discovery to Station; Station replaces the successful CLI catalog snapshot and Provider detail/runtime admission share it. AI / Models contains only the default selector, and all consumers use `(provider_id, model_id)`. Focused Station and Desktop collision tests pass; real TRAE discovery and disabled-provider Journey remain required | Client Platform |
| Discover package catalog | SectionHost / SectionBoundary | `on-visit + none` within alive Settings | Select AI > Discover | Selected-only; explicit sync invalidates the catalog snapshot | Desktop Rust verified package catalog plus Station target authorities | not alive | `modules/discover.ts` registers only a selected-only Settings panel; `components/settings/DiscoverSettings.tsx` owns source, package, detail, install, uninstall, and recovery states while visible; no standalone Marketplace descriptor remains | Agent / Client Platform |
| Memory management | SectionHost / SectionBoundary | `on-visit + none` within alive Settings | Select AI > Memory | Selected-only; leaving stops event polling and discards view-local filters | Station Memory APIs and Agent projection | not alive | `modules/memory.ts` registers only selected-only `MemorySettingsSection`; browse, search, persona, events, and configuration share one Settings owner; no standalone Memory route remains | Agent / Client Platform |
| Advanced settings panels | SectionBoundary | `lazy section` | Expand advanced section | Selected section only | Owning settings store | needs audit | Target: defer heavy validation and schema compilation until the panel is visible — not yet verified | Client Platform |
| Chat storage overview | SectionHost / SectionBoundary | `lazy section` | Select Storage in Settings | Selected-only; snapshot remains in runtime projection | Session-scoped `chat-storage` runtime over Device Messaging Engine | alive | Scope-fenced runtime tests cover Station/actor/device/generation changes; native scan timing remains part of `chat-storage-accounting-e2e` | Chat / Client Platform |
| My Files | SectionHost / SectionBoundary | `on-visit + none` | Select Data > My Files | Selected-only | OSS list and mutation requests | not alive | `modules/oss.ts` registers only `settingsPanel` with `selected-only`; leaving the section unmounts filters and drawers | Client Platform |
| Cron Jobs | SectionHost / SectionBoundary | `on-visit + none` | Select Tools > Cron Jobs | Selected-only | Cron list and polling requests | not alive | `modules/cron.ts` registers only `settingsPanel` with `selected-only`; unmount owns polling cleanup | Client Platform |
| Channels | SectionHost / SectionBoundary | `on-visit + none` | Select Channels > Channels | Selected-only | Channel list and mutation requests | not alive | `modules/channels.ts` registers the full management surface only in Settings; the reduced overview panel is deleted | Client Platform |
| Command Palette settings action | SectionHost / OverlayHost | `on-visit + none` | Select Tools > Command Palette or press `Cmd/Ctrl+Shift+K` | Selected-only section; transient overlay | Global `commandMenu` store | not alive | Settings invokes the canonical `CommandMenu`; Cmd/Ctrl+K belongs only to Search | Client Platform |

## 7. Large Content Registry

| Feature / Surface | Owner Layer | Alive Category | Trigger | Cache Policy | Runtime / Store Owner | Status | Evidence | Review Owner |
|-------------------|-------------|----------------|---------|--------------|------------------------|--------|----------|--------------|
| Chat message list | SectionBoundary | `virtualized content` inside alive page | Chat page active or prewarmed | Virtual window + scroll restoration | Session-scoped `messaging` runtime/store projection | needs audit | Large conversations must not render all messages | Chat |
| Moments feed | SectionBoundary | `virtualized content` inside alive page | Moments page active or prewarmed | Virtual window or incremental list | `moments` runtime/store projection | needs audit | Feed hidden render cost must be checked when adding cards/actions | Social |
| Contacts / roster list | SectionBoundary | `virtualized content` if large | Chat/Agent page active | Virtual window or filtered selector | `social`, agent projections | needs audit | Search/filter derivation should be selector-backed | Chat / Agent |
| Logs, diagnostics, or debug output | SectionHost / SectionBoundary | `on-visit + none` or `virtualized content` | Explicit diagnostic intent | Selected-only unless virtualized | Owning diagnostic store | needs audit | `logs` settings module declares `sectionHostPolicy: selected-only`; runtime sample confirmed `logs` unmounts when switching back to `statistics`; high-volume log virtualization remains a separate audit | Client Platform |

## 8. Web Operator Surface Registry

| Feature / Surface | Owner Layer | Alive Category | Trigger | Cache Policy | Runtime / Store Owner | Status | Evidence | Review Owner |
|-------------------|-------------|----------------|---------|--------------|------------------------|--------|----------|--------------|
| Station Dashboard Relay Attachments | Navigation / PageBoundary | `on-visit + none` | Select Relay Attachments | None; page-local polling is torn down on navigation | Station `AttachmentController` projection | not alive | Hash route changes synchronously; only the active page mounts; 3-second projection polling is page-local and cancelled on unmount; browser long-task and narrow-layout evidence pending | Node Connectivity / Station |

## 9. Mobile Surface Registry

Mobile does not use the Desktop `PageHost` keep-alive model.
`MobileNavigationStore` owns the descriptor-backed primary route and detail
stack, while `MobileShell.tsx` renders only the active tab tree. Projection
freshness is owned by the Mobile runtime registry and feature stores, which
keep store truth fresh while a tab tree is unmounted. See
`frontend-component-tree.md §14` for the Mobile platform tree standard.

| Feature / Surface | Owner Layer | Alive Category | Trigger | Cache Policy | Runtime / Store Owner | Status | Evidence | Review Owner |
|-------------------|-------------|----------------|---------|--------------|------------------------|--------|----------|--------------|
| Mobile primary tab shell | NavigationShell | `on-visit + none` per tab | App ready; tab selected | None — only active tab mounted | Mobile runtime registry projections | needs audit | `MobileNavigationStore` owns the primary descriptor and `MobileShell.tsx` renders only that active tab; native remount cost still needs sampling | Mobile |
| Mobile chat tab | PageBoundary | `on-visit + none` within active chat tab | Open chat tab | None; draft/scroll recovery externalized | `socialRuntime` + session-scoped `messaging` projection | needs audit | Descriptor-owned Direct/Group detail routes control visibility; one Social store projects both conversation kinds from Messaging; native remount and draft/scroll restoration evidence still needs collection | Mobile / Chat |
| Mobile Search detail | NavigationShell / PageBoundary | `on-visit + none` | Shell header action or scoped conversation search | One 100-item presentation page, 32 page cursors; native content cache | `search` runtime descriptor + original Messaging and Social authorities | needs audit | Shell lazy-loads `SearchPage`; one bounded result list, source-bound message/thread/post/comment openers and Settings descriptors. Social comments show readable parent context. Current Social native Android/iOS, keyboard/focus and performance evidence remain unproven | Mobile / Search |
| Mobile Moments tab/feed | PageBoundary / SectionBoundary | `on-visit + none` + `virtualized content` | Open Moments tab | Virtual window; 10 comments per item by default; one overflow group/composer selected; draft externalized | `MobileSocialFacade` + public/private runtime projections | alive | `mobile-social-thread-media-native` proves one lazy selected thread, one selected composer, default 10-comment window, and runtime-owned private cursor/error state; native virtualization, safe-area, and cross-Station convergence remain acceptance work | Mobile / Social |
| Mobile Social detail routes | NavigationShell / PageBoundary | `on-visit + none` | Open Profile, Search, Circles, Circle member picker or exception Moment Detail | None; route presentation memory only | Mobile navigation store + `MobileSocialFacade` projection | needs audit | Ordinary Moment interaction creates no route; true routes are descriptor-owned and selected-only; production Native focus/scroll/no-leak evidence remains required | Mobile / Social |
| Mobile Social composer and transient surfaces | OverlayHost / PageBoundary | `on-visit + none` | Compose, Audience, Reaction, media preview, Circle edit, sort or danger confirmation intent | Selected-only; encrypted draft externalized; Feed anchor retained | `MobileSocialFacade` + Rust draft/command owners | alive | `mobile-social-thread-media-native` proves route-free selected-only media, public Blob revocation, private `MEDIA_READY` materialization, and source-focus restoration; native keyboard, safe-area, decoder, and exact visual evidence remain acceptance work | Mobile / Social |
| Mobile Contacts tab/roster | PageBoundary / SectionBoundary | `on-visit + none` + `virtualized content` | Open Contacts tab | Virtual window; search state optional local cache | `socialRuntime` + session-scoped `messaging` projection | needs audit | Contact and Group creation use one selected-only overlay; large-roster, federation-unavailable and request-action recovery evidence remains required | Mobile / Chat |
| Mobile Me/settings shell | PageBoundary / SectionHost | `on-visit + none` with `lazy section` details | Open Me tab / select setting | Selected-only; explicit form draft cache | `profileRuntime`, `settingsRuntime`, `deviceSettingsRuntime`, `chat-storage` runtime | needs audit | Storage measurement remains runtime-owned across Settings remounts and is fenced by Station/actor/device/generation; native remount evidence remains required | Mobile |
| Mobile descriptor detail routes | NavigationShell / PageBoundary | `on-visit + none` | Open conversation/contact/group/moment/setting | None; owner restores scroll/focus/draft | Mobile navigation store + owning feature runtime projection | needs audit | Chat/Group route identity, back, tab-bar visibility, scroll/focus restoration, and one route-local unavailable/Retry state are descriptor-owned in source; needs contact/moment/setting route and native no-leak evidence | Mobile |
| Mobile OAuth/access recovery | PageBoundary / OverlayHost | `on-visit + none` | Station gate requests credentials | None; attempt state in `authRuntime` | `authRuntime`, `accessRuntime` | needs audit | Prototype covers provider progress; target must add cancel, expiry, replay/mismatch, following-gate, Station identity mismatch and focus restoration evidence | Mobile / Auth |
| Mobile blocking recovery surfaces | OverlayHost | `on-visit + none` per visible recovery surface | Recovery projection reports a cross-route action or blocking state | None; app-level host retains only its projection subscription | `recoveryProjection` plus lifecycle/auth/command action owners | needs audit | The app-level host mounts only actionable cross-route children and delegates Station/session actions to lifecycle/auth owners; passive overflow reconciliation and route-owned runtime failures do not become global cards; W4 command/draft actions, native focus restoration, and runtime screenshots remain unproven | Mobile |
| Mobile call surface | OverlayHost | `on-visit + none` | Incoming or outgoing one-to-one call | None; call snapshot remains in runtime owner | `mobileCallManager` fed by `socialRuntime` realtime ingress | needs audit | Shell-level overlay survives Chat page unmount; encrypted signaling, durable resolution readback, media cleanup, narrow-screen bounds, and native camera/microphone behavior require final runtime evidence | Mobile / Chat |
| Mobile conversation action sheet | OverlayHost | `on-visit + none` | Tap conversation actions | None | Chat action state | not alive | `ChatActionSheet` returns `null` when `!open`; bottom action sheet, not a right drawer (`ChatPage.tsx`) | Mobile / Chat |
| Mobile tabbar | NavigationShell | `idle + forever` while in tab mode | App ready | Forever while shown | Mobile navigation descriptor + Messaging/Social unread projection | alive | `MobileShell.tsx` renders `<nav className="mobile-tabbar">`; visibility is derived from the active detail descriptor, not feature-store selection | Mobile |

## 10. Applet Registry

| Feature / Surface | Owner Layer | Alive Category | Trigger | Cache Policy | Runtime / Store Owner | Status | Evidence | Review Owner |
|-------------------|-------------|----------------|---------|--------------|------------------------|--------|----------|--------------|
| Official Note applet | Applet runtime instance | `on-visit + lru` (inherits applet runtime) | Open Note applet | Applet runtime LRU | Note applet service + applet host bridge | lru | Note UI must stay applet-local; Desktop host owns runtime shell only | Applet Platform |
| Third-party applets | Applet runtime instance | `on-visit + lru` by default | Open applet | Applet runtime LRU | Applet manifest/runtime projection | lru | Each applet must not request global forever lifetime without product approval | Applet Platform |
| Applet launcher cards | SectionBoundary | `lazy section` inside alive Applets launcher | Applets page mount/prewarm | Launcher list projection | `applets` runtime/store projection | alive | Cards should not materialize applet bundle on render | Applet Platform |

## 11. Change Process

Update this registry when any of these changes happen:

- A new primary module, page, applet host, provider editor, overlay, or large content surface is introduced.
- A surface changes alive category.
- A cache bound changes.
- A runtime/store owner changes.
- A previously `needs audit` surface receives evidence.
- A heavy section is moved from eager render to lazy section or virtualization.

Required update fields:

- Adjust alive category and status.
- Add evidence or required evidence.
- Add owner and revisit condition for exceptions.
- Update `Updated` date at the top of this file.

## 12. Review Gates

Before approving a UI change covered by this registry:

- [ ] The touched feature row exists.
- [ ] The alive category matches implementation.
- [ ] Hidden alive trees have selector/render invalidation protection.
- [ ] Lazy sections mount only on intent.
- [ ] LRU surfaces have a bounded cache size.
- [ ] Non-alive surfaces preserve user task recovery where needed.
- [ ] Evidence is current enough for the change risk.

## 13. Open Audits

These rows are intentionally marked `needs audit` until measured or redesigned:

| Surface | Audit Needed | Suggested Evidence |
|---------|--------------|--------------------|
| Moments / Social hidden tree | Hidden render cost after feed updates | Browser long-task sampling during tab switch and feed reconcile |
| Chat message list | Large conversation rendering and scroll restoration | Virtualization proof, route return proof, long-task sample |
| Agent canvas/orchestration | Mount cost and state persistence policy | First-visit timing, memory/cache reasoning, state recovery proof |
| Mobile chat tab tree | Re-mount cost when switching tabs or returning from a thread | Mobile long-task sampling on tab switch and thread back; confirm store keeps freshness without re-fetch |
| Command palette / transient search overlay | Hidden result tree policy | Confirm unmount or virtualized cache |

## 14. Related Documents

- `docs/client/common/ui-identity/frontend-component-tree.md`
- `docs/client/common/ui-identity/README.md`
- `docs/client/common/ui-identity/review-checklist.md`
- `docs/client/desktop/runtime-projections.md`
- `docs/client/mobile/chat-layout-contract.md`
- `docs/client/chat/chat-ux-contract.md`
