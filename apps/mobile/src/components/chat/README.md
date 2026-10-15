# Mobile message presentation

These shared components implement the message anatomy in
`docs/client/chat/chat-ux-contract.md` and the Mobile adaptation in
`docs/client/mobile/chat-layout-contract.md`.

- `MessageAuthor` discloses actor identity from the avatar.
- `InlineMessageReplies` renders the owning message projection's reply collection.
  It shows ten replies initially and traverses expanded content through `BoundedList`.
- `PinnedMessageCarousel` preserves the selected pin across membership changes and
  supports native swipe, keyboard arrows, and message navigation.

Components receive display projections and intent callbacks. They do not own
Messaging, Station requests, persistence, or reconciliation.
