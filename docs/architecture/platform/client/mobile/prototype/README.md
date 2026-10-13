# Mobile Prototype

> **Status**: confirmed
> **Version**: v1.0
> **Created**: 2026-07-08 | **Updated**: 2026-10-12
> **Owner**: Mobile Product Team
> **Module**: `packages/prototypes/mobile/chat/`

## 2026-10-13 Human Content & Trust Slots

Production review exposed inbound seed/transport strings rendered as product
copy: acceptance seed text (`MWPU … <timestamp>`) appeared as conversation
previews and Moment bodies, and a Station endpoint (`host:port`) appeared as
Moment author sub-copy. The new `content-projection` scenario fixes the
*contract* the production rebuild must implement, without changing any already
confirmed surface.

- Scenario: `?scenario=content-projection` ("UI / human content & trust slots").
- Owner: `src/contentProjection.ts` presenter.
  - plain human text passes through;
  - emoji-only stays emoji; image/file become human media forms;
  - seed/PTID/ULID/`host:port`/long-id strings never reach a human slot — they
    become a neutral localized `System update` label;
  - list previews keep existing human media labels (`[Photo]`, `report.pdf`).
- Trust-slot hygiene: name, relationship meta, preview, and Moment author
  slots carry no endpoint or machine id; transport identity is disclosed
  progressively only on trust/Safety detail surfaces.
- Launch-only federation mesh never renders inside the authenticated shell.
- Verification:
  - pure presenter unit checks:
    `node --test packages/prototypes/mobile/chat/scripts/check-content-projection.mjs`
    (7 assertions, no Portal required);
  - L2/L3 rendered evidence: the scenario shows projected list previews and a
    thread whose machine strings are replaced, with zero console/page errors.
- Desktop↔Mobile chat parity (both portals must run, mobile 3210 + desktop 3211
  or override with `MOBILE_URL`/`DESKTOP_URL`):
  `node packages/prototypes/mobile/chat/scripts/check-chat-parity.mjs` loads
  both surfaces with their own platform-appropriate probe and compares the
  semantic chat contract — 32px square identity top-aligned per cluster, 4px
  tail on the same top corner, full 12px inner corners, inline-only failed
  retry, and one soft-gray composer dock (12px radius, 8px send, equal four-
  sided frame, send/emoji inside the dock, no exterior attach).

This is prototype interaction intent. Production implements the same boundary
as a presenter between projection store and page and adds a data-hygiene
visualization gate (no endpoint/PTID/seed prefix in human slots); it does not
change Station/Conversation/Social authority ownership.

## 2026-10-12 Interaction Review Reset

Current rendered review found blocking inconsistencies in avatar identity,
Chat loading, message anatomy, error ownership, touch geometry, Design Tokens,
and cross-module visual continuity. The prototype has therefore returned to
`drafting`; prior `pending-review` evidence remains historical and does not
authorize further production implementation.

The active gap register and proposed confirmation decisions are:

- [interaction-gap-register.md](./interaction-gap-register.md)

The Owner confirmed the revised executable prototype on 2026-10-12
(`USER-DECISION-20261012-MOBILE-PROTOTYPE-CONFIRMED`). Production
implementation must still run through the mounted production Plan and its
declared worktree; this confirmation does not authorize cross-worktree writes.

## 2026-10-12 Confirmed Interaction Revision

The accepted interaction baseline is now implemented in the executable
prototype:

- one shared semantic token source drives Mobile CSS variables and the antd
  adapter; `#667eea` is the authoritative light-theme action accent;
- light and dark review modes are available beside the evidence selector;
- people and groups use rounded-square image/fallback avatars with a
  size-derived corner radius (never circular); loading and failed-source
  states keep stable geometry;
- the clean default journey contains no synthetic delivery failure;
- conversation first-load, cached-refresh, cached-error, empty, long-content,
  avatar-loading, avatar-fallback, thread first-load, older-history, route
  unavailable, failed delivery, and unknown-outcome states are directly
  addressable;
- one failed message owns one local Retry action; unknown delivery owns
  `Check status` and never offers blind Retry;
- incoming messages use sender clusters, one final `MetaRow`, and one avatar
  per cluster;
- pinned content uses one compact thread banner and a dedicated pinned-message
  page;
- Chat, Moments, Contacts, and Me now share the same header, row, avatar,
  surface, separator, and touch-target language.

Rendered evidence is under:

`docs/architecture/platform/client/mobile/prototype/evidence/20261012-interaction-revision/`

