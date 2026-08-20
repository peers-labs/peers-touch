# Acceptance Engineering Scenario Calibration

Read these scenarios after `PROCEDURES.md`. They demonstrate how the same
procedure handles different runtime cells. They do not override current
contracts, profiles, Gate definitions, or code.

## Scenario A. Complete Native Two-Actor Chat Acceptance

### Request

```text
Use God View to complete native Chat delivery Acceptance.
```

### Deterministic Walkthrough

1. **Scope and ownership**
   - Mode: `COMPLETE`.
   - Domain: `chat`.
   - Truth: Station device queue, Desktop Rust messaging engine, encrypted local
     store, and receiver DOM.
   - Receiver: Bob in native Tauri WKWebView.
   - Runtime cell: `native-tauri-embedded-webdriver`.

2. **Gap matrix**
   - Read Chat Feature and Capability contracts.
   - Read latest Chat plan, run, and validation reports.
   - Separate static/type proof from native receiver proof.
   - Missing Bob DOM, unread badge, or restart evidence stays `UNPROVEN`.

3. **Stage dispatch**
   - Missing journey or receiver state: PRODUCT amendment.
   - Missing messaging ownership, recovery, or Driver lifecycle: DESIGN
     amendment.
   - Existing accepted contract with missing Gate implementation: PLAN or
     EXECUTE according to the formal plan.

4. **Contracts**
   - Confirm owned Chat paths map to native Chat Feature IDs.
   - Confirm Feature and Capability require:
     `chat-native-visible-static` and `chat-native-two-client-e2e`.
   - Confirm Gate Catalog environment is native Tauri.

5. **Runtime manifest**
   - Actors: Alice and Bob.
   - Separate WebDriver ports, Gateway ports, profiles, storage roots, and
     device identities.
   - Approved disposable Station.
   - Committed disposable dev-account fixture from
     `apps/station/app/conf/actor.yml`; no credential environment variable.
   - Reset requires explicit authorization.
   - Evidence: runner/validator JSON, screenshots, DOM, redacted logs, message
     ID, runtime metadata, bounded timing.

6. **Plan**

   ```bash
   make acceptance-plan ACCEPTANCE_RANGE=<base>...<head>
   ```

   The plan must select the required Chat native Gates for changed owned paths.

7. **Provision**

   ```bash
   make profiles
   make profile <approved-profile>
   make config
   make station
   make station-check
   python3 -m pip install -r tooling/acceptance/requirements.txt
   make acceptance-driver-build
   make acceptance-driver-smoke
   make status
   ```

   Before reset:

   ```bash
   test "${CHAT_ACCEPTANCE_RESET:-0}" = "1"
   ```

   Verify the Station is the approved disposable target.

8. **Execute and judge**

   ```bash
   make acceptance-chat-native-static
   CHAT_ACCEPTANCE_RESET=1 \
   make acceptance-chat-native-two-client
   python3 tooling/scripts/acceptance-validate.py \
     --domain chat \
     --require-proven
   ```

9. **Report and cleanup**
   - Verify Alice/Bob processes stop.
   - Verify allocated ports have no listener.
   - Verify temporary storage cleanup.
   - Report exact message/conversation IDs and evidence paths.
   - Keep untested multi-device or cross-Station scope explicit.

### No-Free-Choice Check

A fresh Agent does not choose:

- Browser instead of native Tauri.
- API success instead of Bob DOM evidence.
- Shared Alice/Bob storage.
- A non-disposable Station for destructive reset.
- Static Gate success as proof of native delivery.

## Scenario B. Add Or Complete Station Dashboard Acceptance

### Request

```text
Add Acceptance for a Station Dashboard operator workflow.
```

### Deterministic Walkthrough

1. **Scope and ownership**
   - Mode: `ADD` for a new workflow, otherwise `COMPLETE`.
   - Domain: `station-dashboard`.
   - Truth: Station dashboard service/domain state.
   - Receiver: operator using Dashboard API or visible Dashboard surface.
   - Runtime cell: `local` for unit/type checks; use the declared environment
     for a visible runtime Gate.

2. **Gap matrix**
   - One row per operator action, result, failure, and readback.
   - Type-check and unit tests may prove service contracts.
   - They do not prove a visible operator workflow unless the Feature contract
     says the surface is out of scope.

3. **Stage dispatch**
   - Undefined operator workflow or visible states: PRODUCT.
   - New auth/trust/Station ownership semantics: DESIGN.
   - Existing semantics with missing contracts or Gates: PLAN/EXECUTE.

4. **Contracts**
   - Add or update the Feature contract.
   - Add it to a Station Dashboard Capability.
   - Map service and web source paths in Registry.
   - Register stable Gate commands with correct local/environment tier.

