# Applet Runtime Design Validation Matrix

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-06-06 | **Updated**: 2026-06-06
> **Owner**: Architecture Team
> **Scope**: Design-level validation of Peers-Touch applet capabilities against WeChat Mini Program capability domains plus Peers-Touch-specific requirements

---

## 1. Purpose

This document tests the applet runtime **design itself**.

The goal is not to claim implementation readiness. The goal is to prove that the design has been exercised against a mature mini-program capability model, then adapted to Peers-Touch's own constraints:

- personal-device-first runtime;
- decentralized / federated Station model;
- no dependency on a centralized WeChat-like platform;
- producer-selected development tools;
- Host-enforced capability gateway;
- cross-host runtime: Desktop, Android, iOS, HarmonyOS reserved, Web Host.

Design validation is complete only when every required capability has:

1. a WeChat capability reference;
2. an explicit Peers-Touch decision: adopt / adapt / reject / defer;
3. an owning Peers-Touch domain;
4. a sandbox scenario;
5. a pass/fail criterion;
6. a blocking gap if the current design cannot support it.

---

## 2. Validation Method

AI and human reviewers must use this flow:

```text
WeChat mature capability domain
  → Is this needed in Peers-Touch?
  → If no: record why it is WeChat-specific or out of scope
  → If yes: map to Peers-Touch SDK / Host / Station / Gateway
  → Run a sandbox scenario
  → Mark PASS / PARTIAL / FAIL
  → Convert FAIL/PARTIAL into contract, SDK, runtime, gateway, or service work
```

No capability is considered "covered" by naming it. It is covered only when the sandbox scenario can be explained end to end.

### Status Values

| Status | Meaning |
|--------|---------|
| `PASS_DESIGN` | The design has a clear owner, API shape, runtime path, gateway policy, and failure semantics |
| `PARTIAL_DESIGN` | The design direction is clear, but an owner/API/policy/failure path is missing |
| `FAIL_DESIGN` | The design cannot support the scenario or has contradictory boundaries |
| `REJECTED` | Intentionally not part of Peers-Touch; reason must be explicit |
| `DEFERRED` | Needed later, but excluded from first release with a gating condition |

---

## 3. Capability Coverage Matrix

### 3.1 Runtime Foundation

| WeChat Reference | Peers-Touch Decision | Peers-Touch Capability | Owner | Status |
|------------------|----------------------|------------------------|-------|--------|
| Base library injection | Adapt | Host injects SDK runtime context / BridgeAdapter | Runtime Host + SDK | `PARTIAL_DESIGN` |
| Logic/view separation | Adapt | ReactLynx applet source runs through Lynx runtime; Host owns bridge and lifecycle | Runtime Host | `PASS_DESIGN` |
| App/Page/Component constructors | Reject shape, keep lifecycle | ReactLynx replaces Page/Component; SDK provides lifecycle hooks | SDK + ReactLynx applet | `PASS_DESIGN` |
| `setData` data channel | Reject shape, keep principle | ReactLynx state/rendering; Host boundary remains Bridge-only | ReactLynx runtime | `PASS_DESIGN` |
| Component event model | Adapt | SDK events + ReactLynx events + Host event bridge | SDK + Runtime Host | `PARTIAL_DESIGN` |
| Runtime simulator | Adopt principle | `packages/applet-runtime-simulate` | Tooling + SDK | `PARTIAL_DESIGN` |

Sandbox:

```text
Applet loads
  → Host validates package
  → Host creates session
  → Lynx runtime starts
  → SDK reportReady
  → Host sends onShow/onHide/onDestroy
```

Pass criteria:

- Applet never receives Host private objects.
- Applet can observe lifecycle only through SDK.
- Destroyed session rejects further invokes.

Current design verdict: `PARTIAL_DESIGN`, because simulator and lifecycle tests are not fully specified as executable gates.

---

### 3.2 Package, Manifest, and Distribution

| WeChat Reference | Peers-Touch Decision | Peers-Touch Capability | Owner | Status |
|------------------|----------------------|------------------------|-------|--------|
| `app.json` / page config | Adapt | `manifest.json` / `AppletManifest` | `applet-contract` | `PARTIAL_DESIGN` |
| Subpackages | Defer | package split / lazy artifact loading | Package Reader + Station Store | `DEFERRED` |
| Plugin system | Defer | trusted shared applet dependency model | Station Store + policy | `DEFERRED` |
| Versioned release | Adapt | Station package registry + version channel | Station Store | `PARTIAL_DESIGN` |
| Audit / review platform | Adapt, decentralized | Station policy + Host audit + owner governance | Station + Host Gateway | `PARTIAL_DESIGN` |
| Integrity / trusted package | Strengthen | `integrity.json` + hash verification | Package Reader | `PARTIAL_DESIGN` |