The evidence set contains 23 device captures and `visual-check.json`.
The agent opened and inspected the list/theme/loading/error contact sheet, the
thread/loading/history/unknown/pinned contact sheet, Moments, Contacts, Me,
conversation details, and both completed recovery captures.

Observed evidence:

- device geometry is 390 x 844 in every capture;
- visible prototype actions in the covered Chat paths meet the 44 px Mobile
  target; the machine output only reports antd's hidden 12 px input-clear
  implementation detail;
- default and recovery states contain zero legacy page-level delivery banners;
- failed delivery has exactly one message-local Retry owner;
- unknown delivery has exactly one message-local `Check status` owner;
- Retry and Check status both converge to delivered state and append the peer
  acknowledgement;
- light uses `#667eea`; dark uses the shared dark token projection;
- first-load skeletons preserve seven conversation rows; cached refresh/error
  retain all projected rows;
- the evidence run produced no page or console errors.

Frontend tree review:

- Surface: Mobile primary tabs, descriptor detail, message list, sheets.
- Alive policy: unchanged from the registry: primary tabs and details are
  `on-visit + none`; large content remains bounded/virtualized.
- Store/runtime ownership: unchanged; prototype evidence state is scaffolding
  outside the product tree.
- Registry update: not required because no lifetime, cache, or runtime owner
  changed.

The Owner accepted the interaction baseline with the remaining evidence cells
explicitly deferred:

- full-shell Chinese localization and one additional expansion locale;
- 200% dynamic type and VoiceOver/TalkBack order;
- real software keyboard, emoji/attachment/voice panel clearance and focus
  restoration;
- attachment/media failure recovery;
- native iOS/Android and production runtime evidence;
- the separate Call gaps recorded in MUX-12.

This confirmation establishes the production interaction reference. It does
not replace production implementation, exact-source runtime proof, or the
mounted Plan's execution controls.

## Scope

`mobile-chat` is the Mobile Shell baseline prototype. It is intentionally aligned with the current `apps/mobile` implementation instead of the removed single-page mobile chat mock.

The prototype covers:

- `MobileShell` primary tabs: Chat, Moments, Contacts, Settings.
- Access gate / station session context before the shell, including GitHub and
  Google OAuth progress.
- Chat list projection for Friend and Group conversations.
- Chat thread mode where the bottom tabbar is hidden and the composer owns the bottom safe area.
- Direct-conversation audio/video actions and a shell-owned call surface for
  outgoing, incoming, active audio/video, reconnecting, handled-elsewhere, and
  ended states.
- Contacts toolbar actions: create group and find people, matching `ContactsPage`.
- Group creation with initial members and friend request search/send affordances.
- Moments feed/composer/reaction/comment surfaces.
- Me/profile and selected-only settings details.
- Evidence scenarios for Station identity mismatch, OAuth expiry, session
  revocation, unknown write outcome, ledger capacity, and restored drafts.
- Cross-platform `CHAT-CRAFT-J01` delivery failure and recovery, backed by the
  shared fixture at `packages/prototypes/shared/chat-journey.ts`.

## Source Alignment

| Prototype surface | Product source |
|---|---|
| Shell tabs and tabbar badge behavior | `apps/mobile/src/components/MobileShell.tsx` |
| Chat list, thread, action surface boundaries | `apps/mobile/src/pages/ChatPage.tsx` |
| Friend conversation projection | `apps/mobile/src/features/social/socialProjection.ts` |
| Group conversation projection | `apps/mobile/src/features/group/groupProjection.ts` |
| Find people and create group | `apps/mobile/src/pages/ContactsPage.tsx` |
| Access gate launch state | `apps/mobile/src/App.tsx`, `apps/mobile/src/features/auth/AccessGateHost.tsx` |
| OAuth progress and recovery | MS-C03 / MS-J01 / MS-PA03 / MS-PA25 |
| Moments feed and composer | MS-C08 / MS-J05 / MS-PA11 / MS-PA20 / MS-PA23 |
| Me and settings details | MS-C09 / MS-J06 / MS-PA12 / MS-PA21 |
| Runtime recovery sheets | MS-C10 / MS-J07 / MS-PA08 / MS-PA23 / MS-PA26 |
| One-to-one call surface | MS-C12 / MS-J03 / MS-PA28 / MS-PA29 |
| Deferred/local-only affordances | MS-C11, MS-C13, MS-C14 / MS-PA22 / MS-PA27 |

## Run

