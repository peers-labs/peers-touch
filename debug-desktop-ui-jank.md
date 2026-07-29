# Debug Session: desktop-ui-jank

**Status**: [OPEN]
**Created**: 2026-07-23
**Symptoms**: 点击按钮、输入、动画、切换tab都非常卡，要等半天才反应。Native Tauri Desktop 全局卡顿。

## Reproduction Steps
1. `make desktop` 启动 native desktop
2. 登录后进入主界面
3. 点击任意按钮、输入框输入文字、切换tab → 明显卡顿（数百ms到数s延迟）

## Hypotheses

| ID | Hypothesis | Falsification Point |
|----|-----------|-------------------|
| H1 | Rust Tauri IPC blocking main thread | Measure invoke() duration; check if spawn_blocking used |
| H2 | Store subscribe infinite loop / leak | Count setState frequency per frame |
| H3 | SSE/Event message storm | Measure event dispatch frequency |
| H4 | DevTools/HMR overhead | Compare dev vs production build |
| H5 | CSS recalc/layout thrash | Profile long tasks in DevTools |

## Evidence Log

(To be filled during instrumentation)

## Root Cause

(TBD)

## Fix

(TBD)
