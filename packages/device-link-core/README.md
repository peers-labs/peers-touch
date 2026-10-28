# Device Link Core

Native Desktop/Mobile share RFC 9180 X25519/HKDF-SHA256/ChaCha20Poly1305
through `hpke-rs`. Shared protobuf types come from `schema-core`; Station
identity verification stays in `station-trust`.

Offer bytes are authenticated by the delegated Station Node. Actor-signed
device certificates authenticate Desktop's approval transcript. HPKE Base
encrypts material and does not authenticate its sender. Credential delivery
requires a separate Node signature over the deterministic HPKE envelope
(including ciphertext and the exact Access/delivery transcript), prefixed
with `peers-touch/device-link/credential/v1\0`.

Sealed bootstrap format is `PTSO1\0 || nonce[12] || ciphertext || tag[16]`.
ChaCha20Poly1305 uses a fresh random 32-byte key per offer, and AAD
`peers-touch/device-link/sealed-offer/v1\0 || SHA256(signed_offer_bytes)`.
The key stays in the QR fragment. The blob owner receives ciphertext only.

The native bootstrap adapter verifies a fresh endpoint challenge before sending
the locator, fixes both request paths, pins checked DNS addresses, disables
redirects and proxies, and limits response reads. Loopback, link-local, metadata
and mapped-address bypasses are rejected; an explicit LAN address remains valid.
Two five-second HTTP operations share a fifteen-second deadline. The Host signs
source proof with the persisted Station/Relay transport scope used for grants.

Hosts persist native private keys and plaintext using their secure-storage
owners. The renderer receives redacted progress, labels and the comparison
code. Neither this crate nor Schema creates or activates Session records.
