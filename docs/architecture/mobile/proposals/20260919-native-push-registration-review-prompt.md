# MS-D23A Review Prompt

Review:

`docs/architecture/mobile/proposals/20260919-native-push-registration-amendment.md`

## Review Boundary

Close W7 push registration and callback ownership without preserving the old
`actor_id` schema, exposing provider credentials to Web/readback, or allowing
push/native callbacks to become business truth.

## Required Questions

1. Is authenticated PTID the only actor identity and is request `device_id`
   required to equal the authenticated device assertion?
2. Are APNs, FCM, and UnifiedPush represented as typed, mutually exclusive
   provider bindings with explicit development/production environment?
3. Are request ID, install epoch digest, lifecycle generation, and provider
   binding validation sufficiently strict and bounded?
4. Are exact replay, request-ID conflict, same-tuple rotation, cross-tuple
   provider conflict, and unregister idempotency deterministic?
5. Can any response, list/readback, error, telemetry, or log reveal provider
   tokens, endpoints, encryption keys, secrets, plaintext credentials, or a
   dictionary-attackable raw digest?
6. Does persistence encrypt provider credentials with authenticated associated
   data and fail closed when the Station key is unavailable?
7. Do stale, duplicate, decreasing-sequence, expired, or wrong-scope native
   callbacks terminate without Web events or Station mutation?
8. Are logout, actor switch, Station replacement, token rotation, permission
   revocation, provider invalidation, and failed unregister cleanup defined?
9. Does a push receipt only mark projections stale and reconcile?
10. Does a push tap reconcile and authorize before navigation?
11. Is the payload bounded and free of title, body, private content,
    credentials, decryption material, and authority state?
12. Are production source completion and physical provider delivery evidence
    kept separate?

## Independent Review Result

**Verdict**: `ACCEPT MS-D23A`

**Accepted**: 2026-09-19

The review found no unresolved ownership, identity, idempotency, security,
lifecycle, cleanup, or failure-semantic gap after the following corrections
were incorporated into the amendment:

- provider readback exposes only a Station-scoped HMAC fingerprint, not a raw
  token digest;
- unregister binds actor, device, registration, and app-install epoch;
- provider credential protection failure returns unavailable without weakening
  the authenticated session;
- exact replay and request-ID/body mismatch have distinct outcomes;
- Web receives only a redacted reconcile intent after Rust generation and
  sequence checks;
- deterministic simulator proof remains W7-PROOF; provider delivery and
  physical iOS/Android execution are optional diagnostics under MS-D26.
