# Mobile Prototype

> **Status**: confirmed
> **Version**: v1.0
> **Created**: 2026-07-08 | **Updated**: 2026-08-27
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

## Acceptance Notes

- The previously confirmed happy-path interaction remains the baseline.
- The recovery-state amendment has fresh L2/L3 evidence and was confirmed by
  the Owner on 2026-08-27.
- Prototype confirmation covers the intended flow and UI behavior only.
- Real `apps/mobile` iOS/Android runtime acceptance remains `UNPROVEN` and is
  required by `../acceptance-matrix.md` before production readiness.
- The prototype must not introduce a phone-width right drawer for conversation actions. Mobile action surfaces use bottom sheets or dedicated pages.
