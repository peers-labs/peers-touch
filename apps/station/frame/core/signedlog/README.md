# Signed log primitives

`Canonical` and `Decode` enforce exact deterministic protobuf encoding without
unknown fields or maps. `SigningBytes`, `Hash` and `Verify` add a caller-owned
domain separator and Ed25519 verification. This package owns no log, sequence,
authorization, persistence, network route or consensus policy.
