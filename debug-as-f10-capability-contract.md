# Debug Session: as-f10-capability-contract
- **Status**: [OPEN]
- **Issue**: The exact-source Foundation run reaches Browser AS-F10, but the
  production Harness emits no `scenarioFacts`, so the independent oracle
  rejects the tuple before capability-session behavior can be judged.
- **Debug Server**: http://127.0.0.1:7778/event
- **Log File**: `.dbg/trae-debug-log-as-f10-capability-contract.ndjson`

## Reproduction Steps
1. Use worktree `peers-ai-agent`, branch
   `feat/p0-streaming-runtime-message-actions`, profile `two`.
2. Deploy Station and build the Acceptance Desktop binary from the same clean
   source commit.
3. Run `agent-v2-kernel-foundation-e2e` with
   `PT_AGENT_V2_ALLOW_STATION_RESTART=1`.
4. Observe the first Browser AS-F10 tuple.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| A | The Harness never dispatches a dedicated AS-F10 production scenario | High | Low | `foundationDirectProbe` reaches generic capture with `scenarioFacts=null` |
| B | Existing capability-session snapshots already contain the session/device facts required by the AS-F10 oracle | High | Low | Local and Station snapshots identify one matching Browser session with zero advertised local capabilities |
| C | Existing negative-control emitters can produce unauthorized, signature-tamper, and cross-device rejection facts without product changes | High | Medium | Each control returns an available Station response and zero local execution deltas |
| D | Unsupported and schema-mismatch controls remain unavailable because no production ToolCall trigger reaches `ProposeBatch` | High | Low | Both controls return `NO_PRODUCTION_CAPABILITY_ENDPOINT` |
| E | Runtime activity snapshots can prove no Desktop fallback or hidden local execution during rejected controls | Medium | Medium | Before/after Station and local counters remain equal for the selected runtime |

## Instrumentation
- Record redacted capability-session identity hashes, platform, capability
  count, selected-device relation, negative-control availability/error codes,
  and before/after activity counter deltas.
- Do not record PTIDs, device IDs, session IDs, credentials, payloads, or
  signatures.
- The first checkpoint records only session counts, selected-session presence,
  platform, capability count, readiness/session hash equality, and whether
  `scenarioFacts` exists before the AS-F10 oracle.

## Log Evidence
- Exact-source run
  `20260831T082106648095Z-a1595ad4fd43eec41174008c202daca4`
  on `844bec385c66952850f067eef4bdf44a4aa5443c` passed all required
  Browser AS-F07 tuples and advanced to Browser AS-F10.
- The independent oracle failed closed with
  `AS-F10 capture must contain scenarioFacts`.

## Verification Conclusion
- Hypothesis A is confirmed by the runtime failure and source inspection.
- Exact-source diagnostic run
  `20260831T093813288204Z-28c5b5e4e8ee97991078a25b59449f96`
  on `ab0934e8bd6c6ef6472ca476dc61465aee0a1c4f` confirms hypothesis
  B for Browser: one local session matches one of two Station sessions,
  `CLIENT_PLATFORM_BROWSER` is selected, the session advertises zero local
  capabilities, and the readiness-selected session hash matches.
- The local producer now executes a short Station-backed Turn, calls all five
  existing acceptance-gated negative controls, derives selected-device
  ownership from Station readiness, and records the controls' before/after
  local execution counters. Unsupported and schema-mismatch remain explicit
  `NO_PRODUCTION_CAPABILITY_ENDPOINT` facts. Post-fix runtime evidence is
  pending for hypotheses C-E.
