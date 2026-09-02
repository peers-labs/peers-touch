# Frontend Component Tree Registry

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-07-01 | **Updated**: 2026-08-27
> **Owner**: Client Platform Team
> **Module**: `docs/client/common/ui-identity/`

---

## 1. Purpose

This registry records which frontend surfaces are alive, which are not alive, and which are intentionally lazy, cached, or virtualized.

It is the operational companion to `frontend-component-tree.md`.

Architecture source: `docs/architecture/frontend-runtime/README.md` defines the upstream runtime lifecycle, budget, and evidence model. Registry rows should be interpretable as `RuntimeSurface` entries from `docs/architecture/frontend-runtime/data-model.md`.

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
| Search primary module | PageHost | `eager + forever` | Ready shell mount | Forever | `search` runtime/store projection | alive | `pages/SearchPage.descriptor.tsx` registered, PageHost-owned (`runtime-projections.md §7`); hidden re-render cost not sampled | Client Platform |
| Chat primary module | PageHost | `idle + forever` | First idle slot or first visit | Forever | `social` runtime/store projection | alive | `pages/SocialChatPage.descriptor.tsx` registered, PageHost-owned (`runtime-projections.md §7`); message-list virtualization not yet proven | Chat / Client Platform |
| Agent primary module and sibling surfaces | PageHost / PageFrame | `idle + forever` | First idle slot or first visit per surface | Forever while Desktop Shell is alive | `agentCapability`, `agentTopic`, `social`, orchestration stores | alive | `pages/AgentChatPage.descriptor.tsx` registered (`preload: idle`, `keepAlive: forever`, `runtime-projections.md §7`); prototype Shell uses first-visit fixed frames for Agent / Atelier / Orchestration and preserves drafts, inner tabs, and panel state across switches; hidden render cost still needs production sampling | Agent / Client Platform |
| Settings primary module | PageHost / SectionHost | `idle + forever` | First idle slot or first visit | Forever for page shell; SectionHost policy for sections | `settings`, `federation`, provider/model stores | alive | `pages/SettingsPage.descriptor.tsx` registered, PageHost-owned; `kernel/SectionHost.tsx` owns section mount/cache; runtime sample recorded `settings:group:ai` route-to-visible ~189ms and `settings:section:logs/statistics` route-to-visible ~151–153ms | Client Platform |
| Applets launcher | PageHost | `idle + forever` | First idle slot or first visit | Forever for launcher shell | `applets` runtime/store projection | alive | `pages/AppletsPage.descriptor.tsx` registered; applet runtime materializes only after navigating to `applet:<id>` (§5) | Applet Platform |
| Moments / Social primary module | PageHost | `idle + forever` | First idle slot or first visit | Forever | `moments`, `social` runtime/store projection | alive | `pages/moments/MomentsApp.descriptor.tsx` registered; hidden feed selector/render cost not sampled (§12) | Social / Client Platform |

## 5. Desktop Dynamic Surface Registry

| Feature / Surface | Owner Layer | Alive Category | Trigger | Cache Policy | Runtime / Store Owner | Status | Evidence | Review Owner |
|-------------------|-------------|----------------|---------|--------------|------------------------|--------|----------|--------------|
| Applet runtime instance | PageHost / AppletContainerShell | `on-visit + lru` | Navigate to `applet:<id>` | LRU by applet id; standalone window uses window lease | `applets` runtime/store projection; applet host bridge | lru | PageHost dispatches page runtime lease events; `appletsRuntime.acquirePage/releasePage` owns materialize/load/unload; `applet/AppletContainerShell.tsx` owns contained/immersive/standalone shell chrome; runtime sample confirmed `hello-lynx` contained shell, immersive mode, floating controls hide/show/exit, route-to-visible ~122ms, page-acquire ~792ms | Applet Platform |
| Agent profile page | PageBoundary / PageFrame | `idle + forever` | First profile visit | Forever while Agent module is alive | Agent/social projections | alive | Prototype Shell preserves the visited profile frame; production hidden-render cost still needs sampling | Agent |
| Agent orchestration/canvas | PageBoundary / PageFrame | `idle + forever` | First orchestration visit | Forever while Agent module is alive | Agent canvas/orchestration stores | alive | Prototype L3 verifies prompt and panel state recovery across Agent / Atelier / Orchestration switches; production mount cost and memory sampling remain required | Agent |
| Import/export flows | OverlayHost / PageBoundary | `on-visit + none` | Explicit user intent | None | Owning feature store | not alive | Must preserve draft or recovery externally if interrupted | Client Platform |
| Command palette / transient search overlay | OverlayHost | `on-visit + none` or selected draft cache | Keyboard/command intent | None or explicit draft cache | Navigation/search projection | needs audit | Needs audit before alive promotion: do not keep hidden full result trees alive without virtualization | Client Platform |

## 6. Settings And Provider Section Registry

