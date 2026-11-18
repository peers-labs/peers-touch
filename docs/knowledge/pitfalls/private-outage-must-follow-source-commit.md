---
kind: pitfall
title: Private receiver outage follows source commit
status: active
owns:
  - apps/station/app/subserver/social/private_delivery_acceptance
  - tooling/acceptance/fixtures/social_private_delivery.py
  - tooling/development/secure_content/runtime_owner.py
related:
  - docs/architecture/domains/social/cross-station/integration.md
referenced-by: []
detected: 2026-11-16
---

# Private receiver outage follows source commit

## Symptom and root cause

AS21 admitted a retained Native draft, stopped its receiver, then attempted
publication. It failed with `RECIPIENT_KEY_UNAVAILABLE` and no committed Post.
Admission prepares a plan; CSS-D10 still revalidates the remote PreKey claim
online before the source transaction.

## Mitigation

Commit online under the opt-in receiver's finite private Post hold. Prove one
pending original outbox, its exact held wire hash and zero receiver rows, then
stop the same container and retry the original publication twice. Restore and
release before settlement. Keep remote validation, ordinary receiver policy,
invalidation handling and immutable command identity unchanged.

## How to detect a recurrence

```bash
python3 -m unittest tooling.acceptance.tests.test_social_private_delivery \
  tooling.acceptance.gates.social.test_cross_station_support
python3 tooling/scripts/acceptance-run.py --gate social-private-desktop-e2e \
  --runtime-cell desktop-macos-native \
  --service-profile station-four=fedlab-a \
  --service-profile station-five-arm=fedlab-b \
  --service-profile relay=fedlab-a
```

Run the original private Native selection and inspect AS21's source-bound
commit, hold, before-delivery, outage, retry and delivered observations. The
runtime-owner regression must reject a missing commit, mismatched frame,
preexisting receiver row and changed retry Post before claiming success.
Arm and publication failures must retain release; outage failures must restore
before release and preserve the original failure. A draft admission or API
failure alone is not durable-delivery evidence.
