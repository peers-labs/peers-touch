# Mobile Prototype — UI Identity Compliance Audit

> Status: drafting (fail-closed — no real apps/mobile runtime acceptance yet).
> Goal: 6a4df61d05af3c5c0b257608. This is the audit-before-change gate (Task 3). No code changed while producing it.
> Rule of engagement: every violation below cites (a) the UI Identity / methodology clause it breaks, and (b) the prototype source anchor. Fixes land at the contract/token/component layer in Task 4 — never as symptom-point CSS.

## Authorities (Plan Source)

- Visual authority: `docs/client/common/ui-identity/{README,foundations,tokens,layout,components,interaction,accessibility}.md`, `modules/{auth,social}/README.md`, `patterns/{trust-state,composer,feed}.md`.
- Methodology: `docs/client/common/ux-design-methodology.md` (8 boundary classes + Case Library 001–005 + conflict order).
- Knowledge gate: `docs/knowledge/invariants/client-ui-identity-before-edit.md` (`owns:` covers `packages/prototypes/`, `apps/mobile/src/`).
- Source-of-truth (IA / class names / interaction, **NOT visual authority**): `apps/mobile/src/**`, esp. `styles.css` (2442 lines), `pages/{ChatPage,ContactsPage,MomentsPage,SettingsPage}.tsx`, `App.tsx`, `components/MobileShell.tsx`, `StationLaunchScreen.tsx`, `AccessGateHost.tsx`, `StationSelector.tsx`.
- Prototype under audit: `packages/prototypes/mobile/chat/src/MobilePrototype.tsx` (1373 lines) + `mobilePrototype.css` (2215 lines).

## Six-bounds vocabulary used

layout.md §2 layout zones (Shell / Page canvas / Content rail / Action rail / Trust rail / Floating layer / Recovery layer). Where useful, cross-referenced to ux-design-methodology §2.2 boundary classes (Content / Interaction / Floating / Focus / Error / Safe-area & occlusion / Data & loading / Accessibility).

## Cross-cutting violations (apply to every screen — fix once, at contract layer)

| # | Violation | Contract clause | Prototype anchor |
|---|-----------|-----------------|------------------|
| X1 | **CTA uses `linear-gradient(135deg, primary, secondary)`** — a blue→purple gradient CTA. This copies the app's own violation, not the contract. | foundations §2 "Avoid decorative gradients"; §3 disciplined single-accent, "Avoid mixed blue/purple/red/black CTAs"; tokens `action.primary` = one dominant accent | `mobilePrototype.css:375` (and app source `apps/mobile/src/styles.css:177` — a source violation we must NOT replicate) |
| X2 | **Three stacked "patch passes"** (`/* Visual fidelity pass */` @1512, `/* Launch/Auth parity pass */` @1640, `/* Compression repair */` @1992) mutually override each other; `Compression repair` turns root into `flex + width:max-content + overflow-x:auto` and folds source-panel to `max-height:96px`. This is exactly the symptom-patching the goal forbids. | Goal methodology "结构性修复…不在症状点堆 CSS 补丁"; foundations §4 "先重设边界模型" | `mobilePrototype.css:1512, 1640, 1992` |
| X3 | **Raw values everywhere** — raw `rgba()/px`, private `--brand-*` vars, radius scattered across many ad-hoc values; no mapping to token roles. | tokens.md §9 AI checklist "raw color/radius/spacing must be backed by a token role"; prototype-design skill "Token role 先于 raw CSS" | `mobilePrototype.css` throughout; `--brand-primary/secondary/surface/muted/border` |
| X4 | **Invented sample data**, not a source-faithful projection: conversations "Group: Mobile Closure"/"Sarah Jenkins"/"Station Ops"; messages are code-implementation descriptions ("Mobile thread is selected through activeSessionUlid…") not product copy. | social/README.md "Human content is the top layer"; source-backed (goal) | `MobilePrototype.tsx:58-98` |
| X5 | **`.prototype-*` custom class family** (logo/tag/input/avatar/badge/switch/modal…) sits outside the real class-name system and the token model. | prototype-design skill "复用项目已有… 归一到 token"; knowledge invariant (must reuse real IA class names) | `MobilePrototype.tsx` pervasive; `mobilePrototype.css` |
| X6 | **Debug controls mixed into the review surface** — launch-state buttons, `.prototype-inline-controls` (empty/populated, show/hide error). A review-grade prototype must not expose scaffolding chrome inside the device frame / next to content. | ux-design-methodology §2.5 "Task success over visual neatness" + review-grade requirement (goal) | `MobilePrototype.tsx:123-134` (launch state), `1010-1014` (contacts), `1104-1106` (find people) |
| X7 | **Source panel rendered side-by-side with the phone** inside the same review canvas — distracts visual review and breaks the single-surface reading. | layout.md §2 Page canvas vs auxiliary; review-grade requirement | `MobilePrototype.tsx:117-140` (`.prototype-source-panel`) |
| X8 | **Icon-only / action buttons rendered as text glyphs** — composer `☺`/`+`, station `+`/`x`. Icon-only buttons must be real icons with accessible labels. | components.md "Icon button… accessible label"; user directive "选项按钮不要文字，用 icon" | composer `MobilePrototype.tsx:687, 696`; station `259, 262` |