Sandbox:

```text
Producer builds package
  → package contains manifest, bundle, assets, integrity
  → Host validates platform support
  → Host verifies hashes
  → Host loads only declared entry
```

Pass criteria:

- Missing entry fails.
- Hash mismatch fails.
- Unsupported target fails.
- Host never reads producer implementation detail.

Current design verdict: `PARTIAL_DESIGN`, because package validation is designed but not yet mandatory and executable.

---

### 3.3 Navigation and Window Management

| WeChat Reference | Peers-Touch Decision | Peers-Touch Capability | Owner | Status |
|------------------|----------------------|------------------------|-------|--------|
| `wx.navigateTo` | Adapt | `navigation.navigateTo` within applet/host route policy | SDK + Host | `PARTIAL_DESIGN` |
| `wx.redirectTo` | Adapt | `navigation.redirectTo` | SDK + Host | `PARTIAL_DESIGN` |
| `wx.navigateBack` | Adapt | `navigation.back` | SDK + Host | `PARTIAL_DESIGN` |
| TabBar APIs | Reject as default | Host shell owns global navigation; applet may request navigation bar metadata | Host UI | `REJECTED` |
| Open another mini program | Adapt | `navigation.openApplet` with policy | Host Gateway + Station | `PARTIAL_DESIGN` |

Sandbox:

```text
Applet requests navigation.openApplet
  → Gateway checks method permission
  → Host checks target applet installed / allowed
  → Host opens route or returns APPLET_NOT_AVAILABLE
```

Pass criteria:

- Applet cannot mutate Host router directly.
- Cross-applet open requires policy.
- Back/close works after session state changes.

Current design verdict: `PARTIAL_DESIGN`, because route policy and cross-applet open are not fully specified.

---

### 3.4 Network and Realtime Transport

| WeChat Reference | Peers-Touch Decision | Peers-Touch Capability | Owner | Status |
|------------------|----------------------|------------------------|-------|--------|
| `wx.request` | Adopt with stronger host proxy | `network.request` | SDK + Gateway | `PASS_DESIGN` |
| `wx.uploadFile` | Defer | `network.upload` or `file.upload` | Gateway + File Service | `DEFERRED` |
| `wx.downloadFile` | Defer | `network.download` with sandbox file handle | Gateway + File Service | `DEFERRED` |
| WebSocket | Adapt | `network.socket` or `events.subscribe` | Gateway + Event Service | `PARTIAL_DESIGN` |
| TCP/UDP/mDNS | Reject first release | Not exposed by default | Host policy | `REJECTED` |

Sandbox:

```text
Applet calls network.request
  → SDK creates BridgeInvokeRequest
  → Gateway checks network permission
  → Gateway checks domain/method/header/body policy
  → Host injects credentials if policy allows
  → Gateway returns sanitized response
```

Pass criteria:

- No direct token exposure.
- Denied domain fails.
- Allowed request is audited.
- Sensitive headers/body are not logged.

Current design verdict: `PASS_DESIGN` for request, `PARTIAL_DESIGN` for realtime, `DEFERRED` for upload/download.

---

### 3.5 Storage and Data

| WeChat Reference | Peers-Touch Decision | Peers-Touch Capability | Owner | Status |
|------------------|----------------------|------------------------|-------|--------|
| `wx.getStorage` | Adopt | `storage.get` | SDK + Gateway | `PASS_DESIGN` |
| `wx.setStorage` | Adopt | `storage.set` | SDK + Gateway | `PASS_DESIGN` |
| `wx.removeStorage` | Adopt | `storage.remove` | SDK + Gateway | `PASS_DESIGN` |
| `wx.clearStorage` | Adopt with namespace | `storage.clear` scoped to applet | SDK + Gateway | `PASS_DESIGN` |
| Storage quota info | Adopt | `storage.getInfo` | SDK + Gateway | `PASS_DESIGN` |
| Cloud database | Reject shape, adapt service | Station subserver or explicit business capability | Station | `PARTIAL_DESIGN` |

Sandbox:

```text
Applet stores key
  → Gateway scopes key to applet namespace
  → quota check
  → value persisted locally
  → clear only clears same namespace
```

Pass criteria:

- Cross-applet namespace access fails.
- Path traversal fails.
- Quota exceed fails with typed error.

Current design verdict: `PASS_DESIGN` for local storage; `PARTIAL_DESIGN` for cross-device data service.

---

### 3.6 UI Feedback and Host UI

