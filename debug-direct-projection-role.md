# Debug Session: direct-projection-role
- **Status**: [OPEN]
- **Issue**: Windows Product Closure commits and later lists the Alice/Bob Direct conversation, but the initiating Desktop UI remains in the failed intent state because `messaging_create_direct` returns an error.
- **Debug Server**: http://10.4.43.34:7777/event
- **Log File**: `.dbg/trae-debug-log-direct-projection-role.ndjson`

## Reproduction Steps
1. Deploy exact source to disposable station-four, station-five, and sixwin.
2. Run `chat-native-product-closure-e2e` in `desktop-windows-native`.
3. Alice searches for Bob and opens the exact friend result.
4. Observe the failed intent pane while the Direct conversation later appears in the local projection.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Direct creation commits, then the Tauri command fails because inbox validation requires a Group-style owner role. | High | Low | **Confirmed**: pre-fix log line 1028 reports `messaging conversation owner role is not projected`; later lines report `direct:1`. |
| B | Station emits an invalid Direct role set. | Low | Low | **Rejected**: the Conversation aggregate canonically assigns `member` to both Direct participants. |
| C | Station bootstrap invents an owner role for Direct and conflicts with the canonical inbox projection. | High | Low | **Confirmed**: bootstrap maps `owner_ptid` to `OWNER` without checking conversation kind. |
| D | UI ignores a successful command/projection after an earlier failure. | Medium | Low | **Confirmed as consequence**: failed intent remains visible with one durable Direct session row and no active pane. |

## Log Evidence
- Pre-fix Acceptance run: `20260907T153750428899Z-90da421fea631aa9b0f51ae3b958df1f`.
- Exact source: `a008a1c3282c3cbdc5c2bb36dc7c3286f92b452a`.
- Binary SHA-256: `3925e2d5bb831937f8668261fd9a6bb5255a2b6747686e54fbf690aab635d54f`.
- First failed step: `conversation.search.ui`.
- Runtime log sequence: Conversation projection count becomes one; queue drain repeatedly rejects `messaging conversation owner role is not projected`; UI remains `data-chat-conversation-intent-state="failed"`.
- Cleanup: `DONE/PROVEN`.
- Debug log lines 1-4 bind the runtime failure, canonical Station roles, bootstrap role synthesis, and failed UI intent.
- The focused Desktop binary unit-test target is independently blocked by pre-existing `application::auth::service` test-only import/type errors; this does not alter the runtime evidence.

## Verification Conclusion
Root cause confirmed: Desktop applies Group owner-role invariants to canonical
Direct projections. The fix must make Direct validation require two sorted
`MEMBER` participants with the deterministic owner metadata present, while
retaining exact `OWNER` enforcement for Group. Station bootstrap must project
the same kind-specific roles instead of inventing Direct ownership.

## Fix
- Desktop inbox validation now applies kind-specific Direct and Group role
  invariants.
- Station bootstrap projects Direct participants as `MEMBER` and reserves
  `OWNER` synthesis for Group.
- The Direct creation regression fixture now matches the canonical Station
  event.

## Post-Fix Evidence
- `cargo check --features acceptance-webdriver`: PASS.
- `station-messaging-unit`: `20260907T162201940480Z-ef80f18031688cbc36e95116b914a62e`.
- `messaging-platform-contract`: `20260907T162220659277Z-75ade6a5e23284b518a19e8793f7a97e`.
- `desktop-check`: `20260907T162250297926Z-b0986d285384583575acedb4b90a8302`.
- `chat-native-visible-static`: `20260907T162311315463Z-728ed72316862d015983e93b23cd90aa`.
- Exact-source Windows Product Closure
  `20260907T162910781782Z-6bab8cef6910f9f82faeae965d0eb0fc`
  proves first-open success, repeated deterministic reopen, and one active pane.
- Product Closure next failed at `group.create.ui`; cleanup remained
  `DONE/PROVEN`.

## Iteration: Group Create Gate
| ID | Hypothesis | Status | Evidence |
|----|------------|--------|----------|
| E | The runner clicks submit before React commits contact selection and enables the button. | Confirmed | The runner has no post-selection wait; Station received no `/conversation/group/prepare`; no Group row exists. |
| F | Product `handleFinish` rejects actor or Federation input. | Rejected | No frontend `createGroup failed` or validation feedback was emitted. |
| G | Group prepare reached Station and failed. | Rejected | Station request logs contain no `/conversation/group/prepare` for the failed interval. |
| H | Authority committed a Group but the clients failed to project it. | Rejected | station-four contains only the proven Direct; station-five contains no Conversation row. |

## Group Gate Fix
- The runner now waits for Bob's contact control to expose
  `aria-pressed="true"` and for the submit control to become enabled before
  issuing the native submit click.
- A bounded timeout captures the Alice DOM, screenshot, modal count, pane
  states, and submit state without weakening the Group product assertion.