---

## Screen 1 — Station selection (`StationLaunchProjection` 179-317, `StationNetworkProjection` 319-357, `StationRow` 359-406)

Source truth: `App.tsx` LaunchState `station-selection`; `StationLaunchScreen.tsx`; `StationSelector.tsx`. Module contract: `modules/auth/README.md`.

**Six bounds**
- Page canvas: `.launch-screen`. Should be `surface.canvas`; federation mesh is a backdrop layer behind a single dominant card (auth/README "one dominant card over one calm backdrop").
- Content rail: `.launch-card` + `.station-selector` list — the reading column.
- Action rail: address control (`.station-url-control`) + per-row select/remove + primary "Continue". Per-state there must be **exactly one** primary next action (auth/README).
- Trust rail: station `online` state per row → must use `trust.*` roles (local/remote/warning/unknown), and must NOT infer policy from missing data (trust-state.md).
- Floating layer: none legitimate here (protocol is inline, see below).
- Recovery layer: `error` string ("Station already exists") — must be an Error-bounds line owned by the field, with recovery.

**Violations**

| # | Violation | Clause | Anchor |
|---|-----------|--------|--------|
| S1.1 | Protocol prefix + address are two separate controls (`.station-protocol-select` text toggle HTTP/HTTPS + `.station-address-input`), not one continuous AddressField. | ux-design-methodology **Case 001** + §2.1 Continuity; "one address field, not a dropdown glued to a text input" | `MobilePrototype.tsx:244` (protocol), address input adjacent |
| S1.2 | Protocol shown as raw text toggle instead of a proper prefix slot with a mobile-native selector. | Case 001 platform contract (Mobile BottomSheet for low-freq prefix) | `MobilePrototype.tsx:244` |
| S1.3 | Station add/remove icons are text glyphs `+` / `x`. | components.md Icon button (X8) | `MobilePrototype.tsx:259, 262` |
| S1.4 | **Remove button hides a `onDoubleClick`→verify interaction** — a destructive/verification action buried in a hidden gesture. | interaction.md discoverability; components.md danger scoping; ux-methodology discoverability dimension | `MobilePrototype.tsx:397-400` |
| S1.5 | Mesh backdrop node labels include a duplicate "Station" node and a distinct "Your Station" selected node — risks implying a center/hub. Auth mesh must have **no center node**. | auth/README "no center node… must not imply a single hub" | `MobilePrototype.tsx:319-357` |
| S1.6 | `online: undefined` for remote station rendered without an explicit unknown trust treatment — risks inferring state from missing data. | trust-state.md "don't infer policy from missing data"; classifications include `unknown` | `MobilePrototype.tsx:182` + StationRow |
| S1.7 | Copy is implementation-flavored, brand logo is a text `.prototype-logo` string. | social/README human-content layer; X5 | `MobilePrototype.tsx` `.prototype-logo` |
| S1.8 | Mesh edges use `--hot` raw accent + swap-flash; must be single brand accent, no glow/multi-color. | auth/README "single brand accent, no glow" | `MobilePrototype.tsx:319-357`; css |

---

## Screen 2 — Login / Access gate (`AccessGateProjection` 408-497)

Source truth: `AccessGateHost.tsx`, LaunchState `access-gate-chain`. Contract: `modules/auth/README.md`.

