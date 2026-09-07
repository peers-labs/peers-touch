# Debug Session: foundation-context-overflow-evidence
- **Status**: [OPEN]
- **Issue**: The exact-source Foundation candidate run aborts before canonical evidence emission because the Agent-domain evidence producer classifies the canonical `BASE-CONTEXT-OVERFLOW` count fields `actual_tokens` and `limit_tokens` as secret-bearing keys.
- **Debug Server**: Not required; the fail-closed candidate producer exception is the existing runtime instrumentation.
- **Log File**: External Acceptance Evidence Store Gate log for run `20260907T183454866557Z-6266f4fffde2e03da2ff7bb3375f71e5`.

## Reproduction Steps
1. Deploy exact source checkpoint `f0080b81f4fca643fea2c1eecb173a7f23141843` to the approved `chat-native-disposable` Station.
2. Run the unchanged `agent-v2-kernel-foundation-e2e` Gate.
3. Let the Foundation scenario runner collect the `BASE-CONTEXT-OVERFLOW` Station readback.
4. Observe candidate serialization fail before canonical evidence emission.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Generic sensitive-key detection matches the substring `token` in the two count fields. | High | Low | Confirmed: `is_sensitive_key("actual_tokens")` and `is_sensitive_key("limit_tokens")` both return true. |
| B | The business evidence should rename or omit the count fields. | Low | Low | Rejected: the accepted Foundation contract and both independent oracles require the exact keys and numeric relation. |
| C | Station emits an unexpected detail schema. | Low | Low | Rejected: `NewContextOverflow` emits exactly `limit_tokens` and `actual_tokens`, matching the accepted plan. |
| D | The Agent candidate producer's explicit safe accounting allowlist is incomplete. | High | Low | Confirmed: `SAFE_SCHEMA_KEYS` allows other token-accounting fields but omits these two canonical count keys. |
| E | Product behavior failed before evidence serialization. | Low | Low | Rejected for this failure: the Gate reached later scenarios and then aborted in `_ensure_evidence_safe`; cleanup passed. |

## Log Evidence
- Gate run: `20260907T183454866557Z-6266f4fffde2e03da2ff7bb3375f71e5`.
- Exact failure:
  `BASE-CONTEXT-OVERFLOW.station-readback.typedError.details.actual_tokens: secret-bearing evidence field is forbidden`.
- Gate duration: `1621.693s`.
- Provisioner cleanup: `DONE / PROVEN / passed`.
- The `BASE-CANCELLED` live, reload, and replay receiver snapshots passed localized terminal-state checks for `en` and `zh-CN` before the producer abort.

## Verification Conclusion
Pre-fix evidence confirms an Agent-domain evidence serialization defect, not a product runtime or Acceptance Core redaction failure. The minimal correction is to add only the two accepted context-budget count keys to `SAFE_SCHEMA_KEYS`, retain rejection of actual credential-bearing names and values, and add focused positive and negative regression coverage.

## Post-Fix Local Verification
- `python3 -m unittest tooling.acceptance.gates.agent.foundation_candidate_producer_test`: `14/14` passed.
- `python3 -m unittest discover -s tooling/acceptance/gates/agent -p '*_test.py'`: `330/330` passed.
- Python compilation for the producer, producer test, and independent scenario oracle: passed.
- `git diff --check`: passed.
- The regression fixture accepts only canonical numeric `actual_tokens` and `limit_tokens` evidence while continuing to reject `api_token`.
- Exact-source run
  `20260907T200003771360Z-b929bc53a314187d9947ef9e4a824613`
  on `1f5cf2e31bcd8091a937d41816c42120004bb6a8` crossed
  `BASE-CONTEXT-OVERFLOW` without another secret-field rejection and advanced
  to `BASE-CREDENTIAL_MISSING`.
- The fix is runtime-confirmed, but this session stays `[OPEN]` and its
  diagnostics remain until Owner confirmation permits cleanup.
