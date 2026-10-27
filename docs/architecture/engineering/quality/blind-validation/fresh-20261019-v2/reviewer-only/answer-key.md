# Fresh Holdout V2 Answer Key

Open only after the complete report manifest is frozen and the run enters
`scoring`.

## EDX-H01

Hidden challenge: `primary-visible-blocker`

Expected verdict: `FINDINGS`

Core Finding:

- A Connector may visibly say `Connected` while resource discovery yields no
  current tool manifest.
- In that state the Agent binding switch is disabled by
  `!bindingAvailable`.
- The row exposes neither a reason nor a recovery action. The Settings action
  exists only when the entire Connector list is empty, so it is absent here.
- The accepted Connector contract separates OAuth connection, resource
  manifest, Agent binding and readiness. Connection cannot be presented as
  usable binding readiness.

Expected primary classification:

- severity: `blocking` or strongly justified `major`;
- impact: `outcome-blocked`;
- owner: interaction / state and recovery;
- confidence: `high`;
- accepted contract support must be primary, not rubric-only.

The primary tuple must be recomputable from the runner's graph and IDs.
Readiness badge behavior after a binding is secondary; implementation races or
ToolCall speculation must not displace the visible blocked state.

Challenge is satisfied only if the report identifies the connected/no-manifest
state, disabled binding action, absent explanation and absent local recovery.

## EDX-H02

Hidden challenge: `trust-boundary-propagation`

Expected verdict: `FINDINGS`

Core Finding:

- The recovery projection retains both expected and actual Station identity.
- The blocking overlay renders only generic identity-changed copy and generic
  actions. It does not project a friendly expected/current Station identity,
  even though the accepted Mobile surface contract requires friendly identity
  to be primary for every visible state.
- The user cannot tell which saved scope is being preserved or what target the
  re-authentication decision applies to.
- Raw peer IDs should remain hidden; the correction is a friendly identity
  projection or an explicit diagnostic affordance, not exposing identifiers as
  primary copy.

Expected primary classification:

- severity: `major`;
- impact: `material-ambiguity`;
- owner: trust / information architecture;
- confidence: `high`.

The report must include a `TrustBoundaryCheck` backed by accepted Mobile
contracts. It must preserve the fact that the action implementation verifies
identity before credentials and must not invent a replacement protocol.

Challenge is satisfied only if the report distinguishes safe runtime blocking
from incomplete visible trust meaning.

## EDX-H03

Hidden challenge: `recovery-locality`

Expected verdict: `FINDINGS`

Core Finding:

- A pre-surface materialization/load error writes
  `runtimeErrorKeyById[appletId]`.
- `AppletRuntimePage` then renders a generic `Empty` inside the normal shell.
- The shell still exposes Close, which is an exit, but the failure surface
  exposes no Retry action that calls `loadApplet` again.
- The retry in `LynxContainer` is unreachable because that component is not
  mounted for this pre-surface failure.

Expected primary classification:

- severity: `blocking`;
- impact: `recovery-absent`;
- owner: state and recovery;
- confidence: `high`.

The report must not count Close as recovery of the requested Applet outcome.
The RecoveryPath for the failed state is absent; it must not fabricate an
implicit route.

Challenge is satisfied only if the report identifies the ownership split
between pre-surface page failure and post-mount container retry.

## EDX-H04

Hidden challenge: `positive-control-non-finding`

Expected verdict: `NO_BLOCKING_FINDING`

Why:

- Cards expose package type, publisher, signature/trust, risk and revocation.
- Detail exposes source, signature, policy, digest, revocation, scan verdict
  and target authority when installed.
- High-risk install requires explicit danger confirmation.
- Revoked or policy-blocked packages remain inspectable while install is
  disabled, with a defensive action check.
- Catalog failure has retry and partial source failure remains visible.
- Install failure remains failure rather than success.

Native Gate execution, signature verification implementation and
target-authority readback are outside this source-only UI review and should be
recorded as unproven where material. They are not visible blocking Findings.

Challenge fails on any blocking false positive, demand for identical card and
drawer content, or claim that these excerpts prove native product readiness.

## EDX-H05

Hidden challenge: `evidence-boundary`

Expected verdict: `FINDINGS`

Core Finding:

- The accepted lifecycle defines `ready` as Applet `reportReady()` plus mounted
  surface.
- After 2.5 seconds without an error or `reportReady`, the Host fallback sets
  `ready=true`, hides loading and calls `notifyLoaded("host-render-fallback")`.
- `AppletRuntimePage` treats that callback as product rendered evidence and
  reports it to the product-window evidence path.
- Because `ready` becomes true, the later 8-second timeout no longer produces
  its visible timeout state.
- Host content existence is therefore substituted for Applet readiness,
  producing both a visible false-completion state and an overclaimed evidence
  event.

Expected primary classification:

- severity: `blocking`;
- impact: `visible-contradiction`;
- owner: state and recovery / implementation;
- confidence: `high`.

The report must keep two consequences connected to one mechanism: premature
visible readiness and premature rendered evidence. It must not broaden the
Finding into a claim about release certification or Applet business behavior.

Challenge is satisfied only if the report rejects the fallback as readiness
proof and records missing dynamic/runtime evidence separately.

## EDX-H06

Hidden challenge: `platform-semantic-parity`

Expected verdict: `NO_BLOCKING_FINDING`

Why:

- Both platforms place current-device clearing in a conversation-owned danger
  group, separate from reversible preferences.
- Both require explicit destructive confirmation and state that only the
  current device's messages, search index and unreferenced media are removed.
- Both block duplicate confirmation while pending and report completion with
  released local storage.
- Desktop uses a detail panel plus modal; Mobile uses an action sheet plus
  alert dialog. Those mechanisms fit their platform contracts while preserving
  the same intent and state meaning.

The supplied source does not prove restart durability, later-message receipt,
focus behavior, touch geometry or full accessibility. Record those cells as
unproven if they are required for a broader admission claim. Do not convert
them into a blocking Finding in this bounded source review.

Challenge fails on component-shape parity demands, a blocking false positive,
or a claim that source excerpts prove the runtime outcomes.

## Scoring

Maximum: `100`

- EDX-H01: 20
  - 15 core Finding and primary selection
  - 5 valid, recomputable primary tuple
- EDX-H02: 20
  - 15 trust meaning and accepted-contract projection
  - 5 valid, recomputable primary tuple
- EDX-H03: 15
  - 10 missing local recovery versus exit
  - 5 valid, recomputable primary tuple
- EDX-H04: 15
  - 12 avoids material/blocking false positive
  - 3 preserves source/runtime evidence boundary
- EDX-H05: 20
  - 15 false readiness plus evidence mechanism
  - 5 valid, recomputable primary tuple
- EDX-H06: 10
  - 7 preserves cross-platform semantic parity
  - 3 preserves unproven runtime cells

Partial credit requires source-backed reasoning. A correct verdict without the
case's core mechanism earns at most half of that case's points.

## Hard Failures

Any one of the following is a hard failure:

- a blocking false positive on EDX-H04 or EDX-H06;
- failure to satisfy any hidden challenge class;
- a Finding without accepted or rubric contract support;
- a Finding without reachable visible action and response;
- a primary tuple that canonical validation cannot recompute;
- answer-key or cross-case report exposure before freeze;
- source, package or report digest mismatch;
- reuse of any prior exposed/training case;
- treating source or prototype evidence as production/runtime proof.

Promotion requires score `>=80`, zero hard failures and all report/package
hashes valid.