| Feature / Surface | Owner Layer | Alive Category | Trigger | Cache Policy | Runtime / Store Owner | Status | Evidence | Review Owner |
|-------------------|-------------|----------------|---------|--------------|------------------------|--------|----------|--------------|
| Settings page shell | PageHost / PageBoundary / SectionHost | `idle + forever` | Idle prewarm or first settings visit | Forever shell; section policy delegated to `SectionHost` | `settings` runtime/store projection | alive | `SettingsPage.tsx` delegates section lifecycle to `kernel/SectionHost.tsx`; first-visit-cache preserves config drafts, selected-only unmounts diagnostics/read-only sections | Client Platform |
| Provider list | SectionHost / SectionBoundary | `lazy section` within alive Settings | Open provider settings area | First-visit cache to preserve config draft | Provider/model store projection | needs audit | List renders inside the `providers` section through `SectionHost`; provider/model discovery behavior still needs separate audit before promoting selected provider editor rows | Client Platform |
| Selected provider editor | SectionBoundary | `lazy section` | Select one provider | Selected-only; optional per-provider draft cache | Provider/model store projection | needs audit | `ProviderDetail.tsx` is a Tabs + Form panel; verify only the selected provider schema mounts and prior selections do not stay mounted | Client Platform |
| CLI provider configuration | SectionBoundary | `lazy section` | Select CLI provider | Selected-only; optional draft cache | CLI provider config projection | needs audit | Target: render command, binary path, working directory, env, model, args, timeout, capabilities only for CLI providers — not yet implemented as a dedicated lazy schema | Client Platform |
| Cloud/API provider configuration | SectionBoundary | `lazy section` | Select cloud/API provider | Selected-only; optional draft cache | Provider config projection | needs audit | Target: cloud/API form must not inherit CLI-only fields; current `ProviderDetail.tsx` uses one generic editor — needs split/audit | Client Platform |
| Model discovery panel | SectionBoundary / RuntimeProjection | `lazy section` | Explicit refresh/discover intent or background projection | Request-scoped cache | Provider/model runtime | needs audit | Needs audit: verify `fetchRemoteModels` only runs on explicit intent and not on Settings/provider mount before claiming `lazy` | Client Platform |
| Advanced settings panels | SectionBoundary | `lazy section` | Expand advanced section | Selected section only | Owning settings store | needs audit | Target: defer heavy validation and schema compilation until the panel is visible — not yet verified | Client Platform |

## 7. Large Content Registry

| Feature / Surface | Owner Layer | Alive Category | Trigger | Cache Policy | Runtime / Store Owner | Status | Evidence | Review Owner |
|-------------------|-------------|----------------|---------|--------------|------------------------|--------|----------|--------------|
| Chat message list | SectionBoundary | `virtualized content` inside alive page | Chat page active or prewarmed | Virtual window + scroll restoration | `social` runtime/store projection | needs audit | Large conversations must not render all messages | Chat |
| Moments feed | SectionBoundary | `virtualized content` inside alive page | Moments page active or prewarmed | Virtual window or incremental list | `moments` runtime/store projection | needs audit | Feed hidden render cost must be checked when adding cards/actions | Social |
| Contacts / roster list | SectionBoundary | `virtualized content` if large | Chat/Agent page active | Virtual window or filtered selector | `social`, agent projections | needs audit | Search/filter derivation should be selector-backed | Chat / Agent |
| Logs, diagnostics, or debug output | SectionHost / SectionBoundary | `on-visit + none` or `virtualized content` | Explicit diagnostic intent | Selected-only unless virtualized | Owning diagnostic store | needs audit | `logs` settings module declares `sectionHostPolicy: selected-only`; runtime sample confirmed `logs` unmounts when switching back to `statistics`; high-volume log virtualization remains a separate audit | Client Platform |

## 8. Mobile Surface Registry

Mobile does not use the Desktop `PageHost` keep-alive model. `MobileShell.tsx` drives the four primary tabs with `useState<TabId>` and a `renderPage` switch, so only the active tab tree is mounted. Projection freshness is owned by feature runtimes (`useSocialRuntime`, `social`/`group` stores), which keep store truth fresh even while a tab's page tree is unmounted. See `frontend-component-tree.md §14` for the Mobile platform tree standard.

