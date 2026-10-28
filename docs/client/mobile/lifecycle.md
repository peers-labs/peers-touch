# Mobile Client Lifecycle

> **Status**: active
> **Version**: v2.0
> **Updated**: 2026-10-16
> **Owner**: Mobile Architecture Team

---

## 1. Scope

This document defines the top-level Mobile lifecycle across:

- shared Mobile presentation;
- Mobile Rust runtime;
- Android and iOS hosts;
- native capability plugins;
- Station access, session, and runtime projections.

Related owners:

- platform baseline: [base.md](./base.md)
- native capability boundary: [native-plugin-layer.md](./native-plugin-layer.md)
- synchronization: [sync-protocol.md](./sync-protocol.md)
- Station access: [Station Access](../../architecture/platform/station/access/README.md)

## 2. Runtime Units

```text
Mobile presentation
  apps/mobile/src/

Mobile Rust runtime
  apps/mobile/src-tauri/src/

Platform hosts
  apps/mobile/src-tauri/gen/android/
  apps/mobile/src-tauri/gen/apple/

Native capability plugins
  apps/mobile/src-tauri/plugins/

Shared business authority
  Station
```

## 3. Lifecycle Phases

| Phase | Owner | Exit condition |
|---|---|---|
| `app-boot` | platform host + Mobile Rust | WebView, local state, and required capability observations initialized |
| `station-selection` | Station onboarding runtime | target Station selected |
| `station-handshake` | Station runtime | signed Station identity and protocol compatibility verified |
| `access-gate-chain` | Station access + auth runtime | final access grant and admitted session |
| `runtime-critical` | lifecycle kernel | critical dependency graph ready |
| `shell` | Mobile presentation | product shell visible |
| `steady-foreground` | owning runtimes | events and reconciliation maintain projections |
| `background` | host lifecycle + runtimes | writes fenced; streams suspended or downgraded |
| `resume` | lifecycle kernel | Station/session revalidated and required reconciliation complete |
| `scope-change` | lifecycle kernel | old generation torn down before new Station/actor scope starts |
| `logout` | session runtime | credentials and actor-scoped resources cleared |

## 4. Standard Flow

```text
app boot
  -> observe host capabilities
  -> load Station registry
  -> select Station when needed
  -> verify signed Station identity
  -> run Station-owned access gate chain
  -> admit PTID session
  -> bootstrap critical runtimes in dependency order
  -> show shell
  -> consume events and reconcile
```

Station selection, reachability, authentication, and access grant are distinct
states. The shell is unavailable until final access grant and critical runtime
readiness.

## 5. Station and Access Rules

- Station identity is pinned by signed `station_peer_id`, not by URL alone.
- Identity mismatch blocks before credential use.
- Login is one action inside the Station-owned access gate chain.
- Candidate credentials remain attempt-scoped until final grant.
- Session secrets use secure storage and never plain Web storage.
- A session is scoped to Station, PTID, credential, device, and lifecycle
  generation.
- Station replacement or actor change starts a new generation.
- Reachability is diagnostic only. Entry verifies signed Station identity,
  canonical origin, protocol compatibility, access availability, and required
  capabilities through Mobile Rust.
- The explicit first-add action pins the peer ID. A known URL returning another
  identity is blocking and requires explicit Station replacement.
- Users may select a canonical `http://` or `https://` Station or Relay origin.
  HTTPS keeps ordinary certificate validation; HTTP remains an explicit
  transport choice and does not weaken signed identity, route attestation,
  access gates, or credential handling.
- Development and acceptance Simulator runs do not read a launch-time Station
  environment variable. The acceptance provisioner resolves the Station origin
  from the active reviewed deploy profile and binds it through the same
  identity-verified harness Station-add flow used for a manual add
  (`apps/mobile/src/acceptance/actions.ts`, provisioner profile keys such as
  `PT_MOBILE_DIRECT_STATION_URL`); the app never reads a `*_DEV_STATION_ORIGIN`
  variable and no Simulator `SIMCTL_CHILD_*` forwarding exists.
- Canonicalization in `normalize_station_origin`
  (`apps/mobile/src-tauri/src/station_origin.rs`) lowercases the host and
  produces `http(s)://host:port/`, using port 80 or 443 when omitted. Any
  non-HTTP(S) scheme, embedded credentials, non-root path, query, fragment,
  missing host, or invalid port is rejected.

## 6. Runtime Graph Rules

- Runtimes declare hard dependencies and degradable capability uses.
- Bootstrap follows topological order.
- Suspend and teardown follow reverse dependency order.
- Failed or skipped descriptors are not resumable instances.
- Async callbacks are fenced by descriptor incarnation, task revision, Station,
  PTID, credential, device, and lifecycle generation.
- Incomplete teardown blocks rebootstrap.
- Pages do not install event ingress, retry loops, or freshness owners.