**Six bounds**
- Page canvas: `.auth-gate-card` over calm backdrop — one dominant card.
- Content rail: `.auth-station-summary` + `.auth-gate-copy` + `.auth-account-history` recent chips.
- Action rail: `.auth-actions` = "Change Station" (secondary) + "Login" (primary). One dominant primary per state (auth/README).
- Trust rail: which station you're authenticating into (station summary) — trust context must be visible at the decision point (ux-methodology Case 005).
- Floating layer: none.
- Recovery layer: gate has 4 states `login|invite|blocked|preparing` but **no state feedback/recovery surface** for blocked/preparing.

**Violations**

| # | Violation | Clause | Anchor |
|---|-----------|--------|--------|
| S2.1 | Gate declares 4 states but UI has **no entry to switch** — only `login` is reachable; blocked/invite/preparing are dead. Empty/error/blocked states must have a real path (ux-methodology Case 004). | ux-methodology Case 004; interaction.md state ownership | `MobilePrototype.tsx:409` + no switcher |
| S2.2 | Gate copy is code-description ("Invite-code gate is schema-driven via parseGateFields.") not product copy. | social/README human content; content-strategy dimension | `MobilePrototype.tsx` `.auth-gate-copy` |
| S2.3 | Recent-account chips lack Normal/Hover/Focus/Pressed/Disabled states and accessible semantics. | interaction.md "every actionable component defines states"; accessibility.md | `.auth-account-history` chips |
| S2.4 | Login primary likely renders with the gradient CTA (X1). | foundations §2/§3 (X1) | `mobilePrototype.css:375` |

---

## Screen 3 — Shell / Tabbar (`MobilePrototype` shell 152-173, `MobileTabbar` 499-522)

Source truth: `MobileShell.tsx` (chat/moments/contacts/settings, badge projection, tabbar-hidden).

**Six bounds**
- Shell area: `.mobile-shell` + `.mobile-content` + bottom `MobileTabbar`.
- Safe-area & occlusion: `tabbarHidden = chat && chatMode!=='list'` (106). All bottom occlusion sources (tabbar, composer, keyboard) must share **one clearance model** (ux-methodology **Case 003**).
- Trust rail: tab badges (chat:4, contacts:1) — must be quiet-meta trust level, not attention/alarm styling.

**Violations**

| # | Violation | Clause | Anchor |
|---|-----------|--------|--------|
| S3.1 | Badges hardcoded (4/1) and styled via `.prototype-badge` custom class, not a shared trust-meta token. | X4 + trust-state.md "Quiet meta" level; X5 | `MobilePrototype.tsx:52,54, 499-522` |
| S3.2 | No unified clearance model — tabbar hide is boolean toggle; composer/keyboard clearance handled separately (see Screen 4). | ux-methodology **Case 003** "Mobile bottom layers hide primary content" | `MobilePrototype.tsx:106` + composer |
| S3.3 | Tab icons present but active/inactive states rely on raw CSS, not `text.primary`/`text.secondary` + accent role. | tokens.md text roles; components.md | `MobileTabbar` css |

---

## Screen 4 — Chat: list, thread, action sheet, composer, group members

Source truth: `ChatPage.tsx` (1820 lines). Contracts: `patterns/{feed,composer,trust-state}.md`, `components.md`, `interaction.md`, `modules/social/README.md`, ux-methodology **Case 002/003**.

### 4a — Conversation list (`ChatProjection` list branch, ~627-771)

**Six bounds**: Page canvas `.page-header`; Content rail `.social-list-panel`/`.ant-list` rows; Action rail search; Trust rail per-conversation online/pinned/muted; Floating none; Recovery empty state.

| # | Violation | Clause | Anchor |
|---|-----------|--------|--------|
| S4a.1 | Search rendered as a `div.prototype-input` (not a real input; not a token-backed search field). | components.md search field; X5 | `MobilePrototype.tsx` chat-search-bar |
| S4a.2 | List items styled as `.ant-list` defaults, not normalized to feed reading-rail tokens (`surface.base`, aligned content edge). | feed.md "align to one content edge, light separators over heavy cards"; tokens LobeUI/antd normalization | list rows |
| S4a.3 | Pinned/Muted rendered as `.prototype-tag` chips, not `trust.*`/quiet-meta roles. | trust-state.md; X3 | conversation `tags` |

### 4b — Thread (`ChatProjection` thread branch 524-626)

