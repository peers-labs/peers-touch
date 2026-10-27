# Actor Session Store

`DBStore` is the sole persistent Session authority. Active sessions are unique
per `station_peer_id + user_id + device_id`; `user_id` is a storage key, while
public boundaries use Actor PTID. Client class remains `desktop | mobile | web`.

`RevokeReplacedDeviceSessions` runs inside the caller's transaction and locks
the Actor before replacing only that installation's session. Access Gate,
OAuth acknowledgement and explicit takeover share this rule. Account-wide
revocation is a separate operation.

`ActivatePendingDeviceSession` validates the complete inactive delivery binding
inside its caller's transaction before replacing this installation's old
Session. `DeletePendingDeviceSession` removes only an exact unacknowledged
delivery scope. Device Link uses these ports after the receiver's secure ack;
it cannot activate a Session by writing its own parallel store.

Migration removes the client-class index, normalizes historical class names,
revokes active rows with missing Station/device bindings, and deduplicates
only identical device scopes. PostgreSQL writers are fenced for the complete
transaction. `Set` cannot change an existing scope or resurrect a revoked row.

Canonical contract:
[Station Access](../../../../../../docs/architecture/platform/station/access/data-model.md).
Focused verification: `go test ./core/facility/session` from `apps/station/frame`.
