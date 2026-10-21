---
kind: pitfall
title: Native Station identity cannot use a maintenance tunnel
status: active
owns:
  - tooling/development/secure_content/runtime_owner.py
  - tooling/acceptance/gates/agent/foundation_runtime_client.py
related:
  - docs/architecture/shared/security/secure-content/operations.md
  - docs/architecture/platform/runtime/service-coordination.md
referenced-by: []
detected: 2026-10-19
---

# Native Station Identity Cannot Use A Maintenance Tunnel

## Symptom

The exact-source CSS-09 Native Desktop Suite failed before login with
`Endpoint statement fields are invalid`. A read-only discovery probe returned
the original challenge and a valid time window, but its signed canonical
origin was the reviewed remote Station origin while the request used an
ephemeral loopback SSH tunnel.

## Root Cause

The runtime owner used its maintenance transport URL as the Native client's
Station input. Signed endpoint discovery binds identity to the canonical
origin, so a transport alias cannot become a client identity.

## Mitigation

`_make_client` derives the Native Station input only from the reviewed
Profile's `PT_STATION_URL`. Its old caller-supplied `station_url` parameter is
removed from every consumer. Owner-side attestation and Fixture operations
retain their maintenance tunnels. Product discovery validation is unchanged.

## How To Detect A Recurrence

```bash
python3 -m unittest tooling.development.secure_content.test_runtime_owner
```

`test_client_launch_uses_projected_runtime_source_commit` requires the
normalized Profile origin. Missing origins fail before Native client
construction. The CSS-09 Native Suite must also reach login through real
signed Station discovery on current source.

## Crosswalks

- Secure Content operations defines client identity and maintenance transport.
- Service coordination requires verified endpoint identity before Access.
