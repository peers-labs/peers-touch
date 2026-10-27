# UI/UX Agent Blind Validation

> Status: evaluation-only
> Source snapshot: `9b8693ec9d48b86b51eb6ef915b803f25c468f49`
> Owner: Experience Design + Quality

## Purpose

This package checks whether a UI/UX Agent can:

- find real product and interaction problems from source evidence;
- avoid inventing blocking problems on sound designs;
- inspect waiting, failure, retry, cancellation, and recovery;
- apply the same reasoning standard across Desktop and Mobile;
- separate source fact, product contract, and inference.

It does not authorize product changes. It does not prove that the current
implementation is product-ready.

## Isolation

The blind runner receives only:

- `manifest.json`
- `rubric.md`
- `cases/`

The runner must not read `reviewer-only/`. A human reviewer opens that
directory only after all six case reports are frozen.

Cases may or may not contain a blocking issue. The runner must decide from the
provided evidence instead of assuming every case is defective.

## Run Order

1. Confirm the source checkout matches the manifest snapshot.
2. Give the blind runner `rubric.md` and one case at a time.
3. Freeze each report before opening the next case.
4. After all reports are frozen, give them to a human reviewer.
5. The human reviewer scores them with `reviewer-only/answer-key.md`.
6. Record failed reasoning patterns before changing any Agent rule.

Do not tune the Agent between cases in one run. That would turn the holdout
set into training data.

## Result Boundary

Passing this package means the current reasoning model survived this small
calibration set. It does not prove general UI/UX quality. The first real
product requirement must still run as a separate blind validation.
