# X Config - Product Definition

> **Status**: active
> **Version**: v2.1
> **Created**: 2026-10-17 | **Updated**: 2026-10-20
> **Owner**: Client Platform

---

## 1. Product Thesis

One Peers-Touch operator needs one audited control surface to publish safe
client bootstrap suggestions and release metadata without turning those
suggestions into Station identity or executable remote configuration.

## 2. Users

### Operator

- Manage Relay and public Direct Station seeds.
- Manage Desktop and Mobile release descriptors.
- Validate endpoint trust and owner consent.
- Review exact changes and publish immediately.
- Inspect publication sequence, signer, digest, and history.
- Restore historical content as a new draft.

### Desktop or Mobile user

- Receive curated suggestions without losing local Station choices.
- Distinguish suggestions from verified Station entries.
- Continue through canonical signed discovery after selection.
- Continue using local state when X Config is unavailable.

## 3. Product Promise

The operator can validate, review, sign, and publish one exact typed revision
from one console. Clients consume it as optional signed suggestions; X Config
never silently changes their active Station or executes code.

## 4. Capabilities

| ID | Capability | Product result |
|---|---|---|
| CCP-C01 | Snapshot overview | Shows revision, sequence, digest, key, age, and inventory |
| CCP-C02 | Endpoint catalog | Typed Relay/Direct Station CRUD and validation |
| CCP-C03 | Owner consent | Invalid Direct Station consent blocks publication |
| CCP-C04 | Release catalog | Typed platform/architecture release metadata |
| CCP-C05 | Draft diff | Exact changes and blocking findings are visible |
| CCP-C06 | Direct publication | Confirmation atomically signs and publishes; unchanged content can renew at a higher sequence |
| CCP-C07 | Failure recovery | Draft survives validation, conflict, signing, and storage failure |
| CCP-C08 | History/restore | Historical content becomes a new draft; sequence never rolls back |
| CCP-C09 | Client suggestions | Desktop/Mobile receive non-authoritative seeds |
| CCP-C10 | Typed upgrade projection | Matching clients receive metadata, never commands |
| CCP-C11 | Multi-operator RBAC | deferred |
| CCP-C12 | Public self-registration | unsupported |
| CCP-C13 | Generic feature flags | unsupported |

## 5. Trust Promise

- Cloud publication proves X Config publisher origin, not endpoint identity.
- Station Access and Node Connectivity remain identity and route owners.
- Bare remote HTTP without pre-authenticated expected identity is rejected.
- Business and Session traffic never falls back to plaintext.
- The browser never receives service credentials or signing keys.
- The current single-user service intentionally combines admin and signing
  authority; compromise can publish a valid snapshot.
- Clients still reject tamper, wrong channel, expiry, rollback, and malformed
  data.

## 6. Console Contract

Surface type: dense operator control surface.

Main subject: current draft versus latest signed publication.

Reading path:

```text
revision and publication status
  -> endpoint/release inventory
  -> selected item and validation
  -> exact diff acknowledgement
  -> immediate publication
  -> history and restore
```

Primary action: `Publish now`, enabled only after validation, current repository
state, non-empty diff, and explicit acknowledgement.

Required states:

- signed out;
- loading;
- clean/editable;
- dirty;
- validating;
- validation failed;
- ready to publish;
- publishing;
- published;
- publish failed;
- source conflict;
- repository history unavailable.

Rejected patterns:

- raw YAML as the primary workflow;
- publish without exact diff;
- pending external approval state;
- technical deployment plumbing in normal UI;
- browser credential/key entry;
- status communicated only by color.

## 7. Non-Goals

- Relay invitation or Station attachment management.
- Arbitrary environment variable editing.
- Endpoint owner self-registration.
- Automatic Station selection or replacement.
- Release installation.
- Multi-operator approval or separation of duties.

## 8. Platform Matrix

| Capability | Browser console | Desktop | Mobile |
|---|---|---|---|
| Catalog CRUD | required | unsupported | unsupported |
| Validate and publish | required | unsupported | unsupported |
| Publication history | required | unsupported | unsupported |
| Consume snapshot | diagnostic only | required | required |
| Render suggestions | unsupported | required | required |
| Verify selected endpoint | unsupported | required | required |

## 9. Feasibility

- GitHub App auth and CAS reuse `packages/github-repository`.
- OAuth reuses the existing audience-bound broker contract.
- Home-local operator state uses a mature SQLite transaction boundary and
  remains separate from Git-backed publication truth.
- Signing uses standard Ed25519 and the existing protobuf envelope.
- Sequence and bytes commit atomically in the shared repository.
- Home hosts one X Config service behind the owned HTTPS edge.
