# Fresh Holdout Runner Rubric

## Task

Review one bounded case. Decide whether its user journey has a material visible
UI/UX problem.

Do not assume every case is defective. Do not redesign the product. Do not
turn missing runtime proof, a code smell or a personal style preference into a
product Finding.

## Output

Produce exactly one JSON document that conforms to the canonical
`ReviewResult` in:

- `docs/architecture/engineering/experience-design/data-model.md`;
- `tooling/scripts/experience-design/validator.mjs`.

Use:

```json
{
  "kind": "peers-touch-experience-review-result",
  "schemaVersion": 1
}
```

The report must pass:

```bash
node tooling/scripts/experience-design/experience-review.mjs validate <report>
node tooling/scripts/experience-design/experience-review.mjs verify <report> \
  --repo-root <repo-root> \
  --package-root <package-root> \
  --run-envelope seal.json \
  --case cases/<case-id>.md \
  --manifest manifest.json \
  --rubric rubric.md
```

Build `evaluationBinding` only from the package inputs:

- `packageId`, `sourceHead` and `sourceBlobAlgorithm` from `manifest.json`;
- the case's exact sorted `sourceBlobs` from `manifest.json`;
- SHA-256 digests of `seal.json`, the selected case, `manifest.json` and
  `rubric.md`.

Do not add ambient source files or use another worktree.

## Decision Rules

- `FINDINGS`: at least one eligible `blocking` or `major` candidate exists.
- `NO_BLOCKING_FINDING`: no eligible `blocking` or `major` candidate exists.
- Minor observations do not change the verdict.
- A missing state counts only when supplied source can reach it.
- A Finding requires an in-scope reachable state plus source-backed visible
  action and visible response.
- Accepted Product or Client contracts outrank this rubric.
- If supplied accepted contracts conflict, record the case as unproven instead
  of choosing the convenient clause.

## Evidence Separation

Record:

- facts directly visible in supplied source or stated inspected behavior;
- accepted Product or Client contracts before rubric support;
- inferences that reference both facts and contracts;
- unproven points when the required visual, dynamic, accessibility or runtime
  evidence is absent.

Source code may establish a reachable visible state. It does not by itself
establish viewport geometry, focus order, runtime success, durable readback or
receiver-visible behavior.

## Journey Graph

- Use the case's starting context as the only starting state.
- Include every explicit state and any source-reachable derived state material
  to the verdict.
- Create edges only from visible actions and visible responses.
- Compute shortest reachable distance from entry.
- At equal distance, use case order, then source path, line and ASCII state ID.

## Candidate Priority

Use the canonical ascending tuple:

```text
contractStrength
-> impactRank
-> stateOrdinal
-> explicitCoverageRank
-> severityRank
-> confidenceRank
-> candidateId
```

Every eligible candidate must carry the mechanically recomputed tuple. Select
the first material candidate as primary. Keep later material candidates as
secondary with a concrete `deprioritizedBecause`.

## Recovery

A usable recovery path must state:

- why recovery is needed;
- the visible entry action;
- same-surface or explicitly named-adjacent distance;
- preserved user state;
- reachable return state;
- keyboard, touch or navigation return target.

Close/back is an exit, not automatically recovery of the requested outcome.
An implicit route is not recovery.

## Trust

When an accepted contract defines a trust transition, check:

- friendly identity versus diagnostic identifiers;
- prior and candidate scope meaning;
- next Gate;
- failure meaning;
- visible consequences;
- treatment of previous-scope projections.

Do not treat reachability as identity proof and do not invent missing protocol
semantics.

## Platform Adaptation

Desktop and Mobile may use different controls and layout conventions. Judge
whether they preserve the same user intent, state meaning, confirmation,
recovery result and accessibility, not whether they share components.

## Completion

Populate:

- `statesChecked`;
- `exitAndRetryPaths`;
- `unproven`;
- exact source references for every fact and contract.

Do not include commentary outside the JSON document.