| WeChat Reference | Peers-Touch Decision | Peers-Touch Capability | Owner | Status |
|------------------|----------------------|------------------------|-------|--------|
| Toast | Adopt | `ui.showToast` | SDK + Host UI | `PASS_DESIGN` |
| Loading | Adopt | `ui.showLoading/hideLoading` | SDK + Host UI | `PASS_DESIGN` |
| Modal | Adopt | `ui.showModal` | SDK + Host UI | `PASS_DESIGN` |
| Action sheet | Adopt | `ui.showActionSheet` | SDK + Host UI | `PASS_DESIGN` |
| Navigation bar | Adapt | `ui.setNavigationBar` or manifest metadata | Host UI | `PARTIAL_DESIGN` |
| TabBar | Reject default | Host shell owns global navigation | Host UI | `REJECTED` |
| Pull-down refresh | Defer | lifecycle/UI event if needed | Runtime Host | `DEFERRED` |

Sandbox:

```text
Applet requests showModal
  → Gateway checks ui permission
  → Host renders native modal
  → user selects confirm/cancel
  → SDK receives typed result
```

Pass criteria:

- Applet cannot fake system permission prompts.
- Host theme and accessibility are preserved.
- User action returns typed result.

Current design verdict: `PASS_DESIGN` for basic UI feedback.

---

### 3.7 System, Device, and Permissions

| WeChat Reference | Peers-Touch Decision | Peers-Touch Capability | Owner | Status |
|------------------|----------------------|------------------------|-------|--------|
| System info | Adopt sanitized | `system.getInfo` | SDK + Gateway | `PASS_DESIGN` |
| Network type | Adopt | `system.getNetworkType` | SDK + Gateway | `PASS_DESIGN` |
| Theme | Adopt | `system.getTheme` | SDK + Gateway | `PASS_DESIGN` |
| Safe area/window info | Adopt | `device.getSafeArea/getWindowInfo` | SDK + Gateway | `PASS_DESIGN` |
| Vibration | Adapt | `device.vibrate` with policy | SDK + Gateway | `PARTIAL_DESIGN` |
| Location | Defer/high-risk | `device.location.*` only after ADR | Gateway + Platform | `DEFERRED` |
| Camera/microphone | Defer/high-risk | media/device ADR | Gateway + Platform | `DEFERRED` |
| Contacts/Bluetooth/NFC | Reject first release | no default exposure | Gateway + Platform | `REJECTED` |

Sandbox:

```text
Applet calls system.getInfo
  → Gateway returns sanitized host/platform info
Applet calls location without ADR
  → Gateway returns CAPABILITY_NOT_AVAILABLE
```

Pass criteria:

- Low-risk device info is sanitized.
- High-risk APIs do not exist until ADR and permission model are complete.

Current design verdict: `PASS_DESIGN` for low-risk system/device; high-risk deferred.

---

### 3.8 Files and Media

| WeChat Reference | Peers-Touch Decision | Peers-Touch Capability | Owner | Status |
|------------------|----------------------|------------------------|-------|--------|
| FileSystemManager | Defer | `file.read/write/list/delete` with applet sandbox | File Service + Gateway | `DEFERRED` |
| Choose image/video | Defer | `media.chooseImage/chooseVideo` with user gesture | Host UI + Gateway | `DEFERRED` |
| Preview image/video | Adapt later | `media.preview` | Host UI | `DEFERRED` |
| Audio/video recorder | Defer/high-risk | media ADR | Platform Handler | `DEFERRED` |
| Canvas | Adapt through Lynx capability | Lynx canvas/custom drawing after runtime proof | Runtime Host | `DEFERRED` |

Sandbox:

```text
Applet requests file.write
  → Gateway checks file permission
  → path scoped to applet sandbox
  → quota check
  → write succeeds or typed error
```

Pass criteria:

- No absolute path access.
- No cross-applet path access.
- User-selected media handles do not expose raw device paths.

Current design verdict: `DEFERRED`; not required for first release.

---

### 3.9 Sharing, Social, and Identity

| WeChat Reference | Peers-Touch Decision | Peers-Touch Capability | Owner | Status |
|------------------|----------------------|------------------------|-------|--------|
| WeChat login | Reject shape | Peers-Touch identity/session | Account + Host | `PARTIAL_DESIGN` |
| OpenID/UnionID | Reject | Peers identity / Station identity | Account + Station | `PARTIAL_DESIGN` |
| Share to chat/timeline | Adapt | `share.request` through Peers social graph | Host + Station | `DEFERRED` |
| Subscribe messages | Adapt | notification subscription through Host policy | Notification + Station | `DEFERRED` |
| Contact/customer service | Reject shape | Peers social/contact capabilities | Station + Host | `DEFERRED` |

