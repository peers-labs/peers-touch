# Mobile Prototype

> **Status**: drafting
> **Module**: `packages/prototypes/mobile/chat/`
> **Updated**: 2026-07-08

## Scope

`mobile-chat` is the Mobile Shell baseline prototype. It is intentionally aligned with the current `apps/mobile` implementation instead of the removed single-page mobile chat mock.

The prototype covers:

- `MobileShell` primary tabs: Chat, Moments, Contacts, Settings.
- Access gate / station session context before the shell.
- Chat list projection for Friend and Group conversations.
- Chat thread mode where the bottom tabbar is hidden and the composer owns the bottom safe area.
- Contacts toolbar actions: create group and find people, matching `ContactsPage`.
- Group creation with initial members and friend request search/send affordances.

## Source Alignment

| Prototype surface | Product source |
|---|---|
| Shell tabs and tabbar badge behavior | `apps/mobile/src/components/MobileShell.tsx` |
| Chat list, thread, action surface boundaries | `apps/mobile/src/pages/ChatPage.tsx` |
| Friend conversation projection | `apps/mobile/src/features/social/socialProjection.ts` |
| Group conversation projection | `apps/mobile/src/features/group/groupProjection.ts` |
| Find people and create group | `apps/mobile/src/pages/ContactsPage.tsx` |
| Access gate launch state | `apps/mobile/src/App.tsx`, `apps/mobile/src/features/auth/AccessGateHost.tsx` |

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

## Acceptance Notes

- This prototype is `drafting`; it is visible for review but not yet `confirmed`.
- L2 visual evidence is still required before changing readiness beyond `drafting`.
- The prototype must not introduce a phone-width right drawer for conversation actions. Mobile action surfaces use bottom sheets or dedicated pages.