5. **Runtime manifest**
   - Station source/runtime under test.
   - Dashboard web toolchain.
   - Operator identity and auth source when required.
   - Dataset and cleanup when the workflow mutates state.
   - API and/or visible surface evidence required by the Feature.

6. **Plan**

   ```bash
   make acceptance-plan ACCEPTANCE_RANGE=<base>...<head>
   ```

   Changed Dashboard paths must select the new Feature and its Gates.

7. **Provision**
   - For local unit/type Gates, verify dependencies only.
   - For runtime Gates, activate a profile and ready Station:

   ```bash
   make profiles
   make profile <approved-profile>
   make config
   make station
   make station-check
   ```

8. **Execute and judge**

   ```bash
   make acceptance-station-dashboard
   make acceptance-station-dashboard-domain-validation
   python3 tooling/scripts/acceptance-validate.py \
     --domain station-dashboard \
     --require-proven
   ```

9. **Report and cleanup**
   - Report service, web, and runtime Gates separately.
   - Restore mutable operator Fixture data.
   - Preserve visible-surface gaps as `UNPROVEN`.

### No-Free-Choice Check

A fresh Agent does not:

- Copy Federation mutual-validation semantics into a managed Domain.
- Treat Dashboard TypeScript checks as visible workflow proof.
- Put operator behavior inside Registry or Gate Catalog.

## Scenario C. Add Or Complete Applet Local-Evidence Acceptance

### Request

```text
Complete Acceptance for the Applet Desktop lifecycle.
```

### Deterministic Walkthrough

1. **Scope and ownership**
   - Mode: `COMPLETE`.
   - Domain: `applet`.
   - Truth: Desktop Page/Runtime lease and Applet runtime state.
   - Receiver: Desktop user switching, closing, and waking Applets.
   - Runtime cell: current Gate Catalog environment, initially
     `local-evidence` unless a native visible Gate is required by contract.

2. **Gap matrix**
   - Rows cover A-to-B switch, close to launcher, LRU eviction, wakeup refresh,
     failure, and restoration.
   - A local script proves only the assertions and runtime cell it actually
     exercises.

3. **Stage dispatch**
   - Undefined lifecycle UX or visible state: PRODUCT.
   - New runtime lease ownership or Page/Runtime boundary: DESIGN.
   - Existing lease architecture with missing Gate wrapper/evidence: PLAN or
     EXECUTE.

4. **Contracts**
   - Verify Applet Feature, Capability, Domain, Registry, and Gate Catalog
     trace.
   - Do not add Applet business assertions to the generic Driver.

5. **Runtime manifest**
   - Desktop/Applet runtime inputs.
   - Applet A and B identities.
   - Initial launcher state.
   - Expected lease counts and transitions.
   - Evidence report path and cleanup.

6. **Plan**

   ```bash
   make acceptance-plan ACCEPTANCE_RANGE=<base>...<head>
   ```

   Applet lifecycle paths must select
   `applet-desktop-lifecycle-smoothness`.

7. **Provision**
   - Verify Node/pnpm dependencies.
   - Use the Gate Catalog command and environment.
   - Do not start Station or native Tauri unless the selected Gate requires it.

8. **Execute and judge**

   ```bash
   python3 tooling/scripts/acceptance-run.py \
     --gate applet-desktop-lifecycle-smoothness
   make acceptance-validate DOMAIN=applet
   python3 tooling/scripts/acceptance-validate.py \
     --domain applet \
     --require-proven
   ```

9. **Report and cleanup**
   - Verify generated lifecycle evidence.
   - Report local-evidence scope separately from native user-visible scope.
   - Keep Mobile and unexecuted native runtime cells unproven.

### No-Free-Choice Check

A fresh Agent does not:

- Provision Station or Tauri when the selected Gate is purely local.
- Claim native Applet product readiness from a local MJS Gate.
- Hide Mobile or cross-platform gaps.

## Calibration Result

The same nine-step procedure produces different provisioning because
`gates.yaml` environment/tier metadata and Feature proof requirements differ:

| Scenario | Provisioned resources | Strongest allowed claim |
|----------|-----------------------|-------------------------|
| Native Chat | Profile, Station, Acceptance Tauri binary, two isolated clients, credentials, reset Fixture | Named native two-actor journeys exercised by passed Gates |
| Station Dashboard | Local toolchains and, only for runtime Gates, a ready Station/operator Fixture | Service/web/runtime assertions actually selected and passed |
| Applet local evidence | Node/pnpm and Gate-local inputs | Local lifecycle assertions only |

If a fresh Agent cannot derive these differences from the current contracts and
procedure without inventing a command or runtime, report
`ACCEPTANCE_PROCEDURE_INCOMPLETE` and stop.
