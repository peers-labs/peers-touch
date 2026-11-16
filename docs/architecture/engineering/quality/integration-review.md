# Integration review admission

The Review Framework owns one admission decision for a resolved integration.
`tooling/scripts/review/integration_review.py` is its executable owner.
Acceptance continues to own Gate selection, execution and product evidence.
This decision never authorizes commit, push, merge or publication.

## Source and scope

Preparation binds both parent commits, the unique merge base, the final
candidate tree and the review policy digest. Auto preparation uses Git's
actual `merge-tree --write-tree`; conflicted merges require a resolved index.
Inventories include both complete branch diffs, candidate differences from
both parents, deletions, file mode/type/object changes and files Git merged
automatically. Known executable languages and unknown Git-executable paths
both require build and behavior evidence.

Architecture closure unions the parent and candidate architecture registries.
It follows registered producer/consumer dependencies to a fixed point, retains
removed registrations, and exposes governed paths and Gate IDs. The executor
must explain callers, consumers, registration, protocol, persistence and
runtime for each affected owner. Unregistered relationships still require
source reading and independent review; this is not a cross-language static
call graph.

Every changed path has exactly one outcome, `PRESERVED` or
`INTENTIONALLY_SUPERSEDED`, supported by required checks. Historic blob
reappearance is a review trigger, not an automatic bug verdict. Its reviewer
counterexample and preservation analysis are mandatory. Supersession cites
an accepted owning requirement, complete migration and replacement proof.
The presence of a docs reference does not itself prove human acceptance.

## Checks and standards

Before execution, checks declare an ID, argv, cwd, report format, kind,
classification, covered paths and relevance. Code outcomes require both
affected-product `build` and `test`/`functional` proof. Classifications are `required`, `conditional`
(with an explicitly resolved trigger) or `advisory`. Affected registry Gates
receive separate dispositions. Non-core advice can be deferred with reasons.
An executor may not downgrade a required check to obtain approval.

The runner executes argv without a shell, with a declared bounded timeout, and
captures original stdout/stderr and JUnit/Vitest report bytes, exit code, case
counts, duration and plan digest. Verification recomputes counts from those
original bytes, including suite-level errors, runtime errors and overall
success, and rejects inconsistent report summaries. Tests use original
unittest, TAP, JUnit or Vitest counts. Missing results, nonzero exit, zero cases,
skipped cases, failures, stale reports and stale source block admission.
`exit` format is only structural/build evidence. UI outcomes require a functional
check exercising actual rendering and interaction; grep/source assertions
cannot qualify. Review verifies that the chosen test exercises the risk.

Changed tests and Gates receive a separate standards decision. Equivalent
rewrites explain retained assertions and baseline proof; removal or weakening
requires an accepted requirement change. Deleted standards cannot disappear
from scope. A passing replacement test is not automatically equivalent.

For equivalent rewrites, each changed original parent standard appears in a
required check's `baselineInputs`, as `{"side":"ours","path":"tests/example.py"}`.
The argv includes the exact `{baseline:ours:tests/example.py}` placeholder.
The owner extracts the original Git blob outside source, substitutes its path
and records the blob identity. Original Python tests import the candidate via
`PYTHONPATH`. Other runners must explicitly resolve original relative imports
against the candidate; a load failure remains blocked. Original fixtures are
inputs, not a second product source. Baseline checks must exercise assertions;
merely reading the extracted file cannot prove equivalence.

Run on the materialized candidate, with no unstaged or untracked sources.
Checks that rewrite the candidate invalidate the run. Reprepare after either
parent, candidate, policy, check selection or review scope changes. Results
and independent review bind the complete manifest; this first implementation
invalidates all evidence conservatively, rather than guessing which subset
survives.

## Independent judgment

The executor states both branch intentions. A separate reviewer reads the
contracts, complete bilateral inventory, final source and original test
output. The review lists every inspected path, findings, standards/dependency
analysis and executable counterexamples. Every historical reversion must be
challenged. Identity alone does not establish review quality.

Review decisions and check records use the project's trusted Agent honesty
rule. There are no signing keys, HMACs or reviewer receipt chains. Schema
validation and source matching do not prove reviewer competence or prevent
deliberately fabricated JSON. Actual Agent calibration is a separate empirical
exercise; automated fixtures must never be described as a blind Agent trial.

## Entrypoints

Keep JSON inputs and reports outside repository source, for example in
`$PT_ACCEPTANCE_ARTIFACT_ROOT/integration-review/`. Create that directory using
the existing evidence resource owner before these commands.

