# Agent LobeHub Parity - License And Attribution Boundary

> **Status**: implemented-for-design
> **Version**: v0.1
> **Created**: 2026-07-07 | **Updated**: 2026-07-07
> **Owner**: Peers-Touch Agent Team
> **BOM**: BOM-011, BOM-012, BOM-015
> **Spec**: SPEC-014
> **Plan Step**: PLAN-P1 / PLAN-P2 / PLAN-P4
> **Gates**: GATE-001, GATE-002, GATE-008
> **Evidence**: EVID-011-Q-pre

---

## 1. Purpose

This document defines how Peers-Touch may use `external/lobehub` during Agent parity design, prototype work and future migration.

It is a design-time compliance boundary, not legal advice. If product implementation needs direct code, asset, copy text, or package reuse from LobeHub, the implementation batch must obtain an explicit project approval before merging.

## 2. Observed Source Facts

| Source | Observed fact | Impact |
| --- | --- | --- |
| `external/lobehub/package.json` | `license: MIT`; repository `https://github.com/lobehub/lobehub.git`; author `LobeHub <i@lobehub.com>` | Package metadata alone is not sufficient because the root license file is stricter. |
| `external/lobehub/LICENSE` | `LobeHub Community License`, copyright `2024/06/17 - current LobeHub LLC`; based on Apache 2.0 with additional commercial/derivative conditions. | Treat direct source/asset/text copying as restricted unless reviewed and approved. |
| `external/lobehub/src/**` | Used as source-level reference for routes, stores, services, runtime and UI structure. | Safe for architecture mapping and behavioral comparison; not automatically safe for direct code reuse. |
| Peers-Touch prototype evidence | Current `agent-lobehub-parity` prototype uses source paths as reference evidence and mock data/states. | Prototype review may reference LobeHub structure, but must avoid direct asset/text/code copy claims. |

## 3. Allowed Uses Without Additional Approval

| Use | Allowed | Required attribution |
| --- | --- | --- |
| Source audit | Yes | Record LobeHub source paths in `source-audit.md`, `component-map.md`, prototype README or ledger evidence. |
| Capability matrix | Yes | Cite source path and capability name; classify Peers gap/target separately. |
| Architecture design | Yes | Record that LobeHub is a reference object; Peers ownership and contracts must be original Peers-Touch design. |
| Prototype information architecture | Yes | Cite source paths and live audit IDs; use Peers-Touch UI Identity and own implementation. |
| Mock data / unresolved state modeling | Yes | Do not copy user data, proprietary text, or LobeHub branded marketplace content as product content. |

## 4. Restricted Uses

| Use | Default decision | Required before use |
| --- | --- | --- |
| Copying LobeHub source code into Peers product code | forbidden by default | Explicit license review, attribution plan, and batch evidence before merge. |
| Copying LobeHub assets, icons, illustrations, marketplace cards or branded content | forbidden by default | Asset license review and replacement plan. |
| Copying large UI text blocks or documentation text | forbidden by default | Attribution and content review; prefer Peers-authored copy. |
| Shipping a derivative product implementation that is materially based on LobeHub code | blocked | Legal/commercial license decision outside this architecture doc. |
| Treating `package.json` MIT as sole authority | forbidden | Root `LICENSE` must be considered authoritative until legal review says otherwise. |

## 5. Implementation Batch Rules

Every PLAN-P5 implementation batch that references LobeHub must include a short license line in its Evidence row:

```text
LobeHub use: source-path reference only; no direct code/asset/text copy.
```

If a batch copies or ports a specific source fragment, the Evidence row must instead include:

```text
LobeHub use: direct reuse requested; license review evidence <path/id>; attribution file <path>; copied source <path>; Peers target <path>.
```

No implementation batch may claim done if this line is missing.

## 6. Prototype Rules

The `agent-lobehub-parity` prototype may:

- expose LobeHub source path references,
- mirror information architecture and interaction categories,
- use Peers-authored mock records and labels,
- express unresolved/tool-limited states discovered in live audit.

The prototype must not:

- claim to include LobeHub product assets,
- claim to include copied LobeHub source,
- use LobeHub license status as product migration permission,
- remove the product migration fail-closed boundary.

## 7. Attribution Locations

| Artifact | Required attribution shape |
| --- | --- |
| `source-audit.md` | Source path table for each audited capability. |
| `component-map.md` | Source component path per mapped UI region. |
| `prototype-lobehub-parity/README.md` | Source list for prototype surfaces. |
| `tmp/agent-lobehub-fullstack-ledger.md` | Evidence row with LobeHub source path and use boundary. |
| Future product PR | PR description or evidence document must state source reference only, or link license review for direct reuse. |

## 8. Stop Conditions

Stop a migration batch if any of these are true:

1. A product file contains copied LobeHub code without license review evidence.
2. A product UI ships LobeHub assets or marketplace content without review evidence.
3. A reviewer cannot determine whether a behavior came from source-level reference or direct copied implementation.
4. A batch omits LobeHub attribution while claiming LobeHub parity.
5. A batch uses prototype parity as a substitute for product license review.

## 9. Current Claim

SPEC-014 is implemented for design and migration planning.

It is not product implementation approval. It does not resolve commercial licensing for direct derivative work.
