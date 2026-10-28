---
kind: pitfall
title: Chat target resolution and fault transport preserve canonical ownership
status: active
owns:
  - tooling/acceptance/fixtures/chat_reset_targets.py
  - tooling/acceptance/fixtures/chat_native_reset.py
  - tooling/acceptance/fixtures/chat_native_actors.py
  - tooling/acceptance/provisioners/native_tauri_embedded_webdriver.py
  - tooling/acceptance/drivers/native/runtime.py
  - tooling/acceptance/drivers/tauri.py
  - apps/desktop/src/store/socialChat.ts
  - apps/desktop/src/store/socialChat.peerProfile.test.ts
  - tooling/acceptance/tests/test_tauri_smoke.py
  - tooling/acceptance/gates/chat/native_interactions_runner.py
  - tooling/acceptance/gates/chat/native_product_closure_runner.py
  - tooling/acceptance/gates/chat/contact_message_resilience_runner.py
  - tooling/acceptance/tests/test_chat_reset_target_resolution.py
referenced-by: []
related:
  - docs/architecture/engineering/acceptance/execution-budget.md
  - docs/architecture/engineering/acceptance/decisions.md
detected: 2026-10-22
---

# Chat target and Direct fault ownership

## Symptom

A two-Station Fixture resolved a primary URL through the active secondary
Profile. After exact target resolution was repaired, product closure failed at
signed discovery because an HTTP fault proxy replaced the canonical Station
origin. Repeated lease and registry validations also consumed Gate work time.

## Root cause

The active Profile is not the owner of every bound Station URL. A transparent
HTTP proxy cannot become a signed origin: the upstream statement still names
the canonical Station. Revalidating the same operation at every helper boundary
adds process overhead without strengthening that operation's authority.

## Mitigation

The target owner validates one live lease per resolution and one registry
definition per candidate, then requires one exact reviewed target. Explicit
targets validate their own Profile. Deployment and reset authorization consume
the same result. Each new operation revalidates; no cross-operation cache exists.
The local-source branch checks whether the actual URL is a loopback candidate
before reading the active Profile. Remote targets cannot inherit an unrelated
active Profile lookup timeout. Explicit local requests retain their complete
mismatch check; unbound deployment fallback retains its existing owner.
Unknown, ambiguous, drifted or stable targets remain rejected with diagnostics.
Actor reads group accounts by exact Station. Each read validates the target
and both containers once, then verifies one local row per requested account.
Manifest hydration and the pre-contact drift check remain independent reads;
the optimization never reuses authority or identity across operations.
The Native Station attestation comparison records actual commit/protocol
mismatch, assigned Profile, deployment and endpoint with its recovery action.

Runtime Binding always launches, discovers and proves the canonical Station.
Live Direct fault handles alter only dial multiaddrs. Chat uses the existing
TCP proxy after signed discovery. Reaction proof binds the unique new
message-scoped command, retained intent/outbox hash and ID, retry scheduling
count, restored connection forwarding, automatic submission and both visible
receivers. Successful submission retains the failure scheduling count.
Encrypted TCP evidence cannot establish HTTP path or wire command hashes.
The fault must begin after durable preparation. Metadata preparation performs
queue drain and authoritative plan validation over the real route; arming the
proxy before the UI action prevents a command from existing. Reuse the existing
actor-bound lifecycle pause, let the UI prepare while the route is healthy,
verify the unique pending command and matching intent/outbox hash, then arm and
resume dispatch. Restore any retained pause on every exit path.
Replacing the Direct dial route closes its previous transport connection.
Complete the actor-bound worker pause and join before applying that replacement:
closing a connection during an inbox claim can discard its returned consumer
epoch and leave later preparation fenced. Apply the route inside the same
pause-restoring `try/finally`; replacement failure must preserve its original
exception while restoring the pause. Keep the healthy proxy and every original
durable-command, loss, exact retry and bilateral receiver assertion.

## How to detect a recurrence

Run the existing target, reset authority, Runtime Binding, Native interaction,
product closure and Node Connectivity regressions. Both implicit targets must
resolve with the secondary Profile active. Each operation validates the lease
once and each candidate once; explicit resolution checks only its Profile.
The same remote resolutions must succeed when unrelated active Profile lookup
raises a timeout, without calling that lookup. Local mismatch and unbound
fallback regressions must still pass.
Prelaunch handles must leave canonical origin and proof unchanged.

