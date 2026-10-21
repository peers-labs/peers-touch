# Audience-Bound Operator Login

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-18 | **Updated**: 2026-10-18
> **Owner**: Identity and Access

---

## 1. Current Boundary

The existing broker emits `account_login` or `connector_link` assertions for
Station-bound callers. It does not issue a X Config operator session.
Those existing intents, secrets and acknowledgement flows are retained.

This accepted contract adds operator login at the OAuth owner so X Config does not
implement another provider callback, PKCE store, or identity verifier.

## 2. Contract

Define the inter-app assertion in `model/domain/oauth` before implementation:

```text
purpose: operator_login
audience: registered service ID
site_id
assertion_id
provider
provider_subject
receiver_challenge
issued_at
expires_at
```

The broker registers an exact HTTPS callback for the control-admin site and a
separate site signing key. The signed audience and purpose cannot be supplied
or overridden by the callback. Provider username/email is display metadata,
not the allowlist identity; use the stable provider subject.

## 3. Login Flow

1. Admin creates a bounded login attempt and browser-bound receiver secret.
2. Broker completes the existing durable state/PKCE/provider flow.
3. Broker redirects to the exact admin callback with an opaque one-use handoff
   code. The code is bound to audience, login attempt and receiver challenge;
   it contains no assertion or provider credential.
4. Admin redeems the code server-to-server with its receiver verifier and
   site authentication. Broker consumes it durably and returns the generated
   signed assertion. Admin verifies purpose, audience, signature, expiry and
   receiver binding.
5. Admin consumes the assertion ID durably through its own data-store CAS and
   checks the operator's stable provider subject against the reviewed allowlist.
6. Admin creates a short-lived operator session with a secure, HTTP-only,
   same-site cookie, per-session CSRF binding and durable revocation/readback.

Assertion expiry is at most two minutes; operator session is at most one hour.
Callback assertion and receiver secret do not enter URLs, analytics or logs.
Handoff codes are redacted from request logs, never passed to third-party
resources, and removed by a clean redirect after redemption. The callback sets
`Cache-Control: no-store` and `Referrer-Policy: no-referrer`. Broker handoff
storage survives Function-instance changes and rejects replay before returning
another assertion.

## 4. Independent Authorization

Operator login authorizes typed draft editing and publication requests only.
It does not authorize Station Access, Relay administration, production
signing, GitHub code writes, or distribution deployment.

Broker and admin use separate signing/session keys. Station bridge secrets and
provider credentials are never copied into X Config.

## 5. Proof And Status

Required proofs: cross-audience/purpose replay rejection, assertion replay
across Function instances, wrong receiver/expired assertion, exact callback
allowlist, unauthorized provider subject, CSRF, session revoke and secret
redaction. Existing Station account-login and connector-link behavior must pass
regression proof after the shared infrastructure extraction.

No contract or runtime has been changed yet. Implementation and runtime proof
remain execution obligations.
