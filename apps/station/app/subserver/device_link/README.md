# Device Link

Station owns the durable authorization aggregate under `/auth/device-link/*`.
`application/` coordinates CAS, claims, opaque identity delivery and secure
credential acknowledgement; `domain/` defines exact cryptographic bindings;
`infrastructure/` adapts the existing Node Connectivity and HPKE implementations.

Actor Identity, Access and Session participate through their transaction-aware
owner ports on the same database connection. Pending enrollment stays inside the
offer; neither the Actor Device nor its Session becomes active before ack.
Multiple installations have independent offers, keys and Sessions.

Capabilities are derived using purpose-separated HMAC from the existing Station
keyring and persisted only as hashes with a key ID. Public offer storage removes
the scan secret; the complete offer is retained only inside its sealed bootstrap
blob. The creating Desktop can recover the same response during the five-minute
window. Key retirement fails closed; no local cache is authorization truth.
Exact Create replay survives later profile changes. A fresh command atomically
retires only its original Session's uncommitted offer before allocation, allowing
a restarted Desktop to replace a lost receiver key without persisting that key.

TTL cleanup releases only inactive Sessions and this aggregate's Access scope.
Committed devices and Sessions remain owned by their original modules.

Contract: [Mobile Scan Login](../../../../../docs/architecture/domains/identity/mobile-scan-login/README.md).