Live qualification must deploy and read back both assigned Profiles at the
current source, acquire the canonical Fixture lease, verify the borrowed child
FD, resolve and reset both targets, read back Actors and seal actual mismatch
diagnostics. The real product scenarios separately prove Direct interruption,
UI failure, recovery and cleanup. Fixture routing alone is not product proof.
The reaction's durable-before-loss observation must precede the proxy loss and
worker resume. Failed and recovered hashes must equal that prepared command's
hash. An error surface with zero new commands does not prove outbox retry.
Run the route-switch regression with a binding that refuses replacement while
its worker is active, then inject a replacement failure. Both paths must enter
after pause completion and restore the pause; the original error object survives.
Real Native qualification still requires durable preparation before loss and
the complete reaction recovery, not just a successful keyboard selection.
The message metadata rail retains a reaction-state slot even when settled;
its value is `idle`. Recovery must observe the exact mounted message, one
`idle` slot and no retry control after both receiver reactions converge.
Waiting for every reaction-state attribute to disappear cannot succeed.
Retain the actual recovery-state predicate as a durable Step observation.
Batch read regressions must reject missing/duplicate accounts and invalid
container identity or volume. Actual three-actor timing must retain both
independent read phases. Product closure records durable Step and login/device
boundaries; already-hydrated login identity is checked without a second
hydration. Neither timing nor intermediate observations establish product PASS.
Transcript/thread diagnostics must also retain individual send, Reply and
Thread UI boundaries, the raw rejected receiver rows, expected message IDs and
actual summary/transcript projections. Nested failures preserve the innermost
first failed boundary; an outer Step must not overwrite it. Sampling changes
neither predicate nor polling budget, and a partial observation never proves
the remaining product Journey.
Avatar proof must classify bundled inline images before checking downloaded
cache identity. Reuse the existing bundled-square classifier and require the
rendered data URI to equal its declared source exactly. Downloaded sources
retain their cache identity check on the local asset filename, not a hash
substring in a foreign URL or query. Apply the same predicate to every PTID
surface and group slot; keep exact bilateral sources, image load state and
deterministic slot order. An inline preset has no downloaded cache filename.
Direct fault injection can also interrupt the Social runtime's profile refresh.
A failed refresh must retain the same Actor/Session's last successful profile,
not replace it with an empty cache entry and wait for the next periodic refresh.
Profile reads and authoritative resolve completions must reject changed Actor,
Session epoch, or Social reset generation. Regression covers transient refresh
failure, eventual successful replacement, avatar removal, and late completions
after reset or account switch. The Native identity observer retains each
surface's rejected and accepted snapshot under the original polling budget;
it does not fetch profiles itself or relax exact loaded-avatar proof.
Product closure must read replies from both real Thread panels after opening
them through visible UI. The timeline exposes bounded summary count/IDs, not
individual reply previews. Initial proof and recovery share one panel reader;
receiver content, identity and order remain exact. Regression must reject
divergent Bob content and ensure no obsolete preview selector survives.
After both panel reads, capture the contract's Alice localization checkpoint
once while her panel is still open, then close both panels. Use the real
checkpoint owner in regression so duplicate capture cannot be hidden by a mock.
Interactions must retain actual pane, visible rows, scroll geometry and open
Thread roots when a requested message is not mounted. These observations stay
separate from the nullable message result: useful diagnostics cannot turn a
missing receiver message into a satisfied predicate.
On a cold timeline, an authoritative reply count can exist before any reply IDs
are loaded. Do not wait for those IDs before opening the Thread. The summary
must consume the same loaded Thread surface as the panel; reading only timeline
messages leaves its IDs empty forever. Preserve exact summary/panel ID and count
equality after the on-visit load for both actors and recovery. Regressions cover
cold timeline hydration, stale timeline replies, and a deliberately divergent
Bob summary. No eager reply load or relaxed identity assertion is permitted.
Restored attachment metadata can precede local image decoding. A real Native
restart exposed `complete=false` and zero natural width, then loaded the same
in-viewport cached image without scrolling or retry. Recovery snapshots must
wait for the exact attachment row and all image load states through the shared
observer before comparing clients. Preserve count, identity, image presence,
decoded dimensions, byte proof and full snapshot equality. Regressions reject
missing, broken and foreign rows and retain the rejected-to-ready transition;
the original offline/restart product Gate remains required.
After a preserved-client restart, retain separate Chat-entry, exact Group-item
presence and exact Conversation-pane presence boundaries. The presence samples
must retain mounted Group/pane identities and actual Chat-route state without
adding a product refresh. Offline recovery records both actual transcripts
before exact equality and offline-message presence are judged. Keep the original
180-second windows and respective 0.5/0.25-second polling intervals; an expired
outer budget with no rejected projection cannot establish a product hang.
Semantic keyboard input must yield between keys. The real action toolbar moves
focus and renders the picker through React effects; a synchronous four-key loop
targets stale controls before those effects run. Use one async WebView sequence
with the same explicit inter-key interval as native input, including a task yield
when the interval is zero. A regression must execute the actual emitted script
against deferred focus and control creation. Reaction selection must durably
retain actual focus, key/click events and the overlay Message ID when its
predicate rejects, plus failed screenshot/DOM, without relaxing keyboard proof.
Semantic mouse clicks must deliver press and release to the visible hit target
through the existing Selenium Actions SDK. The embedded driver's element-click
command only emits `click`; controls that open on `mousedown` remain closed.
Use an element-origin pointer sequence, not an OS pointer or a product-specific
DOM event workaround. Regressions inspect the actual SDK W3C payload and reject
fallback after a failed action. Native qualification must retain actual events,
rendered options, selected-value readback and cleanup; a targeted observation
does not prove the rest of product closure.
Prepared local Native Cell credentials belong to binding construction, not the
first client launch. A product Gate may read source and binary identity before
launching any client. Lazy launch-time consumption incorrectly reports a
parent-equipped executable as unavailable. Regression must read the real
prepared identity before both client launches, reject missing or foreign Cell,
lease, platform and input-mode identities at construction, retain source/binary
drift rejection, and assert that no child invokes the build owner.
Interrupted preserved-session restart must retain its missing-successor failure
while still releasing run-owned state. TauriSession remembers the actual launch
PID after launcher shutdown, and final stop releases state retained by an earlier
preserve stop. A repeated final release retains the original failure, not a new
success. Proxy identity comes from the actual bind and remains readable after
close. Product cleanup has one terminal evidence writer and repeats the original
result/failure without another audit or publication. Binding releases transport
endpoints before their proxy and checks ports/processes under one remaining
deadline. Storage, staging and logs remain when an owned process is still live.
Run Native lifecycle, Tauri smoke, product closure, Runtime Binding and Direct
proxy regressions; then prove real cancellation and normal Journey cleanup.

