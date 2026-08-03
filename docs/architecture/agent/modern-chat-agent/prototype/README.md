# Modern Chat Agent — Prototype

> **Status**: confirmed
> **Version**: v1.0
> **Created**: 2026-07-30 | **Updated**: 2026-07-30
> **Owner**: Peers-Touch Agent Team

---

## Prototype Location

Canonical Peers product prototype:

`packages/prototypes/desktop/features/modern-chat-agent/`

It is mounted inside the single visible Desktop Shell Agent surface. The
historical benchmark prototype is superseded and remains only as source
evidence. External benchmark names must not define the product ID, title,
route, or user-facing terminology.

## Delivery Target

- Desktop Agent module in `apps/desktop/`.
- Station-backed Modern Chat Agent behavior.
- Future Mobile follows the product/platform contract but is not implemented
  by this prototype.

The prototype is an executable expression of product states. It is not product
code or runtime evidence.

## Run

```bash
make run-prototype
```

## Product Contract Coverage

Required review coverage:

| Product area | IDs | Required prototype evidence |
|---|---|---|
| Setup/readiness | MCA-P01, J01-J02 | Ready, checking, degraded, blocked, recovery |
| Topics/chat | MCA-P02-P03, J01/J03 | Draft, first acceptance, streaming, terminal, restart projection |
| Context intelligence | MCA-P04, J04 | Memory/skill/knowledge attribution and inspection |
| Tools | MCA-P05, J05 | Progress, approve, deny, expire, fail, result |
| Attachments | MCA-P06, J06 | Validate, upload, ready, reject, retry |
| Queue/recovery | MCA-P07, J03/J07 | Queue edit/delete/promote, disconnect, replay, failure |
| Branch/revision | MCA-P08, J08 | Retry vs regenerate vs edit-resend and branch navigation |
| Capability/diagnostics | MCA-P09-P10, J09 | Degraded/blocked notices, usage, feedback, diagnostic detail |
| Portability | MCA-P11 | Narrow-container semantics and explicit Desktop-only capability |

## Focused Review URLs

Run `make run-prototype`, open the visible `Desktop` entry, then use:

| State | URL query | Tangible interaction |
|---|---|---|
| First turn | `?surface=chat&state=modern-first-turn` | Send -> accept -> stream -> complete -> new topic |
| Queued follow-ups | `?surface=chat&state=modern-queued-followups` | Edit, promote, and remove queued messages |
| Tool approval | `?surface=chat&state=modern-tool-approval` | Approve once, deny, expire, and reset |
| Ask user | `?surface=chat&state=modern-ask-user` | Select and submit a structured decision |
| Attachment failure | `?surface=chat&state=modern-attachment-failure` | Remove rejected input or choose a compatible model |
| Context intelligence | `?surface=chat&state=modern-context-intelligence` | Inspect memory, skill, and knowledge attribution separately |
| Disconnect recovery | `?surface=chat&state=modern-disconnect-recovery` | Reconnect -> replay -> reconcile |
| Branch/regenerate | `?surface=chat&state=modern-branch-regenerate` | Create and navigate immutable sibling branches |
| Capability degradation | `?surface=chat&state=modern-capability-degraded` | Compare blocked input and degraded reasoning |
| Usage/diagnostics | `?surface=chat&state=modern-usage-diagnostics` | Submit feedback and prepare redacted diagnostics |

The Modern Chat review path uses Peers Agent terminology and explicitly labels
Station authority. Historical benchmark product copy and marketing do not
define this product model.

## Focused Revision Verification

- `pnpm --filter @peers-touch/prototype-portal build`: PASS.
- L1 source gate: PASS. Ten states, `MCA-P01` through `MCA-P11`, and the
  required interactive actions are present in
  `features/modern-chat-agent/src/ModernChatReview.tsx`.
- L2 visual gate: EVIDENCE CAPTURED. Full-page screenshots of all ten states
  saved in `evidence-l2/` directory:
  - `01-first-turn.png` through `10-usage-diagnostics.png`.
  - Each state renders correct title, description, state-specific UI, and
    MCA capability badges.
  - Awaiting Owner visual inspection and confirmation.
- L3 dynamic gate: PASS in headless Chrome through the visible Desktop Shell.
  Actual browser clicks verified first-turn completion, queue edit/promote,
  approval, ask-user, attachment compatibility, context source switching,
  reconnect/replay, regenerate/branch, capability degradation, feedback, and
  diagnostic export interactions.
- L3 exposed and verified one correction: attachment readiness is now derived
  from the parent attachment collection after changing to a compatible model.

## L2 Evidence Index

| File | State | Key visible elements |
|---|---|---|
| `01-first-turn.png` | First turn | Research Agent profile, composer with "Reply with TEST_OK", Send button, draft badge |
| `02-queued-followups.png` | Queued follow-ups | Three queued messages with Edit/Promote/Remove actions |
| `03-tool-approval.png` | Tool approval | Desktop Capability Session card, file read request, target/risk disclosure |
| `04-ask-user.png` | Ask user | Structured decision options, Useful/Needs work rating buttons |
| `05-attachment-failure.png` | Attachment failure | Rejected attachment, compatibility explanation, recovery options |
| `06-context-intelligence.png` | Context intelligence | Memory/Skill/Knowledge tabs, source attribution entries |
| `07-disconnect-recovery.png` | Disconnect recovery | Reconnect button, persisted findings, "turn may still be running" notice |
| `08-branch-regenerate.png` | Branch/regenerate | Original/Regenerate/Next branch navigation, sibling branch indicator |
| `09-capability-degraded.png` | Capability degradation | Blocked input notice, model capability mismatch, degraded reasoning options |
| `10-usage-diagnostics.png` | Usage/diagnostics | Feedback controls, redacted diagnostic export, evidence attached to turn |

## Ledger Status

`ready-for-owner-review`

The Peers product prototype is independently registered as
`modern-chat-agent`. L1 source, L2 visual evidence, and L3 dynamic interaction
gates all pass. The historical benchmark prototype does not satisfy or block
this product gate; only the focused Modern Chat review and Owner decision
apply.

## Remaining Gate Items

- Owner visual review of L2 screenshots in `evidence-l2/`.
- Owner confirmation to mark prototype `confirmed`.
- Independent PRODUCT review pass (P4 gate).
- Prototype evidence cannot prove persistence, actor isolation, runtime
  cleanup, or product E2E (that is EXECUTE stage work, not prototype work).
- Artifact behavior (MCA-P13) is optional and deferred per approved product decision.
