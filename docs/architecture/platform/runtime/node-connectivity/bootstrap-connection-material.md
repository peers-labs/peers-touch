# Endpoint Bootstrap Connection Material

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-18 | **Updated**: 2026-10-18
> **Owner**: Node Connectivity

---

## 1. Ownership And Current Source

This is the accepted extension to the existing Model peer contract. It is not a
replacement for `StationConnectionEnvelope`, signed endpoint discovery, Node
authorization, route attestation, or Station Access binding.

Current foundation:

- `model/domain/peer/access_endpoint.proto` owns endpoint and connection wire.
- `packages/station-trust` verifies Station root, Node authorization and routes.
- Station Access owns first binding, expected-root pinning and replacement.
- Desktop rejects remote HTTP discovery; Mobile permits it only in
  Debug/Acceptance builds.
- Production self-signed bootstrap material remains unimplemented until the
  accepted execution Plan lands and is proved.

## 2. Public Material

The peer domain defines one generated `PublicEndpointConnectionMaterial`:

```text
schema_version
canonical_discovery_origin
expected_endpoint_role
expected_endpoint_identity
expected_station_root?        # required for a Direct Station
endpoint_tls_trust?           # endpoint-scoped CA or SPKI, never a global root
issued_at
expires_at
```

The expected Relay identity is its libp2p PeerID/public-key binding. A Direct
Station binds its logical Station root; live Node identity may rotate only
through valid root delegation.

This material is public and contains no connection grant, invite, Session,
enrollment credential, private key, or access token. Existing private connection
material retains its owner and cannot be copied into a public catalog.

`SignedPublicStationAdvertisement` contains exact signed bytes for:

```text
schema_version
station_peer_id
station_root_public_key
connection_material_digest
public_discovery_consent
advertisement_sequence
issued_at
expires_at
```

Node Connectivity owns its domain-separated signature and Go verifier; the
shared Rust `station-trust` package owns equivalent client verification.
Canonical field allocation and key encoding are defined in peer proto before
generation. No manual Go/Rust/TS DTO becomes a second wire source.

## 3. Bootstrap Trust

Material must be authenticated before dialing:

- by a verified official control snapshot;
- by an existing Station binding; or
- by out-of-band transfer from the expected operator, such as a connection file
  or QR code whose provenance the user trusts.

A response fetched from an untrusted HTTP address cannot authenticate the
expected root carried in that same response. Self-signature proves key
possession, not that the key belongs to the intended operator.

WebPKI HTTPS remains supported for domains and IP SANs. Self-signed HTTPS uses
an endpoint-scoped imported CA or SPKI. A CA does not replace Station identity
verification and is never installed as a global client trust root.

Pinned HTTP is limited to public challenge-based discovery. It requires
authenticated expected identity before the request, a fresh 32-byte challenge,
bounded response/time, endpoint role/signature, and current Node/route proof.
It sends no connection grant, credential, Session or business payload.

Production bare remote HTTP remains rejected. Debug/Acceptance permissions do
not authorize production plaintext business traffic.

## 4. Business Connection

After discovery, Node Connectivity opens the existing Direct/Circuit route and
verifies destination PeerID, delegated Node identity, TLS SPKI and expiry before
credentials. Station Access alone can commit the verified binding and invoke
Access Gate. No cloud selection, CA import or discovery signature commits it.

Manual user confirmation records the intended Station choice; it is not a
substitute for authenticated expected identity when bootstrap lacks WebPKI.

## 5. Failure, Rotation And Withdrawal

- Origin syntax is canonical; userinfo, path, query and fragment are rejected.
- Different root/Relay identity fails before credentials; root replacement is
  explicit, never catalog-driven.
- Node key/SPKI rotation requires current delegation and route proof.
- Expired public material or consent cannot authorize fresh catalog discovery.
- Withdrawal prevents future publication; a disconnected client learns it on
  refresh or expiry. No immediate offline revocation is claimed.
- Existing verified Stations continue under Station Access policy.
- Grant-only routes cannot be published as public suggestions.

## 6. Required Proof

Owner proof must cover:

- substituted HTTP endpoint/root, fresh-challenge replay and wrong origin;
- wrong-role/Relay PeerID, forged delegation, expired consent and wrong SPKI;
- valid IP/self-signed material through the existing encrypted route;
- bare remote HTTP rejected and no credentials/grants sent during bootstrap;
- no global certificate bypass and one shared verifier per language;
- valid Node rotation preserves Station scope, root replacement does not;
- Desktop and Mobile adapter contracts are separate from native runtime proof.

This contract is a prerequisite for advertising non-WebPKI candidates. Until
implementation and owner proof exist, published candidates use the currently
supported trust path.
