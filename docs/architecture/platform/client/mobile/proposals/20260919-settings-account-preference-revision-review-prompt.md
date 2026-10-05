# MS-D22A Review Prompt

Review:

`docs/architecture/platform/client/mobile/proposals/20260919-settings-account-preference-revision-amendment.md`

## Review Boundary

Resolve the remaining W6C Settings contract without creating a generic
Settings owner, a local fallback truth, or optional revision semantics.

## Required Questions

1. Does current product scope name any additional cross-device account field
   not already owned by Actor Profile, Notification, Social, or
   `deviceSettingsRuntime`?
2. Should current MS-C09/MS-P05/W6C remove the separate account-preference
   service requirement, or which exact fields must a new service own?
3. Is the legacy `ActorPreferences` DTO correctly rejected as a public API?
4. Should one Profile revision cover both `touch_actor` and
   `touch_actor_meta` updates transactionally?
5. Should Notification revisions be per category?
6. Must stale writes return the latest canonical snapshot without mutation?
7. Must Profile and Notification revision enforcement cut over Desktop and
   Mobile together, with no optional-revision compatibility path?
8. Are write-response loss and stale revision visibly distinct from saved,
   unavailable, and ordinary validation failure?
9. Does Social blocked-user consumption remain exclusively runtime/store-owned?
10. Do W6C-PROOF second-device cases prove shared revisions while device
    preferences remain local?

## Review Outcome

**Verdict**: `ACCEPT MS-D22A A + CAS`

**Accepted**: 2026-09-19

The accepted amendment incorporates the review corrections:

- no separate account-preference owner or placeholder product section;
- one dedicated Profile revision over editable profile/privacy state;
- one aggregate Notification preference revision with an atomic batch write;
- selected-owner-only Settings saves;
- a Desktop + Mobile + Station hard cut with no optional revision;
- typed applied/unchanged/conflict outcomes, canonical snapshots, and
  lost-response reconciliation.
