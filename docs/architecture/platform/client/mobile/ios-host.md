# iOS Host Architecture

> **Status**: source-complete, runtime-unproven
> **Owner**: Mobile Architecture Team
> **Updated**: 2026-10-17

## Boundary

iOS is a Host for the single Mobile Client Form. Swift adapts UIKit,
UserNotifications, BackgroundTasks, Photos, AVFoundation, and system
controllers to the same Rust-owned contract used by Android.

Swift does not own product policy, navigation, Station retries, or business
reconciliation.

## Contracts

- The signed target declares `aps-environment`; Debug and Release bind
  development and production respectively.
- `UIBackgroundModes` declares `fetch` and `remote-notification`.
- APNs success, failure, foreground receipt, tap, and background remote
  notification callbacks are normalized into the native-to-Rust drain.
- Registration failure is a typed callback, not an armed-success claim.
- BGTask identifiers are fixed. Registration, submission, rescheduling,
  expiration, and exact completion remain native mechanics; Rust owns
  generation fencing and reconciliation.
- System settings, external URL, and share use one typed system-action
  contract. UIKit types do not cross into TypeScript.
- Capability observation preserves unavailable, denied, restricted,
  unsupported, and unknown states. APNs remains `unknown` until native
  registration is confirmed.

## Evidence

The Swift adapter compiles for `arm64-apple-ios15.0-simulator`. The secure-input
package declares English as its default resource localization and its iOS
Simulator package build passes for arm64 and x86_64. This is package compilation
evidence; full signed application and physical Host proof remain unverified.

A paired physical iPhone is visible, but no dedicated source-bound Host Suite,
APNs provider configuration, or runtime manifest is available. Simulator or
source compilation does not prove APNs/background behavior, so
`unified-client-ios-host-e2e` remains `BLOCKED/UNPROVEN`.

The parent Provisioner validates a private APNs configuration file, its
development environment, bundle ID, team/key IDs and P-256 private key before
acquisition. The controlled application build must match that team and carry
development APNs entitlements in both its signature and provisioning profile,
plus the declared background modes. Provider delivery is a separate runtime
obligation.