| # | Violation | Clause | Anchor |
|---|-----------|--------|--------|
| S4b.1 | **Message actions expand on `:hover/:active` over the bubble** — action surface can occlude message content. | ux-methodology **Case 002** "Chat message action occludes content" | `mobilePrototype.css:1097-1102`; `MobilePrototype.tsx:596-626` |
| S4b.2 | Message bubbles styled with raw values + custom classes; `mine`/received not mapped to `surface.base`/accent roles. | tokens surface roles; X3 | message-bubble css |
| S4b.3 | Invented message text (X4). | social/README human content | `MobilePrototype.tsx:94-98` |

### 4c — Composer (thread footer 682-700)

**Composer surface (composer.md)** = Input area → attachment/context → audience/target → validation/recovery → action row; state belongs to the whole surface.

| # | Violation | Clause | Anchor |
|---|-----------|--------|--------|
| S4c.1 | Tools are text glyphs `☺` (emoji) / `+` (more), not icons with labels. | components.md icon button; X8 | `MobilePrototype.tsx:687, 696` |
| S4c.2 | Input is `<input value="Message..." readOnly>` — no composer state model (draft survival, disabled-with-reason, send state). | composer.md state ownership; interaction.md disabled-explains-why + draft survives failure | `MobilePrototype.tsx:689` |
| S4c.3 | Composer + tabbar + keyboard don't share one clearance model. | ux-methodology **Case 003** | composer footer + `:106` |

### 4d — Action sheet (`ChatActionSheet` 773-856)

| # | Violation | Clause | Anchor |
|---|-----------|--------|--------|
| S4d.1 | **Chat background options = 3 (`default/paper/aurora`)**; real source has **6** (`default/paper/mint/dusk/calm/graphite`) and `aurora` is invented. | source-backed (goal); `ChatPage.tsx:60` `CHAT_BACKGROUND_OPTIONS`, `styles.css:1890-1906` | `MobilePrototype.tsx:40, 821` |
| S4d.2 | Danger actions (Clear/Restore/Block/Unblock) inline with normal secondary actions in one list. | components.md "danger not inline with normal links"; interaction.md destructive confirm-before-remove | `MobilePrototype.tsx:773-856` |
| S4d.3 | Sheet is a floating layer but lacks defined focus/occlusion bounds (must not cover the content it acts on). | ux-methodology §2.2 floating/focus bounds; Case 002 | action sheet |

### 4e — Group members (`GroupManagementModal` 887-959)

Source truth: `ChatPage.tsx` `transferGroupOwnership`(149)/`confirmTransferGroupOwnership`(491)/`memberControls.canTransferOwnership`(1064)/Dissolve|Leave by role(1133-1134).

| # | Violation | Clause | Anchor |
|---|-----------|--------|--------|
| S4e.1 | **Member actions (Promote/Demote/Mute/Unmute/Remove) are bare text buttons.** Must be icons in a symmetric per-row layout. | user directive "选项按钮不要文字，用 icon"; components.md icon button | `MobilePrototype.tsx:925-933` |
| S4e.2 | **Missing owner transfer** — real source has it; prototype only offers Dissolve. | source-backed (goal); `ChatPage.tsx:149,491,1064` | `MobilePrototype.tsx:887-959` |
| S4e.3 | Bottom action is always "Dissolve"; real source switches **Dissolve (OWNER) vs Leave** by role. | source-backed; `ChatPage.tsx:1133-1134` | `.prototype-danger-full` |
| S4e.4 | Owner-transfer should appear **only at the bottom**, not per-row (user directive) — must be honored when added. | user directive | new work in Task 4 |

---

## Screen 5 — Contacts (`ContactsProjection` 972-1082, `FindPeopleModal` 1093-1121, `CreateGroupModal` 1123-1152, `ProfileModal` 1154-1184)

Source truth: `ContactsPage.tsx` (541 lines).

**Six bounds**: Page canvas contacts list; Content rail request/friend/group sections; Action rail toolbar (search + Create group + Find people); Floating layer modals; Recovery empty/error.

