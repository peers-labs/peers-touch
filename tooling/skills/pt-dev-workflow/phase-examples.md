# Dev Workflow Phase Examples

Concrete examples showing the deliverables and commands for each phase.

---

## Example Task

> "Add a notification bell component to the Desktop app that shows unread count"

---

## Phase 1: Planning

### status.json

```json
{
  "session_id": "20260416-143000",
  "task": {
    "title": "Add notification bell to Desktop",
    "description": "Add a notification bell component to the Desktop app that shows unread count",
    "issue_number": 42
  },
  "current_phase": "planning",
  "phases": { "planning": { "status": "in_progress" } },
  "context": { "platforms": ["desktop"], "scopes": ["desktop"] }
}
```

### Deliverable: plan.md

```markdown
## Execution Plan / 执行计划

### Goal / 目标
EN: Add a notification bell component with unread count badge to the Desktop app header.
CN: 在桌面端应用顶栏添加带未读数徽标的通知铃铛组件。

### Scope / 范围
- Modify: `apps/desktop/src/components/NotificationBell.tsx` (new)
- Modify: `apps/desktop/src/components/GlobalLayout.tsx` (add bell to header)
- Modify: `apps/desktop/src/store/notification.ts` (add unread count)
- Platform: Desktop (TS)

### Approach / 方案
EN: Create a NotificationBell component using LobeUI Badge. Subscribe to
notification store for real-time unread count. Place in GlobalLayout header.
CN: 使用 LobeUI Badge 创建 NotificationBell 组件，订阅通知 store 的未读计数，
放置在 GlobalLayout 顶栏中。

### Risks / 风险
- WebSocket reconnection may cause stale count
```

---

## Phase 2: Coding

### Branch

```bash
git checkout -b feat/desktop-notification-bell main
```

### Commits

```
feat(desktop): add NotificationBell component with unread badge

Implement notification bell using LobeUI Badge component.
Subscribe to notification store for real-time unread count
updates via WebSocket connection.

Made-with: Trae/Claude-4-Sonnet
Closes #42
```

### Push

```bash
git push -u origin feat/desktop-notification-bell
```

### status.json update

```json
{
  "current_phase": "coding",
  "phases": {
    "planning": { "status": "completed" },
    "coding": {
      "status": "completed",
      "branch": "feat/desktop-notification-bell",
      "commits": ["a1b2c3d"]
    }
  }
}
```

---

## Phase 3: Review

### Verification

```bash
cd apps/desktop && pnpm run check && pnpm run test
```

### PR Creation

```bash
gh pr create \
  --title "feat(desktop): add notification bell with unread count" \
  --body "$(cat <<'EOF'
## Summary / 概述

EN: Add a notification bell component to the Desktop app header that displays
the current unread notification count as a badge.
CN: 在桌面端应用顶栏添加通知铃铛组件，以徽标形式显示当前未读通知数量。

## Changes / 变更内容

- EN: New `NotificationBell` component with LobeUI Badge / CN: 新增 `NotificationBell` 组件，使用 LobeUI Badge
- EN: Integrated into `GlobalLayout` header / CN: 集成到 `GlobalLayout` 顶栏
- EN: Added `unreadCount` selector to notification store / CN: 在通知 store 中添加 `unreadCount` selector

## Motivation / 动机

EN: Users need visual feedback for unread notifications without navigating to the notification center.
CN: 用户需要在不进入通知中心的情况下获得未读通知的视觉反馈。

## Type / 变更类型

- [x] `feat` — New feature / 新功能

## Scope / 影响范围

- [x] Desktop (TS + Rust)

## Test Plan / 测试计划

- [x] Unit tests added / 已添加单元测试
- [x] Manual testing: verified bell renders, count updates on new notification / 手动测试：验证铃铛渲染、新通知时计数更新

## Related Issues / 关联 Issue

Closes #42

## AI Traceability / AI 溯源

- Tool / 工具: Trae
- Model / 模型: Claude-4-Sonnet
EOF
)" \
  --label "enhancement,desktop" \
  --base main
```

---

## Phase 4: Release (if applicable)

```bash
# After PR merged to main
git checkout main && git pull

# Determine version: feat → minor bump
# Previous: v0.3.1 → New: v0.4.0
git tag -a v0.4.0 -m "Release v0.4.0"
git push origin v0.4.0

# GitHub release is auto-created by release.yml workflow
```

---

## Phase 5: Completion

### Deliverable: summary.md

```markdown
## Development Summary / 开发总结

### Task / 任务
EN: Added notification bell component with unread count badge to Desktop app.
CN: 在桌面端应用中添加了带未读数徽标的通知铃铛组件。

### Changes / 变更
- `NotificationBell.tsx` — new component (LobeUI Badge)
- `GlobalLayout.tsx` — added bell to header
- `notification.ts` — added unreadCount selector

### PR
- PR #43: feat(desktop): add notification bell with unread count
- Status: Merged

### Verification / 验证
- [x] Lint: passed (`pnpm run check`)
- [x] Tests: passed (`pnpm run test`)
- [x] Build: passed (`pnpm run build`)

### AI Traceability / AI 溯源
- Tool: Trae
- Model: Claude-4-Sonnet
```

### Final status.json

```json
{
  "session_id": "20260416-143000",
  "current_phase": "completion",
  "phases": {
    "planning":   { "status": "completed" },
    "coding":     { "status": "completed", "branch": "feat/desktop-notification-bell", "commits": ["a1b2c3d"] },
    "review":     { "status": "completed", "pr_number": 43, "checks_passed": true },
    "release":    { "status": "skipped" },
    "completion": { "status": "completed" }
  }
}
```