Sandbox:

```text
Applet requests share
  → Host shows Peers share UI
  → user selects target
  → Station records social action if policy allows
```

Pass criteria:

- Applet does not receive raw contact graph.
- User action is required for outbound share.
- Federation privacy policy applies.

Current design verdict: `DEFERRED`; identity context exists conceptually but social APIs need separate design.

---

### 3.10 Payment, Ads, Commerce, and WeChat Platform Features

| WeChat Reference | Peers-Touch Decision | Peers-Touch Capability | Owner | Status |
|------------------|----------------------|------------------------|-------|--------|
| WeChat Pay | Reject first release | no default payment SDK | N/A | `REJECTED` |
| Ads | Reject | no host ad platform | N/A | `REJECTED` |
| Mini program review platform | Adapt governance | Station package policy + local owner governance | Station | `PARTIAL_DESIGN` |
| Official account integration | Reject | not applicable | N/A | `REJECTED` |
| WeChat ecosystem open data | Reject | not applicable | N/A | `REJECTED` |

Sandbox:

```text
Applet calls payment-like method
  → SDK has no public method
  → invoke rejects CAPABILITY_NOT_AVAILABLE unless a future ADR registers it
```

Pass criteria:

- No implicit commerce capability.
- No platform-specific WeChat identity or payment assumption.

Current design verdict: `REJECTED` for first release.

---

### 3.11 Cloud, Backend, Federation, and Station

| WeChat Reference | Peers-Touch Decision | Peers-Touch Capability | Owner | Status |
|------------------|----------------------|------------------------|-------|--------|
| WeChat cloud functions | Reject shape, adapt concept | Station subserver / tool / capability endpoint | Station | `PARTIAL_DESIGN` |
| Cloud database | Reject shape, adapt concept | Station-managed applet data APIs | Station | `PARTIAL_DESIGN` |
| Cloud storage | Adapt | Station object storage or applet storage capability | Station | `DEFERRED` |
| Open API cloud call | Adapt | Host Gateway + Station capability | Gateway + Station | `PARTIAL_DESIGN` |
| Federation | Peers-specific | station-to-station policy-aware capability | Station Federation | `PARTIAL_DESIGN` |

Sandbox:

```text
Applet calls a Station capability
  → SDK invoke uses capability method
  → Host Gateway checks applet permission
  → Station checks owner/federation policy
  → result returns through typed response
```

Pass criteria:

- Applet never calls Station internal API directly.
- Federation policy can deny even if manifest declares capability.
- Denial is typed and audited.

Current design verdict: `PARTIAL_DESIGN`; Station capability registry must be formalized.

---

### 3.12 AI, LLM, Agent, Skills, and Telemetry

This is Peers-Touch-specific and has no direct WeChat equivalent.

| WeChat Reference | Peers-Touch Decision | Peers-Touch Capability | Owner | Status |
|------------------|----------------------|------------------------|-------|--------|
| No direct equivalent | Add | `ai.chat` / `ai.generate` | AI Gateway + Station | `PARTIAL_DESIGN` |
| No direct equivalent | Add | `agent.invoke` / `agent.session.start` | Agent Runtime + Gateway | `PARTIAL_DESIGN` |
| No direct equivalent | Add | `skills.invoke` | Skill Registry + Gateway | `PARTIAL_DESIGN` |
| Analytics/reporting | Adapt | `telemetry.track` / `diagnostics.reportError` | Telemetry + Gateway | `PARTIAL_DESIGN` |
| Audit | Host-owned | Host/Gateway audit, not applet-written | Gateway + Station | `PASS_DESIGN` |

Sandbox:

```text
Applet calls skills.invoke
  → Gateway checks skill permission
  → Station policy checks applet owner/user/session/quota
  → skill executes through controlled runtime
  → result is sanitized
  → audit records method, requestId, quota, status
```

Pass criteria:

- Applet never receives LLM provider keys.
- Applet never calls raw model provider endpoint.
- Applet cannot write audit records.
- Telemetry is applet diagnostics, not system log access.
- Skill invocation is policy-bound and quota-bound.

Current design verdict: `PARTIAL_DESIGN`; this should be first-class Peers-Touch capability but must be gateway-controlled.

---

### 3.13 Observability, Diagnostics, and Logs