## 7. Foreground, Background, and Resume

### Foreground

- After native callback registration, read the current OS lifecycle state from
  the same Android/iOS plugin. Rust admits that sequence-fenced observation
  before dependent private reads and initial network observation. Registration
  alone cannot establish foreground state; a cold start or WebView replacement
  may have occurred before the listener existed.
- Initial observation is a capability fact, not a business resume transition.
  Unknown host state remains closed. Subsequent foreground/background callbacks
  continue through the original generation and reconciliation owners.
- event streams maintain low-latency freshness;
- periodic or triggered reconciliation repairs missed events;
- writes pass through bounded runtime admission;
- presentation consumes runtime projections.

### Background

- mutation admission closes before suspension;
- expensive streams stop or downgrade;
- OS push/background callbacks become wakeup facts;
- native plugins do not mutate business state;
- accepted work drains or becomes explicitly unresolved.

### Resume

```text
host resume
  -> fence stale callbacks
  -> revalidate Station and session
  -> mark affected projections stale
  -> reconcile required owners
  -> reopen writes
  -> publish ready projection
```

Resume never treats cached projection state as current before reconciliation.

The Social descriptor records the complete admitted session identity of its
controller: Station, Actor, device, authentication generation and session ID.
After Session resume, it reuses the controller only when that identity matches.
A change observed while the old readiness context was fenced cannot authorize
resuming the old controller; teardown and drain precede creation under the new
context. Registry session transitions use that same complete identity.

Private Social may retain its Native engine across a same-session projection
fence. Successful scope-fenced reconciliation must republish the engine's
original Station/Actor/device/generation/activation metadata with its fresh
projection. Spreading the empty fenced snapshot cannot leave `active=false`
or zero identity fields after readiness succeeds. Failed or superseded
reconciliation must not republish that identity or protected content.

If Messaging reconciliation fails while the OS network remains connected,
the existing Social foreground reconciliation interval retries only Messaging
failures reported by its current readiness owner, before repairing dependent
Social projections. Healthy Messaging skips that periodic native call. A failed
retry keeps writes closed; only the original scope-fenced Messaging success and
successful projection repair reopen admission. This path creates no retry timer,
alternate readiness state, or replay of business mutations.

Moments repair treats an original Private Runtime tombstone as a successful,
payload-free deleted detail. Its Gateway must validate the current session and
Native activation before reading that terminal projection; it must not invoke
the content read that the original owner has already closed. Unavailable reads
and stale scopes still fail repair and keep admission closed.
An original typed `NOT_FOUND_OR_NOT_AUTHORIZED` read maps to a payload-free
hidden detail. This is successful authority readback, not a transport failure:
it does not fetch comments or infer deletion, and the original private
projection remains denied. Authentication, recovery and integrity failures
remain unavailable.

## 8. Scope Change and Logout

Station change, Station replacement, actor change, session revocation, and
logout must:

1. close new write admission;
2. fence the current generation;
3. stop ingress;
4. drain or classify accepted work;
5. tear down runtimes in reverse order;
6. clear or quarantine scoped credentials, ledgers, drafts, caches, and native
   resources according to owner policy;
7. start the next gate flow only after cleanup completes.

No old-scope callback may enter the new generation.

## 9. Capability Integration

```text
OS event/status
  -> native plugin
  -> Mobile Rust CapabilityFact
  -> runtime AdmissionProjection
  -> presentation
```

Capability availability and lifecycle behavior are release-target specific.
Android and iOS must feed the same Mobile projection contract without hiding
unsupported or unknown states.

## 10. Failure Behavior

| Failure | Required behavior |
|---|---|
| No Station | show Station selection |
| Station unreachable | remain before access; offer retry/change |
| Station identity mismatch | block credentials and require explicit replacement |
| Access pending or denied | remain in gate chain with Station-provided state |
| Session revoked | fence generation, clear actor projection, return to access |
| Runtime dependency failure | expose owner-specific unavailable/retry projection |
| Secure storage unavailable | fail closed for protected session/write capability |
| Background interruption | reconcile before write admission reopens |
| Unknown write outcome | preserve unresolved state; never auto-replay a non-idempotent write |
| Late native callback | reject by generation/request identity and clean resources |

## 11. Desktop Symmetry

Desktop and Mobile share this lifecycle intent:

```text
boot -> Station/identity -> access -> runtime bootstrap -> shell -> reconcile
```

They differ in host and presentation policy. Desktop evidence cannot prove
Mobile, and iOS evidence cannot prove Android.

## 12. Verification

Shared source checks:

```bash
pnpm mobile:check
```

Lifecycle support claims additionally require source-bound native evidence for
every required Android and iOS cell. The canonical matrix is
[Mobile Acceptance Matrix](../../architecture/platform/client/mobile/acceptance-matrix.md).