| # | Violation | Clause | Anchor |
|---|-----------|--------|--------|
| S5.1 | `.prototype-inline-controls` debug toggle (empty/populated) inside the content surface. | X6; review-grade | `MobilePrototype.tsx:1010-1014` |
| S5.2 | `FindPeopleModal` has Show/Hide error debug toggle inside the modal. | X6 | `MobilePrototype.tsx:1104-1106` |
| S5.3 | Request actions (Accept/Reject) — verify icon-only + accessible labels + states. | components.md icon button; interaction.md states | contacts requests section |
| S5.4 | Section headers via `SectionTitle` custom, not `type.sectionTitle` role. | tokens type roles; X3 | `MobilePrototype.tsx:1084-1091` |
| S5.5 | Profile modal Block/Unblock danger inline with Open chat. | components.md danger scoping | `MobilePrototype.tsx:1154-1184` |

---

## Screen 6 — Moments (`MomentsProjection` 1218-1309)

Source truth: `MomentsPage.tsx` (243 lines). Contracts: `patterns/{feed,composer}.md`, `modules/social/README.md`.

**Six bounds**: Page canvas feed; Content rail composer card + feed; Action rail Add image/Publish; Data/loading image tile states (uploading/done/error); Recovery on upload error.

| # | Violation | Clause | Anchor |
|---|-----------|--------|--------|
| S6.1 | Composer card + textarea use `.prototype-textarea` custom; composer surface not modeled per composer.md (audience/target slot, validation line). | composer.md anatomy | `MobilePrototype.tsx:1218-1309` |
| S6.2 | Image tile error state present but recovery affordance unclear. | ux-methodology Case 004 feedback/recovery | `.moments-image-grid` error tile |
| S6.3 | Publish CTA likely gradient (X1); feed items risk dashboard-panel look. | feed.md "not a dashboard grid"; X1 | composer + css |
| S6.4 | showCount /5000 + Add image {n}/9 must be quiet meta (`type.meta`), not prominent. | tokens type.meta; feed.md | composer counters |

---

## Screen 7 — Settings (`SettingsProjection` 1311-1373)

Source truth: `SettingsPage.tsx` (117 lines).

**Six bounds**: Page canvas settings list; Content rail profile + station card + actions; Action rail Change station / Logout; Trust rail station verified state; Floating layer Blocked-users modal; Recovery none needed.

| # | Violation | Clause | Anchor |
|---|-----------|--------|--------|
| S7.1 | Verified tag is click-to-toggle (a demo hack), and station verified state uses `.prototype-tag` not `trust.*`. | trust-state.md trust roles; interaction.md real state ownership | `MobilePrototype.tsx:1336` |
| S7.2 | Profile logo is text `.prototype-logo`. | X5; social human content | `.settings-profile` |
| S7.3 | Logout is a destructive-ish action mixed with Blocked users navigation without danger scoping. | components.md danger scoping | `.settings-actions` |
| S7.4 | Blocked-users modal floating layer without defined focus/occlusion bounds. | ux-methodology §2.2 floating/focus | blocked modal |

---

## Structural fix strategy (feeds Task 4 — do NOT patch symptoms)

1. **Delete the three patch passes** (`mobilePrototype.css:1512/1640/1992`) and rebuild the stylesheet on token roles.
2. **Introduce a token layer** mapping raw `--brand-*` → `surface.*/text.*/action.*/trust.*/border.*/radius.*/type.*/space.*` per tokens.md; kill the gradient CTA → single `action.primary` accent.
3. **Normalize the class system** away from `.prototype-*` toward the real IA class names (`styles.css` is the class-name truth); custom classes only where the real app has them.
4. **Remove all debug chrome** (launch-state buttons, `.prototype-inline-controls` ×2, side source panel) from the review surface; move launch-state navigation into a non-content dev affordance or drive it by the real flow.
5. **Source-faithful data**: replace invented conversations/messages with product-shaped placeholder copy; restore the 6 chat backgrounds; add owner transfer + role-based Dissolve/Leave.
6. **One clearance model** for tabbar + composer + keyboard (Case 003); **collision-aware** action sheet + message actions (Case 002).
7. **Icon-only actions** get real lucide icons + accessible labels (composer, station, member row); member row becomes a symmetric icon layout; owner transfer only at the bottom.
8. **AddressField continuity** (Case 001) for station protocol + host.
9. Per-state **single primary next action** on Station + Login (auth/README).

Each Task-4 change will re-cite the exact rows above (L1 anchor), then pass L2 screenshot / L3 dynamic / build gates on port 3203 before any status moves off `drafting`.