- The focused synchronization test passes.
- Fresh local Gate runs pass:
  - `station-messaging-unit`:
    `20260907T171455773732Z-45ff86e160d98743abc4293f4bab99fd`;
  - `messaging-platform-contract`:
    `20260907T171455773750Z-ac295bc48df5b5c147413cd6c3a6d9d9`;
  - `desktop-check`:
    `20260907T171455773766Z-7a236d1a2c3514b2da8b0e80290de1cd`;
  - `chat-native-visible-static`:
    `20260907T171455773563Z-97c990c064491a98b727cfe253fbcdcf`.
- Exact-source Windows post-fix verification remains pending; the debug session
  stays `[OPEN]`.

## Iteration: Group Federation Projection
| ID | Hypothesis | Status | Evidence |
|----|------------|--------|----------|
| I | The selected Direct peer loses its Federation ID in the Desktop local Conversation projection, so Group creation returns from the pre-command guard. | Confirmed | Windows run `20260907T172733115184Z-0c931661f30e78bb940a7a75796c0cd1` delivered native click events after committed selection, but emitted no Group command. Station's Direct row retains `fed_chat_7341c15a026c42dd6d56`; the Desktop projection contract and SQLite schema contain no Federation field. |
| J | Contact selection is lost before `handleFinish`. | Rejected | Timeout DOM preserves Bob with `aria-pressed="true"` and the submit control enabled. |
| K | The authenticated actor disappears before submission. | Rejected | The same DOM still renders Alice's authenticated Chat surface and runtime logs continue successful auth validation. |
| L | Native input does not deliver the submit click. | Rejected | The native click helper observed the enabled target and completed its `mousedown`, `mouseup`, and `click` acknowledgements before the timeout. |

The next fix belongs to the Desktop Device Messaging Engine projection:
preserve canonical `federation_id` from Conversation authority events and
Station bootstrap through local persistence, recovery, Rust/TypeScript
projection, and `socialChat`. The modal must continue to reject missing or
ambiguous Federation context.

## Federation Projection Fix
- Exact-source Windows run
  `20260907T172733115184Z-0c931661f30e78bb940a7a75796c0cd1`
  at `8c26787fbf024a2bf948827295f94e847417df36`, binary SHA-256
  `54c28b1f3566124f4cd650ca8558c2273c0c2ee01e0c792a30d691e1d3fd2df2`,
  proves committed Group selection and enabled-submit state before the native
  click.
- The submit click produced no `/conversation/group/prepare`, left the modal
  open, and retained the enabled submit control. Station's Direct row retains
  Federation `fed_chat_7341c15a026c42dd6d56`.
- Desktop's local Conversation projection had no `federation_id` column or
  Rust/TypeScript field. `CreateGroupModal` therefore rejected the selected
  contact in its pre-command Federation guard.
- The correction carries the authority-owned Federation ID through the shared
  schema migration, creation/MLS projections, recovery, Desktop Rust JSON,
  TypeScript service contract, `socialChat`, Mobile persistence/commands, and
  Mobile lifecycle repair from canonical `/conversation/list` protobuf data.
  Existing v2 recovery archives without the field remain decodable; Desktop and
  Mobile repair empty legacy values from Station without inventing scope.
- Local verification passes:
  - Messaging Core: `106+2`;
  - Desktop tests: `540` passed, one explicitly skipped;
  - messaging platform contract: `19`;
  - Desktop TypeScript check;
  - Desktop production build;
  - Desktop Rust `cargo check --features acceptance-webdriver`;
  - Mobile Rust: `69` tests;
  - full `pnpm mobile:check`;
  - legacy recovery archive compatibility and pre-column SQLite migration;
  - `station-messaging-unit`:
    `20260908T012913836503Z-0950132dc5eb697bbbbfa3b9024bacc5`;
  - `messaging-platform-contract`:
    `20260908T012928729229Z-3fbe961ea4cc6aa0a2ccdc6b78643a99`;
  - `desktop-check`:
    `20260908T012952353971Z-4fde3c43ff57faf818e946e6a790f4c1`;
  - `chat-native-visible-static`:
    `20260908T013008012282Z-5044574d070da418cd2e02a6f843fdbc`;
  - `mobile-contract-static`:
    `20260908T013026599038Z-b494469b036bebe0b789cb7439da32d2`.
- Exact-source Windows verification of this projection correction is pending;
  the debug session stays `[OPEN]`.

## Iteration: Group Signed Endpoint Routes
| ID | Hypothesis | Status | Evidence |
|----|------------|--------|----------|
| M | Group submission reaches Station after Federation projection repair. | Confirmed | Exact-source Windows run `20260908T013805491929Z-5d8f7a0c6d64aec300b72900a1ecd09c` calls `POST /conversation/group/prepare`; Desktop records `station returned 400`. |
| N | Group preparation incorrectly requires remote Bob in the authority Station's local Actor Device table. | Confirmed | Station request `131caa21-a783-43e4-a7ef-161743ad84b1` returns 400 after the local identity query resolves only Alice. `PrepareGroup` called `resolveActorRoutes`, and KeyPackage reservation called `activeRoute`, both backed only by local `actor_devices`. |
| O | The existing MP-D19 signed endpoint-manifest path can supply canonical Alice/Bob routes without a Bob shadow row. | Confirmed locally | `TestConversationDDDGroupGenesisUsesVerifiedRemoteRoutes` creates the Group with Bob routed to station-five and asserts zero local Bob device rows. |

