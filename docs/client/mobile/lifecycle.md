# Mobile Client Lifecycle

> Mobile platform lifecycle source. This document defines the Mobile lifecycle that must stay top-level symmetric with Desktop while respecting mobile-specific Station selection, foreground/background behavior, and native capability boundaries.
>
> Signed Station identity, pre-session auth runtime, executable dependency
> graph, and generation-fenced teardown were accepted with the Mobile
> PRODUCT/DESIGN package on 2026-08-27.

---

## 1. Purpose

Mobile is a Tauri v2 Mobile client composed of:

- `mobile-app`: iOS/Android native Tauri shell.
- `mobile-web`: React renderer and mobile-first UI.
- `mobile-rust`: Rust capability kernel and Tauri command owner.
- `native-plugins`: system capabilities such as secure storage, push, deep link, camera, and background tasks.
- `station`: remote business source of truth.

This document defines the lifecycle across those units. It does not redefine:

- Mobile platform baseline, owned by [`base.md`](./base.md).
- Native plugin boundaries, owned by [`native-dual-platform.md`](./native-dual-platform.md).
- Sync mechanics, owned by [`sync-protocol.md`](./sync-protocol.md).
- Access gate architecture, owned by [`../../architecture/platform/station/access/station-access-gate-architecture.md`](../../architecture/platform/station/access/station-access-gate-architecture.md).

---

## 2. Lifecycle Phases

| Phase | Entry Trigger | Owner | Exit Condition |
| --- | --- | --- | --- |
| `app-boot` | Native app starts | `mobile-app` + `mobile-rust` | WebView, storage, language, and capability guards are ready |
| `station-selection` | No active Station or user changes Station | Station onboarding feature | A reachable Station is selected |
| `station-handshake` | Active Station selected | Station runtime | Signed `station_peer_id` and compatible capabilities are verified |
| `access-gate-chain` | Station handshake passes | Access runtime + pre-session auth runtime | Station returns `access_granted`; any session candidate remains inactive before grant |
| `runtime-critical` | Access is granted | Runtime registry | PTID session binds and critical projections bootstrap |
| `shell` | Critical runtime bootstrap completes | Mobile shell | Chat/contacts/mine shell becomes visible |
| `steady-foreground` | App is foregrounded | Owning runtimes | Event stream and reconciliation keep projections fresh |
| `background` | App enters background | Native lifecycle + runtimes | Streams pause or downgrade; push/background tasks take over |
| `resume` | App returns foreground | Session + sync runtimes | Session and Station are revalidated; delta sync completes |
| `station-change` | User changes Station | Station/session runtime | Old session and projections are cleared; auth gate restarts |
| `logout` | User logs out | Session runtime | Secure session is cleared; auth gate restarts |

---

## 3. Standard Flow

```text
mobile app boot
  -> load language + WebView guards + native capability ports
  -> load Station registry
  -> station-selection if no active Station
  -> signed station-handshake and peer-ID pin check
  -> access-gate-chain
     -> session restore / login gate
     -> invite / allowlist gate
     -> device / policy gates
  -> bootstrap critical runtimes
  -> enter shell
  -> foreground event + reconcile loop
```

The user must not enter the Station shell without passing the Station-driven access gate chain. Selecting a Station is not the same as being admitted into it.

---

## 4. Gate Contracts

### 4.1 Station Selection

- The Station list is a target selector, not a navigation list.
- Tapping an existing Station selects the target to enter; it does not refill the input and does not immediately enter.
- Adding a Station is secondary once at least one Station exists.
- Station reachability must be checked automatically, not left as unexplained `unverified` UI.

### 4.2 Station Handshake

- Reachability is diagnostic only. The entry gate verifies a fresh
  challenge-signed `station_peer_id`, canonical origin, protocol compatibility,
  auth endpoint availability, and required capabilities through `mobile-rust`.
- The explicit first-add action pins the peer ID. A known URL returning another
  identity is blocking and requires explicit Station replacement.
- Production credentials and OAuth require TLS. HTTP is limited to an explicit
  development profile, is visibly marked, and cannot establish production trust.
- Debug native Messaging accepts the exact profile origin injected through
  `PT_MOBILE_DEV_STATION_ORIGIN`. Simulator launches forward it with
  `SIMCTL_CHILD_PT_MOBILE_DEV_STATION_ORIGIN`; it is not saved in app preferences.
  Production Release builds ignore this permission and require HTTPS. A
  self-contained Release built with the explicit `acceptance-harness` feature
  keeps development-origin policy so the installed simulator artifact can use
  its declared HTTP Station profile without a debug server. An unrelated host,
  port, credential-bearing URL, or non-root path remains rejected.

