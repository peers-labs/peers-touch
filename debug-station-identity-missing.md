# Debug Session: station-identity-missing
- **Status**: [OPEN]
- **Issue**: The same group does not show its Station attribution in the visible Desktop UI, and current Acceptance coverage may only verify backend Station identity/readback.
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-station-identity-missing.ndjson

## Reproduction Steps
1. Launch Alice and Bob Desktop clients against the Acceptance Station.
2. Sign in with different group members.
3. Open the same group and its Details panel.
4. Observe that Station attribution is absent.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Rust conversation projection contains Station IDs but the frontend projection drops them | High | Low | Confirmed: log line 2 contains authority Station ID; TypeScript mapper omits it |
| B | Frontend projection contains Station IDs but Header and Details do not render them | High | Low | Confirmed: Desktop projection type and Chat surfaces contain no Station field/surface |
| C | Alice and Bob receive different federation/self Station projections | Medium | Medium | Inconclusive: active registry entry has no peer ID/label, but only one live client was sampled |
| D | Acceptance verifies Station build/readback only, not visible Station attribution | High | Low | Confirmed: Gate assertions cover restart/readback; no Station DOM selector or assertion exists |
| E | Running product and Acceptance binaries do not match current source | Medium | Low | Inconclusive: running worktree is correct; latest report lacks tested/source commit identity |

## Log Evidence
Pre-fix instrumentation installed at:
- `apps/desktop/src/services/im-service.ts`: raw Rust command payload and mapped TypeScript projection.
- `apps/desktop/src/components/chat/ChatDetailPanel.tsx`: active conversation keys and visible Station surface count.

Pre-fix runtime evidence:
- Line 1: active Station URL exists, but registry metadata reports `peerId=null`, `label=null`, `online=false`.
- Line 2: conversation `2a24ee4592034de9903d0e04e6` carries authority Station ID `12D3KooWNvqw4A848Zqmz1c19vuxL9B9rrEPxEBmpUMAF1FXdFAW`.
- Rust `messaging_list_conversations` returns `authority_station_id`.
- TypeScript `im-service.listConversations()` and `DesktopIMConversationProjection` omit the field.
- The latest `chat-native-interactions-run.json` reports Station restart/readback PASS but has null `tested_commit` and `source_commit`, and no Station DOM assertion.
- Line 3: attachment count alignment is `composerPreviewCount=1`, Engine attachment counts all `0`, and Details media count `0`.
- Native-picker preview constructs `asset://localhost/<absolute-path>` instead of using Tauri `convertFileSrc`, matching the broken composer thumbnail.
- `messaging_send_message` returns `draft` and `attachment_failed` as successful command envelopes; the Desktop caller does not reject either state.
- `ChatComposer.submit()` clears drafts after any resolved `onSend`, so an attachment upload failure can remove the draft without producing a visible attachment message.
- Current Chat Acceptance has no native file picker, attachment upload, attachment-only send, receiver rendering, Details count, or restart assertion.

## Verification Conclusion
Root cause confirmed before fix:
1. Station authority identity exists in the running Rust projection.
2. The Desktop TypeScript service mapper drops `authority_station_id`.
3. The shared Desktop conversation projection has no Station identity field.
4. Chat Header/Details therefore cannot render Station attribution.
5. Acceptance proves backend Station identity/readback only and overclaims visible coverage.

Post-fix comparison pending.

Post-fix Native evidence:

- Run `20260821T100236040888Z-80282f9702fbc8c0fa58404d109fbed7`
  recorded `avatar_exact_loaded=PASS`.
- Alice and Bob exposed the same single authority Station ID:
  `12D3KooWNvqw4A848Zqmz1c19vuxL9B9rrEPxEBmpUMAF1FXdFAW`.
- `station_attribution_exact=PASS` proved the Station surface was available and
  visible in both clients.
- The Gate advanced to the independent ConversationActionSurface failure:
  `timed out waiting for mute projection`.
- Actor ports and the Reaction fault-proxy port were released.

The identity and Station attribution product path is fixed in dirty
source-bound Native evidence. This debug session remains `[OPEN]` until clean
source verification and user confirmation.

Clean source-bound run
`20260821T101103621394Z-083d69ddf9bbc5bdd1b97026df475f9d`
matched source and Profile Three Station commit
`04fe5680128ac008c350a264e5e9ac20c7000e1f` and recorded both
`avatar_exact_loaded=PASS` and `station_attribution_exact=PASS`. The first
failure advanced to Mute projection; cleanup released actor and proxy ports.
