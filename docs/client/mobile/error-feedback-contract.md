# Mobile Error & Sync Feedback Contract

Mobile feedback must feel like a modern native chat app: state updates in place, errors are recoverable, and routine sync never looks like a page refresh.

## Feedback Surfaces

- **Inline notice**: use `MobileNotice` for recoverable page or panel errors, such as message send failure, contact load failure, and search failure. It must be dismissible when it is not blocking input.
- **Field error**: use field-level error styling for validation tied to one control, such as Station URL or invite code input.
- **Root recovery**: use the root error boundary only for render crashes, unrecoverable runtime failures, or permission recovery that requires leaving the current screen.
- **Toast/message**: use only for short success or low-risk acknowledgement. Do not use it for errors that need retry, inspection, or dismissal.
- **Confirm**: destructive actions must use an explicit confirmation surface. Do not use a raw browser confirm.

## Error Text

- User-facing text must be readable and actionable. Never render raw objects, stack traces, endpoint paths, or `[object Object]`.
- API errors must pass through a normalizer before rendering. Prefer the domain message; include a short code only when it helps support/debugging.
- Keep the user's input and current screen state after an error. Do not clear composer text, selected attachments, or search text on failure.
- Provide a close/dismiss affordance for non-blocking errors.

## Sync & Loading

- Existing lists must update in place. Do not show full-panel loading masks over already-rendered chats, contacts, messages, or notifications.
- Use full-panel loading only for an empty first load.
- Background sync should preserve scroll position, input focus, and list item identity.
- A manual refresh button is a fallback action, not the normal sync model.

## Implementation Rules

- Mobile app pages should import `MobileNotice` from `apps/mobile/src/components/MobileNotice.tsx` for inline recoverable errors.
- Store/API errors should be normalized before they enter UI state.
- `Spin` or equivalent loading overlays must be gated by both `loading` and an empty rendered collection.
- New mobile features must state which feedback surface they use before implementation.

## Why Previous Code Drifted

The existing repository had only broad UI identity guidance and page-specific implementations. Chat, Contacts, Moments, Station, and the root recovery screen each chose their own feedback mechanism, so generated code followed nearby local patterns instead of a platform contract. This document and `MobileNotice` are the mobile-level contract that future work must follow.