Use the unified Prototype Portal:

```bash
make run-prototype
```

Then switch the Portal site selector to `mobile` and open `Mobile Shell`.

For parallel prototype development in another worktree:

```bash
make -w run-prototype
```

## Evidence Controls

The out-of-device `Evidence scenario` selector exposes:

- default journey;
- Chat delivery recovery;
- Station removal confirmation;
- Station identity mismatch;
- OAuth expired;
- session revoked;
- unknown write outcome;
- command ledger full;
- restored draft.
- one-to-one call states: outgoing audio, incoming video, active audio/video,
  reconnecting, handled elsewhere, and ended.

These controls are Prototype Portal scaffolding. Each selected state renders a
realistic product recovery surface inside the device frame.
Each state is also directly reproducible from the standalone prototype with
`?scenario=<scenario-id>`.
The default journey also includes Station removal confirmation, enabled Direct
audio/video call actions, disabled WeChat, and device-only message flag copy.

### 2026-10-12 One-To-One Call Contract Sync

Mobile Call is no longer represented as a disabled future affordance. Direct
conversation headers expose separate labeled audio and video actions. The call
surface is mounted by `MobileShell`, outside the Chat page tree, so navigation
cannot silently destroy its state. The underlying conversation remains the
context owner while the modal call surface owns focus and controls.

State evidence is directly addressable:

- `?scenario=call-outgoing-audio`
- `?scenario=call-incoming-video`
- `?scenario=call-active-audio`
- `?scenario=call-active-video`
- `?scenario=call-reconnecting`
- `?scenario=call-handled-elsewhere`
- `?scenario=call-ended`

Verification:

- TypeScript `--noEmit` passes for the Mobile prototype package.
- `scripts/check-call-states.py` passes all seven states at 430px, the active
  video state at 1440px, and four L3 paths: cancel, accept/control/end,
  handled-elsewhere dismissal, and Default journey -> Direct -> audio call.
- Ten screenshots and the machine-readable result are under
  `apps/mobile/src-tauri/target/prototype-call-states/`; the agent opened and
  inspected outgoing, incoming, active video, reconnecting,
  handled-elsewhere, ended, and Direct-entry captures.
- Prototype Portal at `http://localhost:3200/` discovered the current
  `pending-review` manifest, rendered `call-active-video` inside Mobile Shell,
  kept the call surface inside the device bounds, and accepted the Mute
  interaction without horizontal overflow.
- The existing Portal layout regression produced 54 captures across 1440px,
  554px, and 390px with zero geometry defects.
- Call controls meet the prototype's 44px target check, the overlay remains
  inside the device shell, no horizontal overflow or new page/console error is
  present. The existing antd `List` deprecation warning is recorded separately.

This amendment is `pending-review`. It proves browser interaction intent only.
Native iOS media, production styling/i18n, permission and device selection,
direct/TURN routing, reconnect/cleanup, cross-Station behavior, and exact-source
Desktop/Mobile arbitration remain `UNPROVEN` under MS-PA28/MS-PA29.

### 2026-10-11 Chat Delivery Recovery

`?scenario=chat-delivery-recovery` opens the shared `CHAT-CRAFT-J01` Release
Room directly inside the standard `ChatThread`. The failed outgoing message
remains in context, the recovery surface explains that the encrypted payload is
stored locally, and Retry moves the message through sending to delivered before
appending the peer acknowledgement. The recovery path reuses the existing
thread; it does not replace the action sheet, composer, pinned tab, details
panel, or any other Chat feature.

Craft evidence:

- Positive calibration: touch-first recovery, preserved conversation context,
  local feedback, and no false delivery success.
- Negative calibration: no phone-width right drawer, global error page,
  decorative motion, or color-only state.
- L2: 1440px Portal frame and 430px Chinese direct render were opened; content,
  composer, recovery action, and device frame do not overlap or overflow.
- L3: touch/click Retry completes failed → sending → delivered and peer
  acknowledgement; reduced-motion mode remains understandable.
- L4: new controls have accessible names, the primary recovery target is
  44px high, no console/page errors were observed, and local lab metrics were
  `CLS=0.0128`, `LCP=188ms`.
- Evidence root:
  `~/.peers-touch/dev/workspaces/48035cb460a725a5/evidence/chat-craft/20261011/`.
- `UNPROVEN`: native iOS/Android, VoiceOver/TalkBack device proof, real
  Station/Relay delivery, and production field performance.

