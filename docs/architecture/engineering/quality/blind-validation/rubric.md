# Blind Runner Rubric

## Task

Review one case at a time. Decide whether the bounded user journey has a
blocking UI/UX problem.

Do not assume that every case is defective. Do not redesign the whole product.

## Required Output

Start with exactly one verdict:

- `FINDINGS`
- `NO_BLOCKING_FINDING`

For every finding, provide:

1. Severity: `blocking`, `major`, or `minor`.
2. Source evidence: file, symbol or line range, and the concrete UI behavior.
3. User impact: what the user cannot understand, complete, trust, or recover.
4. Owning layer: content, information architecture, interaction, state and
   recovery, trust, platform adaptation, or implementation.
5. Correction direction: the product property to restore, without prescribing
   arbitrary styling.
6. Confidence: `high`, `medium`, or `low`.

End with:

- states checked;
- exit and retry paths checked;
- facts separated from inference;
- remaining unproven points.

## Severity

- `blocking`: the journey should not pass a design gate.
- `major`: the journey works only through avoidable ambiguity, hidden
  knowledge, excessive recovery distance, or weakened trust.
- `minor`: polish or local clarity issue that does not materially block the
  journey.

## Evidence Rules

- A finding must cite a visible action and response, not only a code smell.
- A missing state counts only when the bounded journey can enter that state.
- A prototype may prove intended interaction but never production readiness.
- Desktop and Mobile may use different controls while preserving the same user
  intent, state meaning, and recovery result.
- Do not convert a personal style preference into a product defect.
- Do not report architecture, security, or runtime claims that the supplied
  sources cannot prove.

## Review Lens

Check only what is material to the case:

- Is the user's intended outcome clear?
- Does each visible label add new information?
- Are decisions introduced only when the user must make them?
- Are loading, failure, retry, cancellation, and completion truthful?
- Is the recovery action close enough to the failure?
- Is trust information visible when it changes the decision?
- Can keyboard or touch users complete the same intent?
- Does the platform mechanism preserve the shared product meaning?
