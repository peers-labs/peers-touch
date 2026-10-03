# W12A Desktop Storage Path Amendment Review

## Review Scope

Review the mechanical W12A inventory correction in:

- `tasks/W12A.md`
- `../20260913-secure-content-work-items.yaml`

Governing sources:

- `plan.md`: W7-W11 source failures reopen W12A before mutation.
- `docs/architecture/secure-content/README.md`
- `docs/architecture/messaging-platform/README.md`

## Failure Evidence

W8 Suite Runtime
`w8-suite-d94fddb7e8b9-27236-1790694181666781000` authenticated the
cross-Station remote recipient, then failed to open `chat.main.db`. The
database path was exactly 512 bytes because the full account identity was used
as one storage directory component. The missing messaging engine then kept the
Secure Content supervisor unavailable.

## Expected Review

1. W12A owns the Desktop storage path fix before source mutation.
2. The focused check exercises the bounded database path behavior.
3. Encryption key identity and existing short-scope storage paths remain
   unchanged.
4. The new operational invariant records the cross-runtime path-budget rule.
5. W8 remains pending and its prior runtime evidence remains unproven.

## Validation

```bash
make plan-validate \
  PLAN=docs/architecture/secure-content/execution-plans/20260913-secure-content-hard-cut/plan.md
python3 -m unittest tooling.development.secure_content.test_work_item
```

## Verdict

通过。No findings: the amendment is limited to W12A source inventory,
focused regression coverage, and operational knowledge. It does not change the
Journey, dependency graph, runtime authorization, or evidence strength.
