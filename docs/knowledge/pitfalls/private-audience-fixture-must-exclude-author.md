---
kind: pitfall
title: Explicit private audience fixtures exclude the author
status: active
owns:
  - tooling/development/secure_content/runtime_owner.py
related:
  - docs/architecture/shared/security/secure-content/design.md
  - apps/station/app/subserver/social/domain/audience.go
  - apps/desktop/src-tauri/src/social/private_moment.rs
detected: 2026-11-16
---

# Explicit private audience fixtures exclude the author

## Symptom

AS18 successfully published and read FOLLOWERS, CIRCLE and GROUP content but
its CUSTOM_ALLOW publication failed before prepare with
`private Moment audience actor list is invalid`.

## Root cause

The Native fixture put both the local author and the remote recipient in the
explicit allow list. The author already has its implicit grant. The canonical
Native and Station author-bound validators reject author self-inclusion in
CUSTOM_ALLOW and CUSTOM_DENY.

## Mitigation

AS18 lists only the remote recipient while retaining both the local author and
remote recipient readback assertions. The original validators, audience cases,
unsupported-PUBLIC denial and Suite resource budget remain in place.

## How to detect a recurrence

Run the original social-private-desktop-e2e selection through the shared
Acceptance runner. Its AS18 matrix must publish every accepted audience and
read each publication on both original clients. Review new explicit audience
fixtures against `ValidateForAuthor`; a local author observation does not
require inserting the author into the explicit recipient list.
