# Trust State Pattern

> Status: Shared UI pattern for trust, identity, privacy, and policy states.
> Audience: Product designers, client engineers, reviewers, and AI agents.
> Updated: 2026-06-18.

## 1. Purpose

Peers Touch is a federated product. UI must expose trust boundaries when they affect user decisions.

This pattern applies to station source, actor identity, audience, privacy, permission, moderation, block, degraded runtime, and remote capability states.

## 2. Trust Promise

A trust-state UI must answer:

- What is the state?
- Who or what is the authority?
- How does it affect visibility or action?
- Is it final, pending, degraded, unavailable, or unknown?
- What can the user do next?

## 3. Authority Rules

Trust state must name its authority.

Examples:

- Audience is authored by the posting model/station contract.
- Station moderation is authored by Station policy projection.
- Actor block is authored by relationship/block projection.
- Runtime degraded state is authored by Desktop runtime health.
- Local draft privacy is authored by the composer state.

Rules:

- Do not infer policy from missing data.
- Do not present pending command state as committed policy.
- Do not merge actor block and station block into one visual state.
- If authority is unknown, show unknown/degraded only when useful; otherwise keep metadata quiet.

## 4. Visual Levels

| Level | Meaning | Visual treatment |
| --- | --- | --- |
| Quiet meta | stable source/audience/reason | inline meta line |
| Informational | useful context | quiet chip or tooltip |
| Attention | degraded or partial state | inline notice near affected surface |
| Blocking | action denied or content hidden | explicit recovery/trust surface |
| Dangerous | destructive policy action | confirmation and clear authority |

Rules:

- Stable federation metadata should not look like an error.
- Blocking state must not be hidden inside a tooltip.
- Dangerous policy actions must be visually separated from routine actions.

## 5. State Taxonomy

Use these labels in design and implementation discussions:

- `known`: authoritative state is available.
- `pending`: command sent, authority not yet confirmed.
- `degraded`: authority or runtime is reachable only partially.
- `unavailable`: capability is not available in this context.
- `unknown`: state is not known and should not be interpreted.
- `blocked`: authority confirms the action/content is blocked.
- `hidden`: authority confirms content is hidden by policy.

## 6. Social Application

For Social:

- Source/audience/reason usually use quiet meta.
- Remote station unavailable uses attention state only if it affects current action.
- Station block uses blocking state only when Station policy projection confirms it.
- Moderation command pending uses pending state near the moderation action.
- Missing aggregate projection means no aggregate block notice, not a fake one.

## 7. AI Agent Checklist

- [ ] Did I identify the authority for the trust state?
- [ ] Did I distinguish known, pending, degraded, unavailable, unknown, blocked, and hidden?
- [ ] Did I avoid inferring policy from missing data?
- [ ] Is the visual level proportional to user impact?
- [ ] Is dangerous policy action separated from routine action?