This amendment is `pending-review`. Earlier confirmed prototype history does
not confer confirmation on the changed Chat Journey.

### 2026-09-19 Message Action Semantics

The confirmed Mobile Chat action sheet now keeps the four MS-D20 actions
distinct: Forward, Recall, Delete for me, and role-gated Remove for group.
Forward retains the bounded destination picker; Delete for me removes only the
current actor's mock projection; moderation leaves an explicit shared
tombstone. This is prototype behavior only and does not establish native or
Station proof.

The prototype package build passes. Fresh L2/L3 visual evidence for these
action-sheet states remains `UNPROVEN` until the Portal render checks are run.

### 2026-09-19 Settings Owner Parity

The confirmed Me/Settings prototype now shows the canonical Social blocked-user
list with readable actor identity, full PTID/Station context, and an explicit
Unblock action. The undefined additional account-preference section is removed;
Profile/privacy, Notification, Social, and device settings remain independent
owners.

This is product/prototype alignment only. `MS-D22A` is accepted; the
Profile/Notification cross-client CAS hard cut remains source work in W6C, and
native second-device conflict evidence remains in `W6C-PROOF`.

Prototype verification passes the package build and all 51 layout captures
with zero defects. The inspected 390px blocked-user detail is
`apps/mobile/src-tauri/target/w6c-prototype/390-blocked-users-clean.png`;
its two identity rows have no horizontal overflow or action overlap.

Evidence captured on 2026-08-27 at the Portal mobile preview:

| Layer | Scenario | Evidence |
|---|---|---|
| L2 | Station identity mismatch | `tmp/evidence/mobile-shell/prototype/20260827/station-identity-mismatch.jpg` |
| L2 | OAuth expired | `tmp/evidence/mobile-shell/prototype/20260827/oauth-expired.jpg` |
| L2 | Session revoked | `tmp/evidence/mobile-shell/prototype/20260827/session-revoked.jpg` |
| L2 | Unknown write outcome | `tmp/evidence/mobile-shell/prototype/20260827/unknown-write.jpg` |
| L2 | Command ledger full | `tmp/evidence/mobile-shell/prototype/20260827/ledger-full.jpg` |
| L2 | Draft restored | `tmp/evidence/mobile-shell/prototype/20260827/draft-restored.jpg` |
| L2 | Station removal confirmation | `tmp/evidence/mobile-shell/prototype/20260827/station-removal.jpg` |
| L3 | Recovery actions | Scenario selector reached every state; Station/OAuth recovery returned to the correct pre-shell surface; unknown/ledger actions returned to readable Shell; Continue editing opened the conversation thread |
| L3 | Deferred/local-only actions | Chat thread contains Chat/Pinned only; Direct call is enabled, WeChat/Docs remain disabled or absent, and message action reads “Flag on this device” |

### 2026-09-12 Social And Recovery Samples

The previously confirmed baseline is unchanged. The following additions express
the accepted MS-J03/MS-J04/MS-J07 failure and relationship semantics; they are
not newly confirmed or landed by this source update.

| Scenario ID | Sample |
|---|---|
| `social-unavailable` | Unavailable Chat/Contacts, lifecycle Retry with explicit pending and failure outcomes, and independently accessible Me |
| `social-detail-unavailable` | Conversation route keeps Back and one centered lifecycle Retry without stacked global notices |
| `find-people-no-membership` | Separate handle and Federation fields; no active membership disables Send Request |
| `find-people-member` | Request admission, pending/unknown outcome, and accepted contact without implicit conversation creation |
| `contact-direct` | Contact-to-Message preparation, failure/Retry, and explicit Direct readiness opening an empty thread |
| `request-unknown` | One retained intent; Check Status does not admit another Send |

The out-of-device `Controlled Social demo transitions` panel resolves pending
prototype actions. It never simulates a network callback automatically or
provides Station evidence. State is in memory and resets with the scenario.

Integrator verification:

- `make run-prototype` served the bound `peers-social` worktree; the Portal's
  selected Live Preview was `Mobile Shell`.
- `pnpm --dir packages/prototypes/mobile/chat build --configLoader runner`
  built successfully; the existing large-chunk warning remains.
- L3 browser interaction at a 554 x 954 viewport verified unavailable/Retry
  failure and Me navigation, no-membership Send suppression, a single request
  progressing through unknown/Check Status/pending/accepted, Friends rather than
  Sent after acceptance, and Message/preparing/failure/Retry/ready/empty thread.
