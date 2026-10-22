# X Config

> **Status**: active
> **Version**: v2.1
> **Created**: 2026-10-17 | **Updated**: 2026-10-20
> **Owner**: Client Platform
> **Module**: `apps/x-config/`

---

## 1. Document Scope

X Config is the public, read-only client control plane consumed by Desktop and
Mobile before Station access. It defines:

- signed, monotonic protobuf snapshots;
- curated Relay and owner-approved Direct Station seeds;
- typed release descriptors;
- client fetch, verification, cache, rollback protection, and suggestions;
- one operator console and API for draft, validation, direct publication, and
  history;
- one Home service, Home-local operator authentication state, and one shared
  GitHub publication repository with an isolated `x-config/` namespace.

It does not define Relay transport, Station identity, Access Gate, Session,
Federation membership, automatic endpoint activation, arbitrary remote
commands, or public Station self-registration. Those remain owned by
[Node Connectivity](../../runtime/node-connectivity/README.md) and
[Station Access](../../station/access/README.md).

## 2. Product Contract

1. Desktop and Mobile receive usable Relay and Direct Station suggestions.
2. A suggestion becomes a Station record only after canonical signed discovery.
3. The sole allowlisted operator can edit, review, sign, and publish without a
   separate approval service.
4. Every publication atomically advances a repository-backed sequence and
   stores the exact signed bytes.
5. Public clients fetch the persisted bytes from the same service without
   authentication.
6. Client launch remains local-first when X Config is unavailable.

## 3. Current Architecture

- Runtime: one Home `peers-x-config` service behind the HTTPS edge declared by
  the environment repository (`$X_CONFIG_HOME_ORIGIN`).
- OAuth broker: existing `peers-touch-oauth`.
- Operator state: Home-local SQLite with a dedicated persistent volume.
- Publication App/repository: existing OAuth GitHub App and
  `<github-owner>/peers-touch-oauth-client-data`.
- X Config Git storage boundary: `x-config/catalogs/`,
  `x-config/publications/`, and `x-config/snapshots/`.
- Signing: service-held Preview key, validated against the client-embedded
  public key.
- Sequence: compare-and-swap against the shared repository head.
- Public reads:
  `/channels/<channel>/latest.pb` and
  `/snapshots/<channel>-<sequence>.pb`.

There is no separate data repository, ledger repository, publisher process,
approval service, or distribution project.

## 4. Design Goals

1. One signed snapshot contract for Desktop and Mobile.
2. One Home deployment and one Git transaction per publication.
3. No split-brain publication state.
4. Typed, closed configuration sections only.
5. Cloud data remains suggestion data, never Station authority.
6. Exact bytes and monotonic sequence survive service restart.
7. OAuth provider flow stays owned by the Broker; X Config owns only its local
   operator authorization and session.

## 5. Navigation

- [product-definition.md](./product-definition.md)
- [experience-contract.md](./experience-contract.md)
- [product-state-model.md](./product-state-model.md)
- [design.md](./design.md)
- [decisions.md](./decisions.md)
- [data-model.md](./data-model.md)
- [module-layout.md](./module-layout.md)
- [integration.md](./integration.md)
- [acceptance-matrix.md](./acceptance-matrix.md)
- [runtime-verification.md](./runtime-verification.md)
- [Home operator-state cutover plan](./execution-plans/20261020-x-config-home-operator-state/plan.md)
- [unified service cutover plan](./execution-plans/20261019-x-config-unified-service/plan.md)
- [historical frozen plans](./execution-plans/)

## 6. Proof Boundary

Current-source source checks, focused browser evidence, real OAuth login,
Home restart persistence, absence of Git-backed operator state, GitHub
publication persistence, public byte readback, and client-core signature
verification are required for Preview closure.

Production promotion, native Desktop/Mobile UI, and receiver-visible Suite
lifecycle remain separate proof obligations until explicitly authorized and
executed.