| WeChat Reference | Peers-Touch Decision | Peers-Touch Capability | Owner | Status |
|------------------|----------------------|------------------------|-------|--------|
| `wx.reportAnalytics` | Adapt | `telemetry.track` | Telemetry + Gateway | `PARTIAL_DESIGN` |
| Debug/performance APIs | Adapt | `diagnostics.reportError`, `performance.mark` subset | Runtime + Telemetry | `PARTIAL_DESIGN` |
| Console/debug logs | Restrict | applet diagnostics only | SDK + Host | `PARTIAL_DESIGN` |
| Host audit | Host-only | no applet write access | Gateway + Station | `PASS_DESIGN` |

Sandbox:

```text
Applet reports diagnostic error
  → SDK validates payload size and schema
  → Gateway strips PII
  → Host records applet diagnostic event
  → audit remains Host-authored only
```

Pass criteria:

- Applet cannot write system logs.
- Applet cannot forge audit events.
- PII and secrets are rejected or redacted.

Current design verdict: `PARTIAL_DESIGN`.

---

## 4. Required Capability Set

The first Peers-Touch applet platform release must include these capability domains:

| Domain | Required For First Release | Reason |
|--------|----------------------------|--------|
| Runtime foundation | Yes | Without lifecycle/session/bridge, nothing is a platform |
| Package/manifest/integrity | Yes | Producer independence depends on package contract |
| SDK public API | Yes | Development happens through Peers-Touch SDK |
| Network request | Yes | Most applets need backend access |
| Storage | Yes | Local state is basic applet behavior |
| System/device low-risk | Yes | Cross-device adaptation |
| UI feedback | Yes | Basic applet UX |
| Events/lifecycle | Yes | Host/app coordination |
| Gateway permission/audit | Yes | Security boundary |
| Web Host distinction from standalone | Yes | Prevent false production path |
| Simulate runtime | Yes | Design and SDK must be testable without manual Host |
| Skills | Yes | Complex applets expose app-specific capabilities through governed skill descriptors and invocation |
| Tasks/streaming | Yes | Long-running analysis, imports, and agent work cannot be one blocking request |
| AI/agent | Yes | Peers-Touch applets should expose governed platform intelligence without leaking provider internals |
| Telemetry/diagnostics | Yes | Complex applets need diagnostics, while audit remains Host-owned |
| Service binding | Yes | Complex applets need Host-resolved backend/service endpoints rather than hardcoded internals |
| File/media/share/social | No, deferred | Higher risk or product-specific |
| Payment/ads/WeChat-only features | No, rejected | Not Peers-Touch platform goals |

---

## 5. Design Test Output Contract

Every design review must output:

```markdown
## Design Capability Verdict

Overall: PASS_DESIGN | PARTIAL_DESIGN | FAIL_DESIGN

| Capability Domain | Status | WeChat Reference | Peers-Touch Decision | Blocking Gap |
|-------------------|--------|------------------|----------------------|--------------|
| Runtime foundation | ... | ... | ... | ... |
| Package/manifest | ... | ... | ... | ... |
| SDK API | ... | ... | ... | ... |
| Network | ... | ... | ... | ... |
| Storage | ... | ... | ... | ... |
| UI | ... | ... | ... | ... |
| System/device | ... | ... | ... | ... |
| Skills/tasks | ... | N/A | ... | ... |
| AI/agent | ... | N/A | ... | ... |
| Telemetry/service binding | ... | N/A | ... | ... |

## Sandbox Coverage

List every sandbox scenario and mark PASS/PARTIAL/FAIL.
```

Rules:

- If any required first-release capability is `FAIL_DESIGN`, the whole design is `FAIL_DESIGN`.
- If any required first-release capability is `PARTIAL_DESIGN`, the whole design is at most `PARTIAL_DESIGN`.
- A capability cannot be `PASS_DESIGN` unless its denial path is also designed.
- A capability cannot be `PASS_DESIGN` if it bypasses Host Gateway.
- A Peers-specific capability cannot be ignored because WeChat has no equivalent.

---

## 6. Current Design Verdict

Current overall verdict: **`PARTIAL_DESIGN`**.

Reason:

- The architecture has the correct core boundaries: SDK, package contract, Host runtime, Bridge, Gateway, Station Store.
- WeChat capability domains have a plausible Peers-Touch mapping.
- WeChat-only features are mostly rejected or deferred for explicit reasons.
- Peers-specific AI / agent / skill / task / telemetry / service binding capabilities are identified but not yet fully specified.
- Several required first-release capabilities are still `PARTIAL_DESIGN`: package validation, simulator, bridge contract tests, route policy, Station capability registry, service binding, task lifecycle, stream cancellation, AI/skills telemetry governance.

The design can move toward implementation, but it has not passed full design validation until every required first-release capability reaches `PASS_DESIGN`.