```bash
python3 tooling/scripts/review/integration_review.py prepare \
  --ours <ours-ref> --theirs <target-ref> --candidate index --plan <external-plan>
# Fill intentions, outcomes, bundles, standards and the check list from review.
python3 tooling/scripts/review/integration_review.py run \
  --ours <ours-ref> --theirs <target-ref> --candidate index \
  --plan <external-plan> --results <external-results>
# A separate reviewer writes source-bound findings and counterexamples.
python3 tooling/scripts/review/integration_review.py verify \
  --ours <ours-ref> --theirs <target-ref> --candidate index \
  --plan <external-plan> --results <external-results> --review <external-review>
```

Submit, divergent merge commit, local reverse-sync fan-out and the GitHub
merge wrapper must call this same verifier immediately before release. Missing
inputs and environment failure remain blocked. `--skip-ci-gates` is rejected
before submit work begins.

`integration_gate.py commit` verifies HEAD/MERGE_HEAD and the index before
finalizing a two-parent merge. `fanout` verifies the same final candidate,
shared repository, clean target, exact inventoried target HEAD and ancestry
before a fast-forward. Receiving HEAD must be one of the manifest's explicit
parents. A review of the relay's last merge cannot authorize delivering
earlier unreviewed changes to an older receiver. Prepare a receiver/final
manifest for that target and prove the full receiving delta on the final
candidate. `github-merge` verifies live PR parents/approval,
required checks and strict server policy before a head-fenced squash merge.
Each defaults to verification only; `--execute` needs the caller's existing
authorization. The wrapper does not grant that authorization.

For submit, pass `INTEGRATION_PLAN`, `INTEGRATION_RESULTS` and
`INTEGRATION_REVIEW` to `make review-submit`. Materialize the actual candidate
in a clean isolated checkout; running only on a parent is insufficient when
the target has diverged. Use the accepted target's verifier/policy checkout,
including when the PR changes the verifier itself.

External CI evidence has a usable publication path:

```bash
python3 tooling/scripts/review/integration_evidence.py pack --pr <number> \
  --plan <external-plan> --results <external-results> --review <external-review> \
  --output <external-dispatch-inputs.json>
# These network writes require the user's PR/evidence publication grant.
gh workflow run integration-evidence.yml --json < <external-dispatch-inputs.json>
# After that workflow succeeds, rerun the PR Review Framework workflow.
gh run rerun <pr-review-workflow-run>
```

The dispatch workflow validates the original evidence using the accepted
base policy and uploads an external artifact named for both current parent
SHAs. PR job `integration-admission` downloads only a successful publication
workflow's matching artifact and verifies the actual merged tree. It never
executes argv from uploaded evidence. Missing/expired/mismatched inputs fail.
Transport is bounded to 60KB compressed and 20MiB decoded; larger evidence
needs a reviewed transport extension, not truncated logs or an approval bypass.

GitHub CI tests this owner on real Git topology and verifies external review
inputs against the current merge candidate. Server enforcement additionally
needs the actual required status check, strict target-update policy, stale
approval dismissal and applicable bypass policy. A workflow in source is not
proof of active branch protection. Audit these read-only; changing repository
policy requires explicit authorization.

Bootstrap is explicit: the new owner and dispatch workflow must first land on
the target branch through independent installation review. Before that, the
base cannot supply this verifier. CI derives that condition from the accepted
base's actual Git objects and history and uses the distinct
`integration-installation-review` context to run owner regressions. It does
not emit a passing `integration-admission` context. If the base previously
contained the owner and it is now missing, CI fails instead of taking the
installation path. Only after a real positive and negative
workflow run should `integration-admission` become required with strict base
updates, stale approval dismissal and admin enforcement. Do not claim that
the unmerged workflow or a local simulated GitHub check is already active.

## Regression and limits

`integration_review_test.py` constructs real temporary Git branches and tests
silent historical UI reversion, propagated merge damage, incompatible
consumers, weakened/deleted standards, stale targets, missing/failed/zero/
skipped checks, incomplete independent review and legitimate integrations.
`--historical-repo` additionally inspects the actual Settings merge objects.
Fixtures are isolated from user worktrees and remove their own resources.

Record rejection reasons, false positives, false negatives and duration.
Published deterministic cases measure the admission contract. New independent
Agent cases must be held out until review responses are frozen; report their
results separately. Known topology cases passing cannot promise zero defects.

Each calibration record declares its source/policy digest, isolated runner,
frozen case IDs and decisions, answer-key comparison, bad/good denominators,
false negatives/positives, tool-call count and measured duration (or explicit
uncollected fields). Persist original findings before fixing them; rerun the
new regression and obtain a bounded independent closure review. Held-out cases
become public fixtures only after judgments are frozen.
