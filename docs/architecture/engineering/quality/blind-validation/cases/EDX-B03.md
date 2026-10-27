# EDX-B03: Switch the Active Station

## Starting Context

The Desktop onboarding screen has several saved Stations. One is active, one is
reachable, and one is offline.

## User Goal

Switch to a different Station with a clear understanding of the target,
connection state, trust boundary, and next access step.

## Required Sources

- `apps/desktop/src/views/OnboardingView.tsx:17-65`
- `apps/desktop/src/components/common/StationPicker.tsx:31-205`
- `apps/desktop/src/components/common/StationPicker.tsx:235-415`
- `apps/desktop/src/components/common/StationPicker.tsx:417-753`
- `docs/architecture/platform/station/access/experience-contract.md:28-68`
- `docs/client/common/ui-identity/modules/auth/README.md:24-79`

## States To Walk

- picker closed;
- picker open while reachability refreshes;
- active, reachable, offline, and unknown Stations;
- switching succeeds or fails;
- adding succeeds or fails;
- removing a saved non-active Station;
- leaving the picker without changing the target.

## Review Boundary

Review Station selection as a trust-sensitive target and scope change. Do not
infer that a reachability probe proves Station identity. Do not require Desktop
and Mobile to use the same component.

Return the report required by `rubric.md`.