- Unavailable Chat/Contacts now own one centered route recovery surface. The
  lifecycle Retry moved into that surface; unrelated tabs and background
  reconciliation no longer receive a second stacked global notice.
- The IDE screenshot tool remained unavailable. Local Playwright subsequently
  captured the actual Portal and removed that tooling blocker.
- Inspected screenshots exposed compressed preview width, clipped Contact Info
  after Direct failure, and the fixed scenario label covering the preview.
  Portal responsive layout, Mobile detail flex sizing, narrow workbench padding,
  and normal-flow scenario labels correct those issues without changing any
  page lifetime or production behavior.
- The repeatable render check passes 48 states at 1440x1100, 554x954, and
  390x844. Phone previews measure 390px, 390px, and 324px respectively.
  It checks geometry, page overflow, unclipped Info rows, scenario non-overlap,
  tab geometry, sheet focus containment/Escape, retained request intent, and
  explicit Direct success/failure. Screenshots under
  `apps/mobile/src-tauri/target/prototype-layout-final/` were opened and
  inspected, including `390-member.png` and `390-direct-info-scrolled.png`.
- The current prototype is light-only; there is no dark-theme implementation
  to claim tested. Portal type-check/build and Mobile prototype build pass;
  existing large-chunk warnings remain.

Run the prototype-only regression against an already running Portal:

```bash
PROTOTYPE_URL=http://localhost:3200 \
node packages/prototypes/mobile/chat/scripts/check-layout.mjs
```

The script uses the repository's existing Playwright dependency installed with
the Desktop development toolchain. It creates and closes its own headless
browser; it never connects to Station or native apps. `PROTOTYPE_EVIDENCE_DIR`
optionally selects output; the default is ignored Mobile target output.
It is a render regression, not an Acceptance product Gate.

Known Social-transition sample limits: one Federation and one mutable request;
multi-scope selection, inbound Accept/Reject, and durable restart recovery are
not covered. The separate long-list samples below add read-only request
collections, not more command owners. The older
`unknown-write` message sample is unchanged. Shared UI Identity and its Social
module contract govern these samples; native Mobile behavior remains separately
unproven. Render verification does not confirm the additions or establish full
pixel parity with native Mobile.

### 2026-09-13 Auth Identity Parity

Desktop/shared Auth is the visual source for Mobile Auth. The prototype and
production now share the exact Desktop 512x512 icon, one dominant 400px-wide
card with 24px radius, a 72x72 in-card logo, compact header and segmented login
mode, and the same GitHub/Google action hierarchy. The Mobile-only wordmark and
`PEERS TOUCH MOBILE` kicker are removed. Station context uses a friendly label
instead of a raw host/URL.

`?scenario=session-revoked` renders the expired-session notice inside the Auth
card. It does not mount a second recovery panel or cover the sign-in controls.
`check-layout.mjs` now asserts one Auth card, brand containment, exact logo
geometry, zero brand-to-card gap, no duplicate recovery, no Mobile kicker, no
raw Station address, and no vertical overflow.

Current-source verification:

- all 51 captures pass at 1440x1100, 554x954, and 390x844 with zero defects;
- evidence is under
  `apps/mobile/src-tauri/target/auth-parity-20260913/prototype-current-source/`;
- the inspected narrow expired-session capture is
  `390-auth-session-revoked.png`;
- the exact-current-source native normal Auth capture is
  `apps/mobile/src-tauri/target/auth-parity-20260913/final-current-source.png`;
- native 402x874 geometry proves one card, 72x72 logo, zero gap/overlap, no
  kicker, no raw Station address, and no viewport overflow.

The native expired-session state was not recreated by mutating retained client
state. Its production composition is covered by focused tests and the direct
prototype scenario; physical expired-session execution is optional diagnostics
under MS-D26.

### 2026-09-12 Long-List Sample

`?scenario=long-lists` adds 240 conversations, 240 contacts, and 480
variable-height messages. The selected page alone mounts; Shell-owned bounded
presentation metadata restores queries and identity/offset anchors.
Previous/Next traverse overlapping windows, Latest returns to the tail, and
submitted sample search pages through history before materializing a selected
older message. This expresses the accepted W6A traversal contract; it does
not supply Station data or native indexed-search evidence.

Integrator checks:

- `node packages/prototypes/mobile/chat/scripts/check-long-lists.mjs` passes
  at 1440x1100, 554x954, and 390x844 against the existing Make Portal.
  Each run reaches all 240 conversations, 240 contacts, and 480 messages and
  search results with bounded mounted rows. Return anchors, older-reader
  stability, live-tail following, selected-only pages, empty search, and the
  inherited Social/recovery scenarios pass without browser errors or overflow.