### 4.3 Access Gate Chain

- Login is one gate in the chain, not the whole gate model.
- Email/OAuth credential acquisition belongs to station-scoped `authRuntime`;
  active session ownership begins only after final access grant.
- A login/OAuth response produced before a later invite/device/policy gate
  completes remains an attempt-scoped candidate and cannot call business APIs.
- Station owns gate order, pass/fail semantics, and final access decision.
- Invite-only and fixed-user gates are managed in Station Dashboard, not Mobile.
- Auth session secrets must be stored through native secure storage, not plain `localStorage`.
- A session is scoped to the active Station. Switching Station invalidates the current session unless an explicit multi-Station session model is introduced.
- The main shell must not hide login in Settings as the only entry point.
- `entryRuntime` owns the app-scoped Station probe, remembered-account readback,
  gate submission and explicit scope-exit decision projection. AppRoot observes
  it and dispatches actions; it contains no asynchronous entry state machine.
  Access revisions fence late handshake/submission results after Back. Registry
  probes only update an entry that still has the same Station identity and URL.
- Identity replacement requires an explicit decision before either the Add or
  Continue path persists a replacement. Scope exit fences command admission
  before asking about real drafts. An exit with no drafts proceeds directly;
  cancellation restores admission without changing the active account.

---

## 5. Runtime Rules

- Station owns cross-device business truth.
- `mobile-rust` owns native-safe capability calls, secure storage ports, network reachability checks, and plugin bridges.
- `mobile-web` owns rendering and local projections.
- Pages render projections and user actions; long-lived freshness belongs to runtimes.
- Runtime dependencies use hard `dependsOn` and degradable `uses`; bootstrap is
  topological and teardown/suspend use reverse order.
- The native `security` runtime precedes Auth. Its optional application PIN is
  scoped to Station and actor, stored as an Argon2id verification hash in OS
  secure storage, and required on cold start and background return. Credentials
  remain in the native OAuth/Keychain owner. PIN attempts and five-minute
  cooldown survive relaunch; the renderer cannot access the security namespace.
  Forgotten PIN creates a ten-minute native reset request, retains drafts and
  enters the existing Station reauthentication flow. Only a new verified login
  for the same Station and actor removes that PIN; another account or an expired
  request cannot reset it.
- Interactive runtime gates separate bounded I/O from user decisions. The
  Kernel awaits `descriptor.userGate.wait()` after bootstrap/resume I/O and
  before marking the runtime ready or admitting dependents. A user decision has
  no infrastructure deadline. Stop, restart and scope transition cancel the
  outstanding gate before joining the serialized lifecycle queue. The PIN host
  only presents the security projection and sends verification intent.
- Native signed-device identity acquisition completes pending Actor Device
  enrollment before returning a signer. Enrollment, signer acquisition, and
  stale-enrollment recovery share one engine lock and the Session device ID.
  Private Social can acquire its signer during asynchronous login activation
  without waiting for unrelated Messaging inbox or media reconciliation.
- Cold start, restart, and resume resolve the launch state through the lifecycle
  kernel after runtime bootstrap/revalidation. React does not auto-advance a
  restored access decision; the kernel preserves the handshake transition before
  displaying a pending gate.
- Auth publishes a new session and its access decision atomically. Only a final
  grant with an active session clears the Auth-owned expired-session recovery
  flag; pending gates and unrelated recovery states remain unchanged.
- Failed bootstrap descriptors and dependency-skipped descriptors are not
  resumable instances. Resume fences the generation, tears down the old graph
  in reverse order, and rebuilds it topologically. Incomplete cleanup blocks the
  rebuild. The failed-capability Retry action delegates to that same lifecycle
  restart owner; it does not bootstrap a feature from its page.
- Asynchronous session activation publishes pending/ready/failed readiness into
  the kernel through an immutable generation-bound context. Readiness tickets
  are allocated when work is queued and fenced by descriptor incarnation,
  latest task revision, and the admitted Station/PTID/credential scope. Bootstrap and session
  callbacks share one serial task path. Session tasks wait for their declared
  hard dependencies before starting domain work; failed prerequisites reject
  admission, and suspended or superseded waiters are released. Readiness deadlines are bounded and
  released on settlement, replacement, suspension, and teardown.
