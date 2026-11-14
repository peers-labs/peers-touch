# Provider Station Ownership

Status: accepted. Owner: Agent domain. Updated: 2026-10-30.

Station owns Provider configuration, model catalogs, credentials, access and
execution. Its existing Dashboard authenticates administrators independently
of Actor sessions and delegates shared management to Agent. Ordinary clients
consume authorized models and manage their account's default selection.

The governing shared-management contract is
[Provider Control Plane](../provider-control-plane.md). The installation
contract is [Managed CLI Installation](../provider-managed-cli-install.md).

Personal Providers are disabled by default. Enabling them permits Actor-owned
configuration through the existing Agent services. A shared Provider with the
same logical ID takes precedence; denial never falls back to a personal record.
Credentials and installation state are not ordinary consumer projections.

All HTTP and CLI inference executes on Station, including applet one-shot
completion. CLI installation is Station-wide; invocation state, HOME, cache,
temporary files and workspaces remain isolated per requesting Actor. Model
discovery uses the effective resource owner. Streaming responses use the
existing Station SSE contract; one-shot completion uses its typed response.

Documents:

- [Design](design.md): authority, boundaries and dispatch.
- [Data model](data-model.md): explicit owners and concurrency.
- [Integration](integration.md): current source mapping and verification.
- [Decisions](decisions.md): accepted invariants.

Historical execution plans record past work and do not override these contracts
or establish current-source verification.