Transient feedback is not global input interception. A real Product closure
wait observed the background Modal leaving in 200 ms with pointer events
disabled, while unrelated LobeHub Toasts retained `role="dialog"` for about
five seconds. Waiting for every dialog to disappear consumed the Toast
lifetime twice without proving that the next control was blocked.
The Journey now supplies its next selector and waits for that control's
visible, enabled, connected, positive-sized center to hit the control or one
of its descendants. A foreign modal or Toast covering that center still blocks;
missing targets and original DOM failures cannot become readiness.
Keep the original ten-second wait and polling interval, then use the same
real click path. Do not destroy feedback, change animation or Toast duration,
or skip target qualification. Execute the actual emitted JavaScript against
unrelated and blocking feedback, target descendants, absent/hidden/disabled
controls, zero geometry and read failure. The complete current-source Native
Journey must independently prove its next clicks and receiver outcomes.

The product closure's preserved-session launch must pass its restore policy
through `NativeLaunchOptions.restore_session`. Skipping password login in the
caller alone still lets Runtime Binding rediscover and reconfigure Station.
For restoration, observe the persisted binding and produce a fresh live proof
for the new client generation; keep Actor, device and successor ownership exact.
Normal launches retain configuration and login. Regression executes the real
caller and lifecycle ledger for initial launch, restoration, device drift and
original launch failure. Full Native restart qualification remains required.
