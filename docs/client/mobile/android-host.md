# Android Host Behavior

> **Status**: source-complete, runtime-unproven
> **Updated**: 2026-10-17

Android refines the shared Mobile product with native system behavior:

- system Back closes the active overlay, then the active detail route, and
  leaves the app only from a root tab;
- notification, camera, microphone, photo, document, background execution,
  sharing, and app-settings availability are shown through typed capability
  facts;
- denied, unavailable, restricted, unsupported, and unknown are distinct;
- camera and picker results retain full-resolution content;
- push and background wakeups reconcile shared runtime owners before their
  projections are treated as current.

No Android-specific business store, route tree, or product retry policy exists
in the React layer. Missing FCM configuration or physical-device proof keeps
the corresponding capability blocked rather than presenting a false success.
