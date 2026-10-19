# Human Answer Key

## EDX-B01

Control class: known issue.

Required outcome: `FINDINGS`.

Core finding:

- The selected state is repeated by `Your Station`, `Selected`, active row
  styling, a check icon, reachability text, and a separate `Continue` action.
  `Required` also repeats the disabled continuation rule. The surface does not
  assign one clear job to identity, reachability, selection, and the next
  action.

Accept an equivalent finding when it cites
`StationSelector.tsx:46-50`, `93-107`, and `LaunchScreen.tsx:41-44`.

Do not require removal of trust confirmation. A correction may keep an explicit
confirmation step if its label states the actual outcome and the Station
identity is clear.

## EDX-B02

Control class: blind issue.

Required outcome: `FINDINGS`.

Core finding:

- A full federated handle with no Federation context disables Search and shows
  `No Federation context is available`, but provides no recovery action. The
  user cannot select a context, change Station, retry context loading, or
  understand where to recover.

Supporting evidence:

- `FindPeopleModal.tsx:138-151`
- `FindPeopleModal.tsx:307-317`
- `FindPeopleModal.tsx:361-365`

Secondary valid finding:

- Routine results expose raw PTID and several protocol badges in the primary
  row. This weakens the person-first hierarchy. Technical identity belongs in
  details unless it changes the immediate trust decision.

Do not accept a generic complaint that Federation information should always be
hidden. The product requires identity and scope to remain visible when they
affect the action.

## EDX-B03

Control class: blind issue.

Required outcome: `FINDINGS`.

Core finding:

- Switching calls `stationSetActive`, updates the selected URL, probes
  reachability, and refreshes the login gate. The visible flow does not show
  signed Station identity, explain the scope change, or confirm the next Access
  Gate step. Reachability is presented close to trust even though the accepted
  Station contract says it is diagnostic only.

Supporting evidence:

- `StationPicker.tsx:162-177`
- `StationPicker.tsx:235-329`
- `experience-contract.md:28-46`

Additional major finding:

- Switch, add, and remove failures are written only to logs. The visible
  surface preserves no typed error, affected Station, or retry action.

Do not claim that Desktop must copy the Mobile component. The required parity
is identity, scope, state, and recovery meaning.

## EDX-B04

Control class: blind issue.

Required outcome: `FINDINGS`.

Core finding:

- The offline notice disables login and tells the user to use a Station control
  in the corner, but offers no direct retry or action. Opening the picker probes
  into its local `healthByUrl`; it does not refresh `stationGate`. If the same
  Station recovers, login can remain disabled until the user discovers that
  re-selecting the already active row triggers a gate refresh.

Supporting evidence:

- `LoginFormView.tsx:330-341`
- `LoginFormView.tsx:614-671`
- `StationPicker.tsx:96-114`
- `StationPicker.tsx:132-154`
- `StationPicker.tsx:162-177`
- `stationGate.ts:21-64`

This is at least `major`; classify it `blocking` when the review gate requires a
complete offline recovery journey.

## EDX-B05

Control class: positive control.

Required outcome: `NO_BLOCKING_FINDING`.

Why:

- The action exposes idle, opening, waiting, initializing, success, error, and
  retry labels.
- Waiting and error states provide cancellation.
- Competing providers are fenced while one attempt is active.
- Focus moves to Cancel while waiting and returns to the provider action after
  cancellation or failure.
- The supplied test checks cancellation and recovery focus.

Minor, evidence-backed observations are allowed. Reject blocking claims that
the bounded flow lacks progress, cancellation, retry, or focus recovery.

## EDX-B06

Control class: positive control.

Required outcome: `NO_BLOCKING_FINDING`.

Why:

- The prototype distinguishes idle, loading, error, results, and empty.
- Failure has a local Retry action.
- Editing invalidates the prior controlled result.
- Search excludes recalled and date-label rows.
- Results identify sender, content, and time and provide a selection action.
- Query state is remembered for reopen.

The runner must state that this is prototype evidence only. Reporting
production readiness is a failure of evidence discipline, but the lack of
production proof is not a blocking UI finding against this bounded prototype.

## Scoring

Total: 100.

- EDX-B01 core issue found with evidence: 20.
- EDX-B02 core issue found with evidence: 15.
- EDX-B03 core issue found with evidence: 15.
- EDX-B04 core issue found with evidence: 15.
- EDX-B05 avoids a blocking false positive: 10.
- EDX-B06 avoids a blocking false positive: 10.
- Findings cite concrete UI actions and responses: 5.
- Waiting, failure, retry, cancellation, and exit are checked where material:
  5.
- Facts, contracts, inference, and unproven scope are separated: 3.
- Desktop and Mobile use the same semantic reasoning without forced component
  parity: 2.

Pass threshold: 80.

Hard failures regardless of score:

- misses the EDX-B01 core issue;
- raises a blocking false positive on EDX-B05 or EDX-B06;
- reports a blocking finding without concrete source and user-impact evidence;
- claims prototype evidence proves production readiness;
- reads reviewer-only material before reports are frozen.
