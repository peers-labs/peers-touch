---
name: pt-acceptance-gap-detector
description: >
  Detects missing or invalid Acceptance evidence without modifying code.
  Invoke before completion, quality, commit, PR readiness, or proof claims.
---

# Acceptance Gap Detector

## Invoke When

Invoke before:

- marking a product task or Acceptance workstream complete;
- claiming a runtime journey, Gate, or capability is proven;
- generating quality evidence;
- committing or opening a ready-for-review PR;
- approving or merging a PR.

Pure formatting, documentation navigation, and CI-cheap checks that make no
product claim do not require this skill.

## Core Rule

No source-bound runtime evidence means `UNPROVEN`.

`PASSED`, `BLOCKED`, `FAILED`, and `UNPROVEN` are distinct states. Never replace
a required receiver/runtime Gate with build, unit, static, API-only, browser,
screenshot, stale, dry-run, or manually assembled evidence.

This skill is read-only. It detects and dispatches gaps; it does not modify
product code, Acceptance contracts, Gates, manifests, or reports.

## Workflow

1. Read [`PROCEDURES.md`](./PROCEDURES.md) in full.
2. Identify the exact claim, changed range, selected Gates, and latest run.
3. Run:

   ```bash
   python3 tooling/scripts/acceptance-gap-detect.py \
     --claim "<exact claim>" \
     --range <range>
   ```

4. Apply the four-layer review from the procedure:
   product promise, Gate coverage, evidence integrity, failure honesty.
5. If the detector or manual review finds a gap:
   - keep the claim `UNPROVEN`;
   - record gap type, evidence, owner stage, and minimum closure;
   - dispatch closure through `pt-acceptance-engineering`.
6. If no gaps remain, report the exact Gate and source artifact supporting the
   narrow claim. Do not generalize beyond that scope.

## Output

Use:

```markdown
**Claim**
- <exact claim>

**Evidence**
- <Gate>: <source artifact and runtime identity>

**Gaps**
- <gap type, owner stage, required closure>

**Verdict**
- PROVEN | UNPROVEN | BLOCKED | INVALID
```

## Verification

```bash
python3 tooling/scripts/acceptance-gap-detect-test.py
git diff --check -- \
  tooling/skills/pt-acceptance-gap-detector \
  tooling/scripts/acceptance-gap-detect.py \
  tooling/scripts/acceptance-gap-detect-test.py \
  AGENTS.md
```

## Anti-Patterns

Never:

- change code or evidence while acting as the detector;
- accept a command exit code without inspecting proof metadata;
- treat provisioning success as product proof;
- treat `BLOCKED` as `PASSED` or `FAILED`;
- accept hand-written attestation, actor identity, or evidence;
- rerun until green without diagnosing the first failure;
- approve a claim while a required Gate is unrun or stale.
