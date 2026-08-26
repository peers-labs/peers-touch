# Debug Session: native-restart-session
- **Status**: [OPEN]
- **Issue**: Bob's Linux Native process restarts without restoring the authenticated session from the same actor runtime.
- **Debug Server**: Existing Acceptance evidence store
- **Log File**: Gate runtime launch ledger, actor manifest, and per-launch app logs

## Reproduction Steps
1. Provision `desktop-linux-native` from an exact clean commit.
2. Launch Alice and Bob with isolated actor storage.
3. Complete the product journey through attachment byte-exact proof.
4. Stop Bob for the offline-recovery journey.
5. Relaunch Bob with `restore_session=True`.
6. Observe `chat.getRealtimeDevice` fail with `Authentication required`.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Expected signal | Evidence |
|----|------------|------------|--------|-----------------|----------|
| A | The offline journey invokes final-release stop before the restart-preserve path. | High | Low | The first stop removes the actor root; the later preserve stop is a no-op on an already stopped session. | Confirmed |
| B | Relaunch allocates a different storage root or profile. | Medium | Low | Runtime launch ledger differs between Bob's first and second launch. | Rejected |
| C | Process termination occurs before authenticated session state is durably flushed. | Medium | Medium | Storage persists, but session files are absent or incomplete before and after stop. | Rejected as first boundary |
| D | Relaunch uses the same files but a mismatched profile/session identity rejects them. | Low | Medium | Storage hashes match while startup logs report profile or identity mismatch. | Not the first failed boundary |

## Log Evidence
- Exact-source Linux run
  `20260826T073823612788Z-0e517904e462d341f44e9fce53135a4e`
  at `7d16692e018871800d6d4967f17a68b609df1ebd` passed pre-offline
  snapshot equality and failed while restoring Bob.
- Bob's first launch and restart request used the same
  `chat-native-bob` profile, WebDriver/Gateway ports, and
  `/workspace/run/actors/bob/storage` path.
- The generic Linux `actor-stop` implementation terminated the process and
  then recursively removed `/workspace/run/actors/bob`, including `home` and
  `storage`. The restart was therefore a fresh installation, not a process
  restart.
- The lifecycle fix adds an explicit `preserve_state=True` stop mode. It
  releases WebDriver, the application process, actor tunnels, PID/log files,
  and the XDG runtime directory while preserving actor `home`, `storage`, and
  fixtures. The default stop mode still recursively deletes the actor root.
- Exact-source post-fix run
  `20260826T082942781415Z-57efe84357ca1fb91ccfd34e9ff444f0`
  at `c84b2c40a731e9569f3266cf018b0770d9de7284` produced distinct
  `bob-01.log` and `bob-02.log` evidence and reused the same
  `chat-native-bob` profile, ports, and storage path. The second launch still
  returned `session_missing`.
- Source reconciliation then identified the remaining ordering defect:
  `prove_offline_recovery()` first called the default
  `self.clients["bob"].stop()`, which performed final release. Its later call
  to `restart_actor("bob")` attempted `stop(preserve_state=True)` only after
  the session was already stopped, so preservation could not recover the
  deleted state.
- The Gate orchestration now models restart as explicit phases:
  `stop_actor_for_restart()` performs preserve-stop and
  `restore_actor_after_restart()` relaunches and verifies the same device
  identity. The offline journey uses those phases around the offline send;
  ordinary restart journeys compose both phases.
- Framework post-fix evidence:
  - Linux runtime-cell plus launcher/session focused tests: 47/47 PASS.
  - Acceptance framework tests: 264/264 PASS.
  - Acceptance Infra boundary: 8/8 PASS.
  - Quality Evidence tests: 12/12 PASS.
  - Acceptance validator tests: 8/8 PASS.
  - Chat Native static Gate:
    `20260826T081806247075Z-093043b43cb08bbad853e228b60cb9d2` PASS.
  - Offline lifecycle ordering static Gate:
    `20260826T090128565292Z-f17bae649dcdefb4914193fe3dd54e03`
    PASS.
  - Acceptance Infra validation:
    `20260826T081826549831Z-5244377bf6bf20971158a937f0fbad86`
    `STRUCTURALLY_VALID`.
  - Acceptance plan self-check:
    `20260826T081840885139Z-8d85535039e501dac11039b4f9de1ffc`
    PASS.

## Verification Conclusion
Hypothesis A is the evidence-confirmed first failed boundary. Hypothesis B is
rejected by the source-bound launch ledger. Hypothesis C is not reached because
the Gate deleted the persistent state before relaunch. The generic lifecycle
has separate restart-preserve and final-release semantics; the Chat Gate now
uses the preserve phase at the actual offline transition. The debug session
remains open pending an exact-source Linux Native post-fix run that proves
authenticated session restoration and the remaining MP-W13 journey.
