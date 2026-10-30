---
status: active
owner: Client Platform Team
updated: 2026-10-27
review-cadence: semiannual
next-review: 2027-04-27
related:
  - docs/client/common/ui-identity/interaction.md
  - docs/client/common/ui-identity/accessibility.md
  - docs/client/common/ui-identity/tokens.md
---

# Optimistic Commit Pattern

> Shared UI pattern for actions that confirm a local intent while the
> authoritative result is still in flight — media uploads, publishes, and
> other user commits whose server confirmation is observable.

## 1. When to use

Use this pattern when all three hold:

1. The user's intent is unambiguous and the local result can be rendered
   immediately from data the client already holds (a picked file, typed text).
2. The action reports **real** progress or a clear terminal outcome.
3. The previous value can be restored cheaply if the commit is rejected.

Do not use it for delete, block, moderation, payment, or privacy/policy
actions — those confirm server success before changing critical context
(see [interaction.md §4](../interaction.md#4-optimistic-updates)).

## 2. State machine

```text
idle
  -> local-committed   (immediate; local source rendered, old value retained as rollback)
  -> progressing       (real progress events, not timers)
  -> authoritatively-committed  (server source swapped in only after it is ready)
or -> failed           (rollback to old value + localized reason + retry)
```

Rules:

- Render the local result **immediately** on intent; never show only a spinner
  while a multi-second transfer runs.
- Keep the previous value until authoritative commit succeeds; it is the
  rollback target, not stale UI to clear early.
- Progress reflects real work (transferred bytes, staged steps). Fake
  time-based percentages and looping indeterminate bars presented as percent
  are forbidden.
- Move from local to authoritative source only once the authoritative asset
  is ready (local cache/materialization for avatars, image preload for
  banners), so the swap does not flash back to a placeholder.
- Any non-commit outcome (error, conflict, rejection, cancel) restores the
  previous value. Optimistic UI without rollback is a defect.
- Server-owned truth (policy, trust, persisted state) is shown as pending
  until the server confirms; it is never fabricated locally.

## 3. Media upload specifics

- The picker returns a local reference; preview it through the platform's
  local-asset bridge (Desktop: `convertFileSrc`), not by reading the file into
  a data URL for large media.
- Upload byte progress is emitted by the transport layer as the request body
  drains, throttled (≥2% step or ≥200ms) with a forced terminal sample.
  Backend `None`/no-listener callers keep the existing behavior unchanged.
- A long-lived visual is a **fill, not a spinner**: the picked asset is
  visible at once and sharpens/fills with progress (bottom-up reveal), so the
  user sees their actual choice instead of an abstract loader.
- Validation (type, size) happens before the optimistic preview; a rejected
  file never enters the local-committed state.

## 4. Accessibility

- The interactive surface carries `aria-busy` while committing.
- Progress is exposed as `role="progressbar"` with `aria-valuenow/min/max`,
  and an `aria-live="polite"` percentage announcement.
- These status/progress elements are **siblings** of any `role="button"`
  surface — never nested inside the button (invalid ARIA).
- With `prefers-reduced-motion: reduce`, render the committed image crisp
  immediately and express progress with a determinate bar; meaning must not
  depend on the fill animation.
- The reveal/fade uses a motion token duration and an easing role from
  [tokens.md §8](../tokens.md#8-motion-roles), never a raw millisecond value.

## 5. Verification

- Real transport: assert progress events are monotonic, sourced from actual
  request bytes, and end at `(total, total)`.
- Success path: local preview is visible before completion; the authoritative
  swap has no placeholder flash.
- Failure path: force a rejection and assert the previous value is restored
  and a localized error with retry is shown.
- Reduced motion and keyboard paths verified; no invalid nested interactive
  roles.
