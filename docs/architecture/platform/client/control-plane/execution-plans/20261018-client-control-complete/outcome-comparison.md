# Client Control Outcome Comparison

> **Plan ID**: CCP-COMPLETE-20261018
> **Version ID**: CCP-COMPLETE-20261018-v1
> **Prepared**: 2026-10-19

## Product Outcome

| Concern | Current verified state | Target outcome | Proof boundary |
|---|---|---|---|
| Operator console | Implemented typed console; source and browser checks | Production typed console with auth, validation, diff, request, history, conflict, and recovery | Live provider and repository workflow still required |
| Public reads | No Client Control artifact | Immutable signed protobuf snapshots from static Vercel distribution | Exact byte, digest, header, deployment, and production readback |
| Publication authority | Trusted publisher and Git ledger implementation | Exact-source independent approval, reserved bytes/sequence, signature, preview, promotion | Live signer, approval and Vercel evidence required |
| Desktop | Verified Station registry; one environment seed | Signed cache and separate suggestions/release projection | Kernel and adapter contract; native UI remains unproven |
| Mobile | Verified Station registry only | Same shared verification and separate suggestions/release projection | Kernel and adapter contract; native UI remains unproven |
| Relay/Station deployment | Domain edge reachable; migrated Home Relay and healthy corpstable/Home Stations with active generation-1 enrollment | Current-source durable private attachment | API, persistence, Circuit, protobuf, restart, cleanup; final snapshot binding required |

## Trust Outcome

| Current gap | Target invariant |
|---|---|
| IP/self-signed bootstrap has no public generated contract | Identity and endpoint TLS material are authenticated before dialing and verified again by Station Access |
| Existing OAuth assertions target Station intents | `operator_login` is purpose/audience/receiver bound, one-time, allowlisted, CSRF-protected, and separately revoked |
| Git CAS mechanics are OAuth-internal | One neutral package; OAuth and Client Control retain separate domain stores |
| Browser/admin and publisher do not exist | Admin can write drafts and requests only; it cannot approve, sign, write ledger, or deploy distribution |
| Client cache has no cloud rollback watermark | Shared Rust core enforces exact bytes, key, sequence, digest, channel, time, bounds, and last-known-good |

## Environment Outcome

The sibling env repository remains the source of truth for:

- `peers-touch/home/**`: Relay, PostgreSQL, shared Nginx fragment, certificate
  references, ports, secrets references, and runbook;
- `peers-touch/corpstable/**`: Station topology and stable deployment inputs.

Execution must preserve unrelated dirty env changes. Stable reset, router
mutation, unrelated container/volume deletion, and identity replacement are
outside authorization. A tracked example currently contains a credential-like
literal was removed from current source. External revocation remains unverified
and is not inferred from source cleanup or deployment.

## External Resource Outcome

Current Vercel readback shows four existing projects and authenticated CLI
access. The target adds:

- one `console-admin` project with bounded Functions and scoped credentials;
- one credential-free `distribution` project for static client reads;
- one dedicated data repository and restricted GitHub App installation;
- one trusted publisher approval entry and signer-owned immutable ledger.

Fresh plan/policy/quota and non-commercial eligibility readback is mandatory
before project creation. No paid plan purchase is authorized.

## Completion Meaning

`PROVEN` means all Plan completion Gates bind the same exact source, generated
contracts, service artifacts, endpoint identities, publication bytes, and
deployment identities. It does not mean:

- native Desktop or Mobile selector Acceptance passed;
- Client Control may activate a Station or install an update;
- Vercel commercial scale or paid features were tested;
- router administration or certificate issuance changed owner.

## Current Execution Status

Source implementation now includes the operator auth flow, typed admin console,
trusted publisher and Git ledger, shared signed snapshot core, Desktop and
Mobile adapters, suggestion-only selectors, and the Vercel publication
adapter/CLI. Focused source, browser, adapter, and structural checks are current.

The aggregate remains `UNPROVEN`:

- The operator explicitly affirmed personal open-source, non-commercial use.
  Vercel Hobby preflight passes with six projected/current projects and the two
  isolated Client Control projects now exist. Distribution still has zero
  environment variables.
- Home SSH and HTTPS work through the configured shared public edge. The shared
  Nginx protocol fragments are installed, existing certificate ownership is
  preserved, and corpstable reaches HTTPS and Circuit through domain IPv6.
- Home Relay and corpstable Station run the migrated protocol with preserved
  identities and databases. The retained Home Station has also been migrated
  without resetting its data and re-enrolled. Real Circuit protobuf, signature,
  source authorization, replay and TLS negative controls passed before/after
  restart. Those functional records remain bound to their producing source.
- Four historical invitations were retired with explicit authorization.
  Two historical follower rows lack an identifiable live runtime owner;
  replacement Stations are not fabricated.
- A tracked corpstable provider credential literal was removed from current
  environment source; external revocation of the previously exposed credential
  remains an unverified operator-owned obligation.
- The three previously missing API Gates are registered with business-owned
  environment/provisioner injection. The production Gate requires real private
  authorities; the aggregate rejects missing/stale/incomplete evidence.
- Production catalog, live signer ledger and Preview/Production deployment
  identities do not yet exist. Native UI and receiver-visible Suite lifecycle
  remain unproven; API Gates deliberately retain `PARTIAL/UNPROVEN`.
- Dedicated private data and signer-ledger repositories now exist. The
  repository-scoped data GitHub App exists with Contents read/write only,
  webhooks disabled and installation restricted to the current account; its
  private key and exact repository installation are still being completed.
- The selected corpstable Station is private-only
  (`http://<corpstable-station-ipv4>:18280`). The retained Home Station is
  reachable through a `/station` reverse-proxy path, while public connection
  material requires an independent path-free HTTPS origin. No Direct Station
  seed will be fabricated or published until one reviewed public origin
  satisfies that contract.
- Live hosting implementation now verifies shared console environment
  allowlisting, zero distribution environment, scoped data installation,
  authenticated/unauthenticated admin reads and CSRF write denial. It deploys a
  same-byte Preview, exercises post-promotion identity failure and rollback,
  reads the restored bytes, and releases only the task-owned unaliased Preview.
  Real hosting authorities and factual policy inputs are still required to run
  that journey; the implementation is not a deployment result.
