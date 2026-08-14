# P2-M9 Thread — Acceptance (S4)

## Deterministic (D)

| ID | Check | Result |
|----|-------|--------|
| D1 | `pnpm run check` passes | ✅ |
| D2 | `onThread` present in all MessageActionContext sites | ✅ |
| D3 | ThreadView imported and routed in PortalPanel | ✅ |
| D4 | Locale keys in en + zh-CN | ✅ |

## Functional (F)

| ID | Check | Expected |
|----|-------|----------|
| F1 | Click "Open Thread" on assistant message | Portal opens with thread view showing messages from that point |
| F2 | Thread header shows truncated source message | Source content preview visible |
| F3 | Close Portal → reopen Thread | Thread view persists with correct source |
| F4 | Thread doesn't appear during streaming | Action bar hidden when loading=true |

## Integration (I)

| ID | Check | Expected |
|----|-------|----------|
| I1 | Portal store `openThread` sets correct view type | activeView.type === 'thread' |
| I2 | ThreadView filters messages from source message onward | Correct subset displayed |