- Resource lifecycle status remains separate from effective availability.
  Route, recovery, and public snapshot readers derive availability from the
  runtime's own readiness and existing hard dependencies. A dependency failure
  does not overwrite another runtime's own readiness or remove live resources
  from reverse suspend/teardown. Failed async activation participates in the
  existing resume rebuild policy.
- Foreground uses event streams when available.
- Background uses push, background tasks, or deferred sync according to platform constraints.
- Resume must treat projections as stale until delta sync or reconciliation has completed.

---

## 6. Edge Handling

| Edge | Required Behavior |
| --- | --- |
| Cold start with no Station | Show Station selection |
| Cold start with Station but no session | Validate Station, then render the current access gate |
| Cold start with Station and session | Restore session, run the remaining gate chain, then enter shell only when access is granted |
| Station unreachable | Stay before auth/shell; show retry and change Station actions |
| Station identity mismatch | Block before credentials; preserve old scope; offer back or explicit replacement |
| Login failure | Stay in the login gate; keep Station selected |
| Invite/allowlist blocked | Stay in access gate chain; show Station-provided denial/retry actions |
| Station change | Fence old generation, hide projections, clear local credentials/caches, quarantine unresolved commands, return to selection |
| Logout | Fence old generation and delete local credentials; remote revoke is bounded best-effort; restart access gate chain |
| App background | Pause expensive streams; keep minimal native hooks |
| App resume | Revalidate Station/session and run delta sync |
| Push received | Store or route event through native plugin into runtime; do not mutate UI directly from plugin code |

---

## 7. Symmetry With Desktop

Mobile and Desktop share the same lifecycle intent:

```text
boot -> station/identity gate -> access gate chain -> runtime bootstrap -> shell -> steady reconcile
```

The difference is platform responsibility:

| Concern | Mobile | Desktop |
| --- | --- | --- |
| Station selection | First-class onboarding gate | Usually profile/account context |
| Local capability owner | Rust capability kernel + native plugins | `desktop-rust` local application runtime |
| Access gate chain | Required before Station shell | Required before actor-bound business runtime |
| Foreground freshness | Event stream + reconciliation | SSE/stream + reconciliation |
| Background freshness | Push/resume delta sync | Window/process resume reconciliation |
| Secure storage | Native secure storage plugin/command | Desktop secure local storage/keychain equivalent |

---

## 8. Current Implementation Gap

Current Mobile code now implements the local owner layer of this lifecycle:

- `MobileLifecycleKernel` owns
  `app-boot -> station-selection -> station-handshake -> access-gate-chain ->
  runtime-critical -> shell`; `App.tsx` renders that projection and dispatches
  transition intents.
- The descriptor-backed Mobile navigation store owns primary, Chat/Group,
  Contact, Moment, and selected Settings detail route identity plus the
  selected-only Find People and Create Group overlays. Domain selection fields
  remain projection readback context and no longer decide route or overlay
  visibility.
- The Shell route boundary consumes each descriptor's runtime owner status.
  A failed or missing owner renders unavailable content rather than an empty
  domain projection; a starting owner shows preparation. Tab and detail-back
  navigation remain available, and retry belongs to the lifecycle recovery host.
- `MobilePageHost` composes only the selected page/detail tree. `MobileShell`
  subscribes to navigation, authentication and scalar Chat/Contacts badges;
  `navigationBadgeProjection` derives those counts from the existing Social
  projection without another store, reconciliation loop or domain-list
  subscription in the shell.
- Global Chat search is an explicit intent over the existing native message
  index, combined with accepted Contacts and conversation projections. Native
  IPC concurrency is bounded, account changes fence results, and pagination
  retains each conversation's timestamp/message cursor. Recent queries use
  the actor-scoped device preference repository. Selecting a message result
  routes to its conversation and hydrates/reveals that message.
- Me renders identity and counters from the existing profile and Social
  projections. It does not instantiate settings controllers or query native
  permissions/version metadata. The selected Settings detail is a lazy
  section; only its Profile, device, notification, permission or version
  dependencies subscribe/load. A shared `SettingsExitBoundary` protects Back,
  route changes and provider selection with save/discard/stay. Profile drafts
  emit only edited fields. Native transport retains explicit empty clearing
  and multiline biographies; Station remains the field-policy owner.
- Agent provider settings use generated protobuf requests through a native
  fixed capability whitelist at `/sub-agent/agent/*`. Station owns provider
  versions and credentials; the section controller owns only the selected
  editor draft and cancels read requests on unmount. Writes read back the
  stable provider identity before success or retry. API keys are never saved
  in client preference/draft repositories or read through credential resolve.
  Available-model refresh is an explicit read of Station admission metadata,
  not proof of a remote model invocation.
