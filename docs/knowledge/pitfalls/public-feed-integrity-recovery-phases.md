---
kind: pitfall
title: Public feed integrity checks need causal rejection and recovery phases
status: active
owns:
  - tooling/acceptance/gates/social/public_feed_native.py
  - tooling/acceptance/gates/social/test_public_feed_native.py
related:
  - docs/architecture/domains/social/federation/actor-feed-log.md
  - docs/client/desktop/runtime-projections.md
referenced-by: []
detected: 2026-11-15
---

# Observe rejection before passive recovery

The public Native Suite completed publication, restart, Relay capture and lost
acknowledgement scenarios, then timed out waiting for corrupt-read recovery.
The replacement receiver's current log recorded `FEED_INVALID` about 41 seconds
after publication. The original Runtime retries every 45 seconds; the next
cycle fell after the caller's single 80-second wait. The fault owner's lease
lasts 90 seconds, so merely extending that wait also risks losing valid scoped
observation through expiry.

The original integrity scenario first waits at most 80 seconds for its exact
one-shot Native rejection. It retains that bounded snapshot before retiring
the consumed mutation rule, then arms the same owner's passive `observe-reads`
control for the next original Runtime cycle. Recovery retains the original
80-second painted-content oracle, actual Native read observation, authentic
previous Post identity and unchanged 90-second control lifetime. No scenario
calls a repair/read Harness, forces sync, changes the Runtime interval or
accepts unverified content. Its measurement combines both scoped read samples.

Both phase snapshots survive cleanup. A timeout independently attempts the
last Native observation and screenshot/DOM capture, preserves the first
exception and clears the owned control without marking the scenario complete.

The normal-submit baseline also retains its last passive Native read sample
before clearing the observation. Its failure independently records the
receiver's actual document visibility, focus and card count, then attempts
Native screenshot/DOM capture. Diagnostic or cleanup errors cannot replace the
original publication/paint failure. These observations distinguish no original
read from an unpainted imported result; they do not change document visibility,
trigger sync or extend the original painted-card deadline.

## How to detect a recurrence

Run `python3 -m unittest
tooling.acceptance.gates.social.test_public_feed_native`. The actual original
scenario must retain the expected rejection before observation rearming, use
the passive control for recovery, combine bounded actual read counts and reject
receiver timeout even when diagnostic capture also fails. Then run the selected
`social-public-feed-native-e2e` Journey on current source; source tests cannot
establish automatic Native recovery.
The baseline regressions must retain an immutable zero-read sample and attempt
document/rendering observations independently, including when all diagnostics
and final control cleanup fail. A successful baseline measures the original
read and adds no failure diagnostic.
