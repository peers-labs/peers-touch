---
kind: pitfall
title: Profile aliases must share one role conflict owner
status: active
owns:
  - tooling/acceptance/provisioners/__init__.py
  - tooling/acceptance/tests/test_profile_bindings.py
  - tooling/acceptance/tests/test_provisioning_owners.py
referenced-by: []
related:
  - docs/architecture/engineering/acceptance/module-layout.md
detected: 2026-10-24
---

# Profile alias conflict ownership

## Symptom

The public factory and its shared-constructor branch independently rejected
Station/Service Profile aliases. The constructor compared entire maps, so
non-overlapping role assignments could be rejected despite having no conflict.
The public check also changed the diagnostic observed by the existing
Cross-Station contract regression.

## Root cause

Alias validation and constructor routing both owned conflict semantics.
Whole-map equality conflated a partial role allocation with a conflicting
allocation.

## Mitigation

The public factory validates overlapping roles once, in sorted order, before
resolving the selected adapter. Different Profiles for the same role fail closed.
The shared constructor merges non-conflicting role assignments. Registration
does not resolve an active Profile, infer service topology, or acquire resources.

## How to detect a recurrence

Run from the selected worktree:

```bash
.local/acceptance/python-venv/bin/python3 -m unittest \
  tooling.acceptance.tests.test_profile_bindings \
  tooling.acceptance.tests.test_provisioning_owners.CrossStationSocialProvisioningOwnerTests
```

The tests require pre-construction rejection of conflicting aliases and complete
delivery of disjoint role assignments to the selected adapter.
