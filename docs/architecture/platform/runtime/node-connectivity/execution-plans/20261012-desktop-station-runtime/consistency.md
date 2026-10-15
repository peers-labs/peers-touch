# Station Runtime Consistency Closure

The owner approved this correction on 2026-10-13 after the source review of
the Desktop Station runtime. NCP-D16, NCP-D17 and NCP-D18 remain the governing
contracts. No workflow ledger, environment reset, deployment or remote delivery
is authorized by this document.

## Target

Station Access owns a committed entry and its cancellation fence as one atomic
snapshot. Registry records are persisted discovery/selection data; consumers
cannot adopt an active route from a list or authentication read.

Discovery obtains the endpoint-scoped public identity without starting or
closing the active transport. Route preparation may allocate a bounded candidate
driver under the existing transport owner. A failed candidate leaves the old
committed binding usable. Successful selection publishes the new lease,
revokes the old lease, and retires old driver resources outside the lookup lock.
Candidate persistence does not change the committed `active_route_id`, route
contract, or `route_revision`; only the verified selection commit may do so.
When a refreshed authorization keeps the same route ID, the registry persists
that contract in `candidate_route_refreshes` beside the committed snapshot.
Verified selection promotes it atomically and increments `route_revision`;
restart and ordinary discovery cannot silently replace or discard either side.

Same-Station route changes preserve lifecycle-scoped resource references.
Station replacement or removal revokes those references. Canonical Station
origins and relative resource paths are resolved through the logical Station;
external and presigned URLs remain independent.
Desktop projections receive the committed `station_peer_id` and route through
one typed EventBus publication owned by the Station API boundary; endpoint URL
is not a renderer lifecycle identity.

Every transport request retains admission through body completion, cancellation
or drop. Response forwarding is tracked and bounded even with an unread body.
Agent stream admission and body lifetime are distinct deadlines. Synchronous
readers execute on blocking workers. Unknown mutation outcomes remain pending
authority reconciliation and are not converted to terminal rejection.

## Landing And Proof

1. Close binding, discovery, selection and transport lifecycle together.
2. Close stream admission, cancellation, forwarding and mutation outcomes.
3. Close resource classification/cache identity and evidence freshness.
4. Run focused failure/lifecycle regressions, then existing crate and protocol
   checks; re-review all corrected source boundaries.
5. Native product claims require actual current-source product evidence. Missing
   runtime proof remains explicitly unproven regardless of source/test success.

## Consumer Scope Closure

Secure Content executes every Station request through `StationClient` with the
captured `station_peer_id + lifecycle_generation` scope. Its session owns no
endpoint URL or independent HTTP client. A Direct-to-Relay change within the
same Station keeps the Secure Content session and routes the next request
through the newly committed RouteLease; Station replacement rejects the stale
scope before dispatch.

The Desktop capability worker uses the same logical Station scope for worker
identity. Its active receipt persistence uses `station_peer_id`, never an
endpoint. The one-time SQLite migration atomically upgrades an empty v1 schema.
A non-empty v1 row contains only a mutable route origin, so neither the current
registry nor endpoint reachability can prove its historical logical Station
owner; migration fails atomically as unresolved instead of relabeling pending
side effects. The retired capability-operation worker, checkpoint ledger and
cursor store are deleted instead of being migrated as a second inactive owner.
No dual write, compatibility reader or endpoint-keyed runtime path remains.

Rollback is a source revert of the complete correction. No alternate data plane
or compatibility switch is retained.