---

## Task 4 resolution ledger (verified against current rebuild)

> Verified against `MobilePrototype.tsx` (1713 lines) + `mobilePrototype.css` (2178 lines) rebuilt on the token layer. The audit above was written against the pre-rebuild 1373-line / 2215-line version; this ledger records the current-version resolution anchor + gate for each item. `status: drafting` stays (fail-closed) until real `apps/mobile` runtime acceptance.

### Cross-cutting

| # | Resolution | Current anchor | Gate |
|---|-----------|----------------|------|
| X1 | Gradient CTA removed. Single accent `--action-primary: #6b5bd6`; no `linear-gradient(135deg,…)` CTA anywhere. Remaining `linear-gradient` uses are the 6 source-faithful chat wallpapers only. | `mobilePrototype.css:24-30` (action roles), grep `135deg`=0 | L1 ✓ · build ✓ |
| X2 | Three patch passes deleted; stylesheet rebuilt on token roles. No `Visual fidelity`/`Launch/Auth parity`/`Compression repair` blocks, no `width:max-content` root hack. The single `overflow-x:auto` at `:82` is a documented `safe center` root behavior, not a compression patch. | grep `Compression repair`/`max-content`=0; `mobilePrototype.css:77-88` | L1 ✓ · build ✓ |
| X3 | Token layer introduced (`surface/text/action/trust/border/radius/type/space` roles). No `--brand-*` vars. | `mobilePrototype.css:1-93` | L1 ✓ · build ✓ |
| X4 | Source-faithful data: 6 chat backgrounds restored (`default/paper/mint/dusk/calm/graphite`, `aurora` removed); product-shaped copy. | `MobilePrototype.tsx:53-65`; grep `aurora`=0 | L1 ✓ |
| X5 | `.prototype-*` class family removed; real IA class names used. | grep `prototype-` in src=0 | L1 ✓ · build ✓ |
| X6 | Debug chrome (launch-state buttons, `.prototype-inline-controls`, show/hide-error toggles) removed from the review surface; stage switching lives in the out-of-device `PrototypeNav` scaffolding. | grep `inline-controls`/`launch-state`/`populated`=0 | L1 ✓ · L2 ✓ |
| X7 | Side-by-side source panel removed; single device surface + out-of-frame source list. | grep `source-panel`=0 | L1 ✓ · L2 ✓ |
| X8 | Icon-only actions use lucide icons + `aria-label` (composer Emoji/More tools/Send, station Add/Remove, member row, message actions). No text glyphs. | `MobilePrototype.tsx:340,349,358,469,695,703,815,865,880,888` | L1 ✓ · L3 ✓ |

### Per-screen