| Feature / Surface | Owner Layer | Alive Category | Trigger | Cache Policy | Runtime / Store Owner | Status | Evidence | Review Owner |
|-------------------|-------------|----------------|---------|--------------|------------------------|--------|----------|--------------|
| Mobile primary tab shell | NavigationShell | `on-visit + none` per tab | App ready; tab selected | None — only active tab mounted | Mobile runtime registry projections | needs audit | Audit must verify the `architecture/mobile/module-layout.md` descriptor host with native remount evidence; current `MobileShell.tsx` uses `useState<TabId>` + `renderPage` | Mobile |
| Mobile chat tab | PageBoundary | `on-visit + none` within active chat tab | Open chat tab | None; draft/scroll recovery externalized | `socialRuntime`, `groupRuntime` projections | needs audit | Current list↔thread identity is store-driven; target descriptor-owned detail route must delete that routing responsibility while preserving draft/scroll state | Mobile / Chat |
| Mobile Moments tab/feed | PageBoundary / SectionBoundary | `on-visit + none` + `virtualized content` | Open Moments tab | Virtual window; composer draft externalized | `momentsRuntime` projection | needs audit | Target feed/detail/composer states require native virtualization, draft recovery, audience/trust, empty/error and rollback evidence | Mobile / Social |
| Mobile Contacts tab/roster | PageBoundary / SectionBoundary | `on-visit + none` + `virtualized content` | Open Contacts tab | Virtual window; search state optional local cache | `socialRuntime`, `groupRuntime` projections | needs audit | Target request/contact/group surfaces require large-roster, federation-unavailable and request-action recovery evidence | Mobile / Chat |
| Mobile Me/settings shell | PageBoundary / SectionHost | `on-visit + none` with `lazy section` details | Open Me tab / select setting | Selected-only; explicit form draft cache | `profileRuntime`, `settingsRuntime`, `deviceSettingsRuntime` | needs audit | Audit must verify that only the selected settings detail mounts, including account/device ownership, unsaved draft, permission and destructive-action recovery evidence | Mobile |
| Mobile descriptor detail routes | NavigationShell / PageBoundary | `on-visit + none` | Open conversation/contact/group/moment/setting | None; owner restores scroll/focus/draft | Owning feature runtime projection | needs audit | Target replaces `activeSessionUlid`/`activeGroupUlid` as route identity; each descriptor must prove back, deep link, tab-bar visibility and no leaked mounted detail | Mobile |
| Mobile OAuth/access recovery | PageBoundary / OverlayHost | `on-visit + none` | Station gate requests credentials | None; attempt state in `authRuntime` | `authRuntime`, `accessRuntime` | needs audit | Prototype covers provider progress; target must add cancel, expiry, replay/mismatch, following-gate, Station identity mismatch and focus restoration evidence | Mobile / Auth |
| Mobile conversation action sheet | OverlayHost | `on-visit + none` | Tap conversation actions | None | Chat action state | not alive | `ChatActionSheet` returns `null` when `!open`; bottom action sheet, not a right drawer (`ChatPage.tsx`) | Mobile / Chat |
| Mobile tabbar | NavigationShell | `idle + forever` while in tab mode | App ready | Forever while shown | Social/group unread projection | alive | `MobileShell.tsx` renders `<nav className="mobile-tabbar">`; hidden when `activeTab === 'chat' && (activeSessionUlid \|\| activeGroupUlid)` to give the thread full height | Mobile |

## 9. Applet Registry

| Feature / Surface | Owner Layer | Alive Category | Trigger | Cache Policy | Runtime / Store Owner | Status | Evidence | Review Owner |
|-------------------|-------------|----------------|---------|--------------|------------------------|--------|----------|--------------|
| Official Note applet | Applet runtime instance | `on-visit + lru` (inherits applet runtime) | Open Note applet | Applet runtime LRU | Note applet service + applet host bridge | lru | Note UI must stay applet-local; Desktop host owns runtime shell only | Applet Platform |
| Third-party applets | Applet runtime instance | `on-visit + lru` by default | Open applet | Applet runtime LRU | Applet manifest/runtime projection | lru | Each applet must not request global forever lifetime without product approval | Applet Platform |
| Applet launcher cards | SectionBoundary | `lazy section` inside alive Applets launcher | Applets page mount/prewarm | Launcher list projection | `applets` runtime/store projection | alive | Cards should not materialize applet bundle on render | Applet Platform |

## 10. Change Process

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

## 11. Review Gates

Before approving a UI change covered by this registry:

- [ ] The touched feature row exists.
- [ ] The alive category matches implementation.
- [ ] Hidden alive trees have selector/render invalidation protection.
- [ ] Lazy sections mount only on intent.
- [ ] LRU surfaces have a bounded cache size.
- [ ] Non-alive surfaces preserve user task recovery where needed.
- [ ] Evidence is current enough for the change risk.

## 12. Open Audits

These rows are intentionally marked `needs audit` until measured or redesigned:

| Surface | Audit Needed | Suggested Evidence |
|---------|--------------|--------------------|
| Moments / Social hidden tree | Hidden render cost after feed updates | Browser long-task sampling during tab switch and feed reconcile |
| Chat message list | Large conversation rendering and scroll restoration | Virtualization proof, route return proof, long-task sample |
| Agent canvas/orchestration | Mount cost and state persistence policy | First-visit timing, memory/cache reasoning, state recovery proof |
| Mobile chat tab tree | Re-mount cost when switching tabs or returning from a thread | Mobile long-task sampling on tab switch and thread back; confirm store keeps freshness without re-fetch |
| Command palette / transient search overlay | Hidden result tree policy | Confirm unmount or virtualized cache |

## 13. Related Documents

- `docs/client/common/ui-identity/frontend-component-tree.md`
- `docs/client/common/ui-identity/README.md`
- `docs/client/common/ui-identity/review-checklist.md`
- `docs/client/desktop/runtime-projections.md`
- `docs/client/mobile/chat-layout-contract.md`
- `docs/client/chat/chat-ux-contract.md`