- Runtime source: `4ff3f78fb4c6a437aa6b1ed645dabab57ca9b57e`.
- Windows binary SHA-256:
  `b144db724cc552c9c1c3fb7676670524e605a83629f737ae42c50c32ef3d0b54`.
- Source/runtime identity, Direct create/reopen, native input, and cleanup pass.
- First failed step: `group.create.ui`, caused by Station HTTP 400 during
  `POST /conversation/group/prepare`.
- The local correction:
  - resolves one signed endpoint-manifest snapshot before Group preparation;
  - passes server-derived canonical routes into the application service;
  - binds KeyPackage reservation to verified Home Station routes;
  - returns the same manifest snapshot used by the authority plan;
  - binds the complete signed manifest set and stable directory state into the
    persisted authority plan;
  - revalidates fresh signed routes and stable directory state before Group
    commit;
  - resolves exact receipt replay before plan loading or remote manifest
    lookup;
  - derives Group name and members only from the persisted plan;
  - keeps client-provided routing data non-authoritative.
- Verification passes:
  - full Conversation and Key Exchange tests;
  - Conversation and Key Exchange race tests;
  - focused Conversation and Key Exchange `go vet`;
  - Go style, formatting, and diff checks;
  - local aggregate
    `20260908T032102443647Z-880042c6a33915570b610c7a94d90718`;
  - `station-messaging-unit`
    `20260908T032102660098Z-e50d904fe0d9cf71f21637d628504b76`;
  - `messaging-platform-contract`
    `20260908T032105462748Z-fe0e66b26c2c04814cfbff0d47eeb9a1`;
  - `desktop-check`
    `20260908T032108283088Z-58efca7e594a079767761275bff4ee83`;
  - `chat-native-visible-static`
    `20260908T032117217481Z-8905e613c33b030e18e8075e6daf24ca`;
  - conditional `station-api-ownership`
    `20260908T031556440970Z-1defc692da62374b13b9c5e23f453da2`;
  - independent final seam review: no P0/P1 findings.
- Exact-range plan:
  `20260908T031725199224Z-b69de6f2a0fd623271448cdfd5f91dd2`.
- Gap Detector
  `20260908T032208866291Z-5c6df6dd6c62ef049d94c8a0f8ef78ac`
  remains `UNPROVEN` for the pending native Gate and the unrelated
  Acceptance provisioning self-suite.
- Exact-source Windows verification remains pending; the debug session stays
  `[OPEN]`.

## Iteration: Group Genesis Command Route
| ID | Hypothesis | Status | Evidence |
|----|------------|--------|----------|
| P | The signed endpoint-route correction allows Group preparation to complete. | Confirmed | Exact-source Windows run `20260908T033256775430Z-34b2f520c4d47ab9351c6a41bb592255` records `POST /conversation/group/prepare` with HTTP 200. |
| Q | Desktop Rust submits the prepared Group genesis command through the ordinary command route. | Confirmed | The next Station request is `POST /conversation/command` with HTTP 200; the response carries a typed rejection rather than a committed Group event. |
| R | Group authority committed and only the Desktop projection failed. | Rejected | PostgreSQL has no Group Conversation row or Group command receipt; the authority plan remains `prepared`. |
| S | The canonical Group creation route is unavailable or ambiguous. | Rejected | The accepted capability registry, AO-D07, generated proto, and Station handler all bind `CreateGroupConversationRequest` to `POST /conversation/group`. |

- Runtime source: `018491a013277a1bea1d5ba50d7fd3a3aaa75203`.
- Windows binary SHA-256:
  `9db85704bdbdec5432df9798e056c9c1fdd27d89fc2c1aa8426e28a82a2f4092`.
- First failed step: `group.create.ui`; cleanup is `DONE/PROVEN`.
- The local correction:
  - identifies only prepared epoch-zero Group genesis commands;
  - submits those commands as `CreateGroupConversationRequest` to
    `/conversation/group`;
  - leaves all ordinary commands and established membership transitions on
    `/conversation/command`;
  - rejects non-canonical durable command bytes;
  - verifies the returned Group Conversation and committed event against the
    submitted command.
- Current-source verification:
  - Desktop Rust `cargo check --features acceptance-webdriver`: pass;
  - focused Rust route/byte/response tests are present but the binary test
    target remains blocked before execution by unrelated pre-existing Auth
    test-only compile failures;
  - `station-messaging-unit`:
    `20260908T042714357902Z-41049387fc52c3b2069a50a526823961`;
  - `messaging-platform-contract`:
    `20260908T042729704170Z-b4257c7aa7feab8cbe4756c06fb40bba`;
  - `desktop-check`:
    `20260908T042825752431Z-c33f841bdfa01c864ae452a23e9380a2`;
  - `chat-native-visible-static`:
    `20260908T043359375556Z-e0344ecc986d45b8d6e14ad93e08a96b`;
  - `station-api-ownership`:
    `20260908T043433761115Z-7a2529c303868bb510bbd7875d883735`.
- Exact-source Windows verification of this route correction is pending; the
  debug session stays `[OPEN]`.