| # | Resolution | Current anchor | Gate |
|---|-----------|----------------|------|
| S1.1/S1.2 | Protocol + address + submit are one continuous `.address-field` composite (Case 001 FieldFrame), not glued controls. | `MobilePrototype.tsx:334-361` | L1 ✓ · L2 ✓ |
| S1.3 | Station add/remove are lucide `Plus`/remove icons with labels. | `MobilePrototype.tsx:358,469` | L1 ✓ · L2 ✓ |
| S1.4 | Hidden `onDoubleClick` destroy gesture removed; grep `onDoubleClick`=0. | grep `onDoubleClick`=0 | L1 ✓ |
| S1.6 | Remote station renders explicit "Not verified · Check" trust treatment, not inferred-from-missing. | station rows e13/e14 (L3 snapshot) | L1 ✓ · L3 ✓ |
| S2.1 | Access-gate 4 states reachable via `PrototypeNav` (Login/Invite/Blocked/Preparing); blocked/preparing keep Sign in disabled (fail-closed). | scaffolding stage buttons | L2 ✓ · L3 ✓ |
| S3.1 | Tab badges projected from state (chat 4 / contacts 1) as quiet-meta, token-backed. | tabbar e34/e36 (L3 snapshot) | L1 ✓ · L3 ✓ |
| S4b.1 | Message actions render in `.message-action-anchor` **below** the bubble on tap-select — never a hover overlay (Case 002). | `MobilePrototype.tsx:735-766` | L1 ✓ |
| S4c.1/S4c.2 | Composer tools are labeled icons; input is a real `textbox` with a send-state model (`Send` disabled until draft non-empty). | `MobilePrototype.tsx:865,874,880,888`; L3 Send=disabled | L1 ✓ · L3 ✓ |
| S4d.1 | 6 source-faithful backgrounds; `aurora` removed. Verified in the open ChatActionSheet: Default/Paper/Mint/Dusk/Calm/Graphite rendered as selectable chips. | `MobilePrototype.tsx:59-65,1018`; ChatActionSheet L3 (More actions → bg chips e47-e52) | L1 ✓ · L2 ✓ · L3 ✓ |
| S4d.2/S4d.3 | ChatActionSheet is a bottom-sheet floating layer positioned **below** thread content (no occlusion of the acted-on messages); Search/Mute/Pin/Alerts render as labeled lucide icons with checkmark state. | ChatActionSheet L3 (rows e43-e46, screenshot) | L1 ✓ · L2 ✓ · L3 ✓ |
| S4e.1 | Member Demote/Promote/Mute/Unmute/Remove are symmetric labeled icon buttons per row, gated by role (Owner row shows chip only; Admin row shows demote/mute/remove; muted member shows promote/unmute/remove). | `MobilePrototype.tsx:1152-1187`; GroupManagementSheet L3 (rows e50-e55, screenshot) | L1 ✓ · L2 ✓ · L3 ✓ |
| S4e.2/S4e.3/S4e.4 | Owner transfer + role-based Dissolve/Leave grouped **once at the footer** danger zone (Crown "Transfer ownership" + Trash2 "Dissolve group"), never per-row. Invite-friends section uses UserPlus "Invite" per candidate. | `MobilePrototype.tsx:1210-1222`; GroupManagementSheet L3 (footer e58/e59, invite e56/e57, screenshot) | L1 ✓ · L2 ✓ · L3 ✓ |
| S5.1/S5.2/S5.3/S5.4 | Contacts debug chrome removed; Create-group/Find-people are labeled icon buttons, search is a real `textbox`, friend-request Accept/Decline are labeled icon buttons, section headers are quiet-meta `.section-title` + count. | `MobilePrototype.tsx:1256-1364`; Contacts L3 (header e40/e41, search e42, accept/decline e43/e44, sections, screenshot) | L1 ✓ · L2 ✓ · L3 ✓ |
| S6.1/S6.2/S6.4 | Moments composer modeled per composer.md: `Public audience` audience slot, real `textarea` with quiet-meta `n/5000` counter, image tiles carry uploading/done/error states with an explicit error recovery affordance (Retry, Case 004), tile actions are labeled icons; Publish is fail-closed disabled until text present AND every image `done`, then enables. Tile actions match real source `MomentsPage.tsx:205-214` exactly — **Retry only on error, Remove on all**; uploads auto-resolve (no manual "mark ready"). | `MobilePrototype.tsx:1527-1626`; source `apps/mobile/src/pages/MomentsPage.tsx:19,64,186-238`; Moments L3 (textarea live count, Retry/Remove, Publish disabled→enabled after resolve, screenshot) | L1 ✓ · L2 ✓ · L3 ✓ |
| S7.1/S7.2/S7.3/S7.4 | Verified is a static trust chip (`.status-chip verified`, trust.local role, no click-to-toggle hack); profile uses an avatar not a text logo; per real source `SettingsPage.tsx:72-79` the account actions are **two plain block buttons** (Blocked users w/ Ban icon + Sign out) — no Account section title, chevron rows, or count badge; Blocked users opens inside a bounded `PrototypeModal` (defined focus/occlusion). | `MobilePrototype.tsx:1639-1698`; source `apps/mobile/src/pages/SettingsPage.tsx:42-114`; Settings L3 (Change Station, Blocked users, Sign out, screenshot) | L1 ✓ · L2 ✓ · L3 ✓ |

### Desktop Social Chat scope (goal Desktop range — verified 2026-07-08)

> Path: portal 3203 → Desktop site → Desktop Shell (e4) → left rail `聊天` (Chat) → Social Chat module. Contract authority identical to Mobile: `docs/client/common/ui-identity/*`. Source: `packages/prototypes/desktop/features/social-chat/src/components/{SessionList,DetailPanel,ChatArea}.tsx`, `pages/SocialChatPage.tsx`. Knowledge gate: `docs/knowledge/invariants/desktop-chat-layout-boundaries.md`, `docs/knowledge/pitfalls/social-ui-identity-surface-fragmentation.md`.

