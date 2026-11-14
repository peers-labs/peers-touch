# Provider Station Ownership — Integration

Status: accepted. Owner: Agent domain. Updated: 2026-10-30.

## Station

`catalog/providers.default.yaml` registers built-in adapters. Catalog declarations
are product metadata; consumer visibility additionally requires effective owner,
enablement, models and grants.

`ProviderConfigService`, `ModelConfigService`, `CredentialConfigService` and
`RuntimeAdmissionResolver` share owner resolution. `ProviderService` revalidates
the selected owner, revisions and grant at dispatch.

`provider_management_port.go` connects Dashboard authentication to the same
Agent services. `/dashboard/api/ai/*` manages shared Providers, models,
credentials, grants, policy and installation. Actor management endpoints apply
the personal policy and cannot mutate shared resources.

`service/cli/managed` owns shared installation. `service/cli/environment` builds
private invocation and discovery environments. Executor and discovery use the
same builder; wrappers never set the user's HOME.
Configuration checks use Agent's registered argv and managed PATH. They report
configuration and binary availability, not a successful upstream completion.

The operational guard is
[Provider Execution Owner Boundary](../../../../knowledge/invariants/provider-execution-owner-boundary.md).

## Desktop

`application/provider/mod.rs` and `station_api.rs` proxy authorized and personal
Station views. Tauri commands do not resolve raw credentials or install tools.

Ordinary Desktop has no Provider settings module or Direct/CLI editor.
`store/provider.ts` retains effective-owner projections and account default
commands; the authenticated actor management contract remains policy governed.
`ModelServiceTab.tsx` reads and writes the Actor's Station default with its
observed revision. Provider and Agent stores discard old Session completions.

Applet `ai.chat` delegates to Station QuickCompletion. The native Provider
inference module and local model configuration registry have been removed.
One-shot completion validates the requesting Actor and current Provider grant.

## Dashboard and Federation

Dashboard mounts only the active page. AI mounts one selected Provider editor
with DM/CLI selection. CLI installation belongs inside that Provider's editor.
The same page configures global AI user access, credentials, models and grants
and verifies a real call as an explicitly selected authorized user.
It polls installation progress while visible. Authentication changes clear
management stores, secret drafts and old request completions.

Federation management uses the Federation domain's management port behind
Dashboard authentication. Its native Acceptance fixture performs a separate
Dashboard administrator login for each mutation and closes that session.
Only `acceptance-webdriver` mounts those fixture commands. The ordinary Desktop
has only identity, context, resolve and catalog projections.

Reviewed development Profiles use their existing `peers` bootstrap administrator.
Fixture owners may override `PT_ACCEPTANCE_DASHBOARD_USERNAME` and
`PT_ACCEPTANCE_DASHBOARD_PASSWORD` in the native process environment. They must
not place credentials or administrator tokens in frontend state or reports.
Dashboard preserves its existing single-session login policy: a fixture login
revokes the same administrator's previous session. Run fixture setup before
Dashboard UI verification, then log in for the UI journey.

## Verification

Run affected Provider/CLI service tests, Dashboard authentication/management
tests, Desktop Provider/default/session tests, Dashboard build and Desktop
type/native checks. Broader suites are selected only when the change requires
them.

Current-source functional verification covers administrator setup, grants and
revocation, shared calls, personal policy, account defaults, real CLI installation
and recovery, private execution state, and wide/narrow layouts.
Source checks and mocked unit regressions do not prove real native journeys.
Remote runtime evidence requires the canonical current-source deployment.
