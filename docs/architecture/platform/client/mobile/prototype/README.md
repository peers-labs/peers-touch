# Mobile Prototype

> **Status**: confirmed
> **Version**: v1.0
> **Created**: 2026-07-08 | **Updated**: 2026-09-13
> **Owner**: Mobile Product Team
> **Module**: `packages/prototypes/mobile/chat/`

## Scope

`mobile-chat` is the Mobile Shell baseline prototype. It is intentionally aligned with the current `apps/mobile` implementation instead of the removed single-page mobile chat mock.

The prototype covers:

- `MobileShell` primary tabs: Chat, Moments, Contacts, Settings.
- Access gate / station session context before the shell, including GitHub and
  Google OAuth progress.
- Chat list projection for Friend and Group conversations.
- Chat thread mode where the bottom tabbar is hidden and the composer owns the bottom safe area.
- Contacts toolbar actions: create group and find people, matching `ContactsPage`.
- Group creation with initial members and friend request search/send affordances.
- Moments feed/composer/reaction/comment surfaces.
- Me/profile and selected-only settings details.
- Evidence scenarios for Station identity mismatch, OAuth expiry, session
  revocation, unknown write outcome, ledger capacity, and restored drafts.

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
| Deferred/local-only affordances | MS-C11..MS-C14 / MS-PA22 / MS-PA27 |

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
- Station removal confirmation;
- Station identity mismatch;
- OAuth expired;
- session revoked;
- unknown write outcome;
- command ledger full;
- restored draft.

These controls are Prototype Portal scaffolding. Each selected state renders a
realistic product recovery surface inside the device frame.
Each state is also directly reproducible from the standalone prototype with
`?scenario=<scenario-id>`.
The default journey also includes Station removal confirmation, disabled
WeChat/call affordances, and device-only message flag copy.

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
| L3 | Deferred/local-only actions | Chat thread contains Chat/Pinned only; call and WeChat are disabled; message action reads “Flag on this device” |

### 2026-09-12 Social And Recovery Samples

The previously confirmed baseline is unchanged. The following additions express
the accepted MS-J03/MS-J04/MS-J07 failure and relationship semantics; they are
not newly confirmed or landed by this source update.

| Scenario ID | Sample |
|---|---|
| `social-unavailable` | Unavailable Chat/Contacts, lifecycle Retry with explicit pending and failure outcomes, and independently accessible Me |
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