- General settings compose the existing device, language, Profile and
  notification owners with a selected Agent defaults editor. Agent provider,
  model and reasoning changes preserve unrelated Agent fields and use the
  Station versioned update contract. Independently committed owners retain
  their actual result when another owner fails. The app theme provider reads
  only committed device preferences; component-library tokens and CSS surfaces
  share light/dark/system state. Storage is an independent detail attached to
  the Chat Storage runtime. A detail scroll container preserves the header and
  safe area while the selected form or long list scrolls.
- Inline and full-thread replies share the same logical message collection.
  Avatar identity disclosure, pins and composers use shared component
  boundaries; typing publication remains ephemeral and cannot add a sender
  status row or delay durable submission.
- Login is rendered by the top-level access gate host instead of Settings;
  full native gate-chain evidence remains pending.
- Invite-only and fixed-user gates consume the shared Station gate protocol.
- Signed peer identity/capability handshake is implemented; physical
  mismatch/replacement evidence remains pending.
- Pre-session auth/OAuth restoration and runtime graph ownership are
  implemented. The Station-bound simulator path now covers restore,
  same-client-class takeover across distinct Mobile installations, revocation,
  Station switching, logout, and old-scope
  isolation through parent-owned Runtime Binding and Fixture operations;
  destructive current-source proof still requires explicit reset
  authorization.
- The session-scoped Social descriptor owns one realtime supervisor and bounded
  ingress for Social, Moments, notification, and profile projections. Chat
  frames become Messaging wake intents. The session-scoped Messaging descriptor
  alone owns Direct/Group conversations, settings, materialized messages,
  command outcomes, and E2EE freshness; Chat Storage depends on that owner.
  Suspend stops foreground producers and closes write admission; resume
  revalidates and reconciles stale projections before reopening writes;
  teardown drains accepted work and releases page-independent projections.
  Each Social controller owns the cancellation scope used by its Social,
  Moments, notification, and profile network requests. Suspend aborts that
  foreground's requests; resume allocates a fresh signal; teardown permanently
  closes the scope before awaiting startup, ingress, or reconciliation.
  Foreground shutdown drains only operations captured from the stopped
  foreground, so a concurrent resume's new realtime stream cannot keep the old
  shutdown alive. Same-account credential refresh preserves projected data
  while rebinding gateways to the current request scope.
- Moments feed and Profile/account preference freshness are runtime-owned and
  survive page unmounts. Pages subscribe to the active session projection and
  do not create ingress, gateway, or reconciliation owners.
- The app-level recovery host delegates Station/session actions back to the
  lifecycle and auth owners. W5 ingress staleness and write admission now feed
  that projection. W4 draft/ledger/reconcile/reset actions invoke production
  Rust/runtime owners, and the Acceptance Harness exposes only sanitized
  projections; physical recovery UI proof remains pending.
- Keychain/Keystore and Rust OAuth secure storage pass simulator evidence;
  physical-device cleanup and absence proof remain pending.

---

## 9. Verification

Account recovery uses the native Recovery application service. A selected
Security section requests only generated action/result protobufs. The native
plugin displays or collects the 24-word phrase; WebView state, diagnostic logs
and Station never receive it. Recovery records live in the protected native
security namespace. Each backup also installs the Secure Content recovery
master for the same actor and epoch.

Restore validates the current native Session again after user input, authenticates
the encrypted archive, checks the Station authority chain for later redactions,
stops the Messaging worker, and imports history in one SQLCipher transaction.
For the same actor identity, existing devices, sessions, authority heads,
commands and drafts remain current. An unenrolled fresh installation replaces
its temporary actor identity and imports history atomically before enrollment.
The lifecycle graph then rebuilds current projections through its normal owner.

Before changing Mobile lifecycle behavior, verify:

- `cd apps/mobile && pnpm run check:web`
- `cd apps/mobile/src-tauri && source ~/.cargo/env && cargo check`
- `cd apps/mobile && pnpm run tauri:ios:dev`

Functional verification must cover:

- first launch with no Station;
- existing Station automatic validation;
- pinned Station peer mismatch and explicit replacement;
- Station add and cancel;
- Station switch clears current auth state;
- access gate chain appears before shell;
- login success enters shell;
- invite/allowlist denial blocks shell consistently;
- logout restarts access gate chain;
- app resume revalidates Station/session.
- OAuth callback followed by another gate does not activate business runtimes;
- secure credential deletion failure blocks the next Shell generation.
