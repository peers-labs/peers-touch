---
name: pt-acceptance-pipeline-auditor
description: Audits reusable Acceptance Suite lifecycle, proof strength, and resource efficiency. Use for Plan review, runtime reuse checks, or repeated provisioning investigations.
---

# Acceptance Pipeline Auditor

## Invoke When

- A Plan contains multiple product scenarios sharing services, actors, clients,
  devices, or login state.
- Acceptance is slow, repeatedly provisions resources, or produces weak proof.
- Reviewing a Plan, runtime report, completion claim, or Acceptance refactor.

Do not use this Skill to implement product journeys or to weaken required
receiver-visible evidence.

## Core Rule

```text
Expensive resources belong to Task or Suite scope.
Business data isolation belongs to Scenario scope.
Product actions and assertions belong to the real product surface.
```

The audit is read-only. It reports gaps and their owner. It never edits a Plan,
runtime report, product Gate, or evidence artifact.

## Workflow

1. Read the target Plan Package and selected Task Slices.
2. Require each multi-scenario runtime Task to declare `runtimeReuse`.
3. Run the contract audit:

   ```bash
   python3 tooling/scripts/acceptance-pipeline-audit.py \
     --plan <plan.md> \
     --tasks <task-id[,task-id...]>
   ```

4. When a Suite Runtime report exists, include each immutable report:

   ```bash
   python3 tooling/scripts/acceptance-pipeline-audit.py \
     --plan <plan.md> \
     --tasks <task-id[,task-id...]> \
     --runtime-report <suite-report.json>
   ```

5. Inspect the result for:
   - one Suite-scoped provisioning boundary;
   - no account, client, login, build, or deployment action owned by a Scenario;
   - bounded client launches and declared warm-reuse rate;
   - stable source digest and fixture epoch;
   - real UI action and receiver-visible assertion per required Scenario;
   - terminal cleanup;
   - no Harness-only substitution.
6. Route findings by ownership:
   - generic lifecycle, schema, validator, or reporting defect ->
     `pt-acceptance-infra-engineering`;
   - concrete actor, Fixture, Gate, Journey, or product assertion defect ->
     `pt-acceptance-engineering`;
   - stale Task mapping -> Plan amendment owner.

## Output

Report:

```markdown
**Pipeline Audit**
- Plan / Tasks:
- Contract result:
- Runtime result:
- Reuse metrics:
- Findings:
- Owner:
- Strongest claim:
```

`PASS/SUPPORTING` proves only lifecycle conformance. Product readiness still
requires the Task's exact-source functional and formal Acceptance evidence.

## Verification

```bash
python3 tooling/scripts/acceptance-pipeline-audit-test.py
python3 -m unittest tooling.acceptance.tests.test_suite_runtime
tooling/scripts/review/skill-check.sh
```

## Anti-Patterns

Never:

- create a Domain-specific lifecycle implementation in Acceptance Core;
- accept a per-Scenario client or account rebuild as isolation;
- treat Provisioning, Harness, API, screenshot, or exit-code success as product
  proof;
- infer runtime reuse from elapsed time without a Suite Runtime report;
- mutate evidence to make an audit pass;
- create a second project Skill when this audit contract already applies.