- The Mobile prototype build passes with its existing large-chunk warning.
- Light-theme images in ignored
  `apps/mobile/src-tauri/target/prototype-long-lists/` were opened:
  `1440-conversations.png`, `1440-older-target.png`, `390-search.png`, and
  `390-empty.png`. Search text remains within the narrow rail; the older target
  is visible above the composer; empty/list content does not overlap the
  tabbar. These images do not establish full pixel parity.

The added sample is not Owner-confirmed or landed. The next subsection extends
its request/member and controlled-search coverage. Native search,
full production pixel parity, and optional physical-device performance remain
outside this prototype evidence.

### 2026-09-12 Request, Member, And Search Samples

`long-lists` now also contains 240 pending requests with explicit incoming or
outgoing direction and 240 group members. Both reuse `PrototypeListWindow`,
mount at most 100 rows, and restore query/window/identity anchors after tab or
detail return. Sample-only group mutations remain unavailable.

`search-controlled` exposes explicit loading, error, same-query Retry, results,
and empty outcomes through controls outside the device. One current ticket and
one discarded ticket carry owner/revision identity; completion from an edited,
cleared, closed, or previous search instance cannot publish into the active
view. Query and result anchors use the existing bounded Shell presentation
memory. There is no timer-driven response, Station call, or native traffic.

Integrator verification against the retained Make Portal:

- `check-residual-parity.mjs`: 40 assertions pass at 390x844 and 1440x1100;
  every request/member row is reachable, with at most 100 mounted rows.
  `apps/mobile/src-tauri/target/prototype-residual-parity/results.json`,
  produced at `2026-09-12T14:27:37Z`, records 26 light-theme captures, no browser
  errors, and no prohibited traffic.
- `check-layout.mjs`: all 48 captures at 390x844, 554x954, and 1440x1100 have
  zero geometry defects in
  `apps/mobile/src-tauri/target/prototype-layout-post-sync/captures.json`
  (`2026-09-12T14:27:33Z`). The runner now avoids clicking an already-selected
  Portal site, which previously stole sheet focus. Both Tab containment
  assertions and Escape behavior remain checked.
- `check-long-lists.mjs`: a post-integration rerun passes at all three
  viewports, traversing 240 conversations, 240 contacts, 480 messages, and 480
  search results with the existing return-anchor and live-tail assertions.
- Mobile prototype build passes; its existing large-chunk warning remains.
  Each browser runner closes its own browser and retains the Make Portal.
- Opened L2 images include residual-parity `1440-members-first.png`,
  `1440-search-loading.png`, and `390-search-error.png`, plus post-sync
  `390-member.png`. The member list remains scrollable, search retains its
  query during loading/failure, Retry is visible, and the narrow sheet keeps
  its fields and primary action inside the preview.

Frontend tree review: the existing Mobile bounded-content registry row still
governs these surfaces. Only the active tab/detail/search tree mounts
(`on-visit + none` plus bounded content); Shell memory retains presentation
metadata, not business freshness. No production lifetime or registry status
changed. Native timing, retained-history memory bounds, full pixel parity, and
Owner confirmation remain gaps.

Run the added regression against an already running Portal:

```bash
PROTOTYPE_URL=http://localhost:3262 \
node packages/prototypes/mobile/chat/scripts/check-residual-parity.mjs
```

## Acceptance Notes

- **W6A long-list sample: source/render synchronized for the covered subset.**
  Previous/Next, search paging, older-history anchors, large request/member
  collections, and controlled search loading/failure/retry now have repeatable
  prototype evidence above. These sample gaps are no longer `UNSYNCED`;
  native search and full production parity remain unproven. The existing
  baseline remains confirmed; these additions are not self-confirmed or landed.
  Prototype evidence is not native communication or AS-14 proof.
- The previously confirmed happy-path interaction remains the baseline.
- The recovery-state amendment has fresh L2/L3 evidence and was confirmed by
  the Owner on 2026-08-27.
- Prototype confirmation covers the intended flow and UI behavior only.
- Real `apps/mobile` iOS/Android runtime acceptance remains `UNPROVEN` and is
  required by `../acceptance-matrix.md` before production readiness.
- The prototype must not introduce a phone-width right drawer for conversation actions. Mobile action surfaces use bottom sheets or dedicated pages.
