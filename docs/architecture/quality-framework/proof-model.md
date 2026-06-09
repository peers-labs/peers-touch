# Quality Framework Proof Model

> This document defines what the framework proves and what remains a review
> judgment.

## 1. Proof Categories

| Category | Meaning | Examples |
|---|---|---|
| Machine-proven | checked by scripts and can fail CI/local pipeline | bad range fail-closed, hard-rule fixture, gate tier validation |
| Evidence-proven | proven by a gate run or report artifact | `station-chat-unit` passed, quality evidence generated |
| Review-proven | decided by an agent reading code and evidence | source-of-truth correctness, knowledge semantic delta |
| Owner-approved | requires accountable human decision | security waiver, rollout risk, product tradeoff |
| Unproven | selected or described but not actually evidenced | env gate not run, DOM behavior not exercised |

## 2. Machine-Proven Properties

`tooling/scripts/review/skill-check.sh` proves:

- required review skill sections exist;
- Review Learning Check exists;
- Framework Growth Opportunities exists;
- all growth decision categories are present;
- hard-rule fixtures still trigger;
- growth fixtures are well-formed;
- invalid git ranges fail closed;
- knowledge `owns:` directory matching works;
- quality evidence JSON has required top-level fields;
- acceptance tier filtering works;
- submit-time PR pipeline wiring is present.

These checks prove the framework shape has not silently regressed. They do not
prove a particular product change is correct.

## 3. Evidence-Proven Properties

Quality evidence proves:

- which files changed;
- which review profiles matched;
- which knowledge entries matched;
- which acceptance features were impacted;
- which gates were selected;
- which scope remains unproven.

Acceptance run evidence proves only the scope stated by the relevant capability
contract. For example, `desktop-check` proves type compatibility, not DOM-visible
behavior.

## 4. Review-Proven Properties

The review agent must decide:

- whether implementation preserves the correct source of truth;
- whether matched knowledge is semantically respected;
- whether unproven scope is acceptable for the PR;
- whether tests prove the actual risk;
- whether a finding should become knowledge, gate, fixture, skill, or CI/tooling
  growth.

These decisions cannot be replaced by scripts without encoding more project
knowledge into repository assets.

## 5. Owner-Approved Properties

Some decisions must remain accountable human decisions:

- product behavior changes with unclear intent;
- security/privacy waivers;
- data migration and rollback risk;
- hard-rule exceptions;
- release readiness when required environments cannot run.

The framework narrows these escalations. It does not eliminate them.

## 6. Non-Claims

The framework does not claim:

- every bug will be caught;
- every agent will reason identically;
- environment-heavy gates always run in PR CI;
- knowledge semantic consistency is script-decidable;
- green CI means merge approval.

The framework does claim:

- quality starts before PR creation;
- evidence is generated in a consistent shape;
- unproven scope is visible;
- review learning has durable repository targets;
- future agents inherit merged framework growth.
