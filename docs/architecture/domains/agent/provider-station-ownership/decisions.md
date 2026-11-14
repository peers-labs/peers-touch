# Provider Station Ownership — Decisions

Status: accepted. Owner: Agent domain. Updated: 2026-10-30.

## Station execution

All HTTP and CLI inference executes on Station. Desktop and Mobile are
authenticated clients. Applet one-shot inference uses Station QuickCompletion.
Streaming inference retains the existing SSE owner.

## Dashboard management

The existing Station Dashboard is the shared configuration surface. It uses
independent administrator sessions and delegates through Agent's management
port. Actor JWTs cannot authorize shared mutation or CLI installation.

## Explicit resource owners

Provider, model and credential records name Actor or Station ownership.
Shared Provider identity takes precedence. A denied shared record never falls
back to the requesting Actor's same-named private record.
Personal Providers are disabled by default and enabled through Station policy.

## Separate revisions

Configuration, models, policy, grants and defaults retain their appropriate
optimistic revisions. Credential set replaces the full submitted key;
credential deletion requires its observed version. Credential changes invalidate Provider
snapshots. Grant replacement has a separate atomic access revision; grant
revocation is rechecked at every dispatch and tool continuation.

## Secret confinement

Credentials are write only in management views and encrypted at rest with the
Station KEK envelope. Envelope authentication binds the resource and its owner.
No consumer can retrieve shared secrets by logical ID, storage UUID, model
selection or inference gateway.

## Shared code, private invocation

Station owns one managed installation per adapter and atomically activates
verified immutable versions. Every invocation has private Actor HOME, tool
state, cache, temporary files and workspace. Explicit environments exclude host
login state and unrelated credentials. Directory isolation is not an OS sandbox.

## Account defaults and scope

The existing Station runtime default owns each Actor's composite Provider/model
selection. Desktop has no app-global model registry. All async projections and
mutation effects validate the initiating Session or administrator epoch.

Detailed contracts: [Control Plane](../provider-control-plane.md),
[Managed CLI](../provider-managed-cli-install.md), [Design](design.md),
[Data Model](data-model.md).