| # | Resolution | Current anchor | Gate |
|---|-----------|----------------|------|
| D1 | Chat/Contacts are one vertical tab pair inside the Chat module rail; Contacts stays a sibling tab, not a Desktop Shell route (explicit boundary copy in the placeholder pane). | `SocialChatPage.tsx`; Contacts pane L3 (tab e18 → "sibling tab of Chat" boundary copy, screenshot) | L1 ✓ · L2 ✓ · L3 ✓ |
| D2 | Add friend/group is a single icon-triggered menu button (`Plus` + `aria-label="Add friend or group"`, `aria-haspopup="menu"`), never a literal `+` glyph; the menu exposes source-mapped "Add friend" / "Create group" items. | `SessionList.tsx:195-229`; Chat L3 (menu e19 expand → Add friend e28 / Create group e29, screenshot) | L1 ✓ · L2 ✓ · L3 ✓ |
| D3 | Stream-call state (idle/outgoing/incoming/active/reconnecting/ended/failed × audio/video) is folded into the Conversation-actions usage menu, not a persistent status-tag bar. | `ChatArea.tsx`; Conversation actions L3 (e23 → folded call-state controls, snapshot) | L1 ✓ · L3 ✓ |
| D4 | Member manager rows are symmetric labeled icon buttons (Mute/Unmute, Make admin/Remove admin, Kick out); state-aware (muted member shows Unmute); the Owner "You" row routes self-actions to the Danger Zone with no per-row destructive. | `DetailPanel.tsx:583-604`; member manager L3 (rows e37-e60 icon-only, Owner row "Self actions live in Danger Zone", screenshot) | L1 ✓ · L2 ✓ · L3 ✓ |
| D5 | Transfer ownership appears **once** at the manager footer with the explicit note "Owner-only action lives here, not on every member row"; Invite member uses `UserPlus` + accessible label, never a literal `+`. | `DetailPanel.tsx:585-808`; member manager L3 (footer Transfer ownership list, Invite member e32, screenshot) | L1 ✓ · L2 ✓ · L3 ✓ |

Console clean (only React DevTools info notice) across the Desktop Social Chat L3 walkthrough.

### Gates not fully closed (fail-closed, listed honestly)

- **Source-fidelity reconciliation (2026-07-08) — 3 invented interactions removed.** A line-by-line diff of the prototype against real `apps/mobile/src` surfaced three controls the prototype rendered that have **no counterpart in the real source**. They were fabricated for demo flair and are now removed:
  1. Contacts "Sent requests" → **Cancel** button. Real `ContactsPage.tsx:320-336` renders sent requests read-only ("waiting for accept"); `socialStore` exposes only accept/reject/send (no cancel/withdraw). Removed — row is now read-only.
  2. Moments uploading tile → **Mark ready** (Check) button. Real `MomentsPage.tsx:205-214` auto-resolves uploads via `uploadOne`; only error tiles get Retry, all tiles get Remove. Removed; prototype now auto-resolves the tile like the real upload path.
  3. Settings account actions → invented **Account section + chevron rows + count badge**. Real `SettingsPage.tsx:72-79` is two plain block buttons. Restored to plain block buttons.
  Prior ledger rows S6/S7 that referenced the fabricated controls have been corrected. The three earlier claims of "fully source-backed" for these controls were overclaims and are retracted here.
- **ChatActionSheet + GroupManagementSheet L2/L3 — NOW CLOSED (2026-07-08).** The earlier "clipped right edge / `<html>` intercept" report was a stale interaction pattern, not a real geometry limit. On tab `e9bcee73` (port 3203) the device renders centered (not clipped); using `browser_scroll {scrollIntoView:true}` then `browser_click` on the thread "More actions" affordance opens the ChatActionSheet (Search/Mute/Pin/Alerts icons + 6 background chips + Group members + Clear history), and "Group members" opens the GroupManagementSheet (symmetric per-member icon rows + Invite-friends + footer Transfer ownership/Dissolve group). Both captured by screenshot; console clean (only React DevTools info). See ledger rows S4d.1/S4d.2/S4d.3/S4e.1/S4e.2/S4e.3/S4e.4 above.
- **Real `apps/mobile` runtime acceptance**: not performed; `status: drafting` retained by design (fail-closed).
