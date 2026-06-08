## Summary / 概述

<!-- EN: Brief description of what this PR does and why -->
<!-- CN: 简要描述本 PR 做了什么、为什么做 -->

## Changes / 变更内容

<!-- EN: List the key changes made in this PR -->
<!-- CN: 列出本 PR 的主要变更 -->

-

## Motivation / 动机

<!-- EN: Why is this change needed? What problem does it solve? -->
<!-- CN: 为什么需要这个变更？解决了什么问题？ -->

## Type / 变更类型

<!-- Check the one that applies / 勾选适用项 -->

- [ ] `feat` — New feature / 新功能
- [ ] `fix` — Bug fix / 缺陷修复
- [ ] `refactor` — Code refactoring / 代码重构
- [ ] `docs` — Documentation / 文档
- [ ] `test` — Tests / 测试
- [ ] `chore` — Maintenance / tooling / 维护与工具
- [ ] `ci` — CI/CD
- [ ] `perf` — Performance / 性能优化
- [ ] `build` — Build system / 构建系统

## Scope / 影响范围

<!-- Which part of the project is affected? / 影响了项目的哪个部分？ -->

- [ ] Station (Go)
- [ ] Desktop (TS + Rust)
- [ ] Mobile (Android / iOS)
- [ ] Proto / Model
- [ ] Applets / SDK
- [ ] Tooling / CI
- [ ] Other / 其它: <!-- specify -->

## Architecture Impact / 架构影响

<!-- EN: Does this change ownership, source of truth, runtime boundaries, protocol contracts, or lifecycle behavior? -->
<!-- CN: 是否改变 owner、真源、运行时边界、协议契约或生命周期行为？ -->

- [ ] No architecture impact / 无架构影响
- [ ] Architecture impact documented below / 有架构影响，说明如下

<!-- Details: -->

## Review Profile / Review 路由

<!-- Run: make review-route REVIEW_RANGE=<base>...<head> -->
<!-- Paste the emitted profiles and required commands. -->

```text
<!-- review profiles here -->
```

## Required Knowledge / 必读知识

<!-- Run: tooling/scripts/review/knowledge-match.sh --range <base>...<head> -->
<!-- Paste matched docs/knowledge entries, or "none". -->

```text
<!-- matched operational knowledge here -->
```

## Test Plan / 测试计划

<!-- EN: How was this tested? -->
<!-- CN: 如何测试的？ -->

- [ ] Unit tests added/updated / 已添加或更新单元测试
- [ ] Integration tests added/updated / 已添加或更新集成测试
- [ ] Manual testing (describe below) / 手动测试（见下方说明）
- [ ] No tests needed (explain why) / 无需测试（说明原因）

<!-- If manual testing, describe steps / 手动测试步骤说明: -->

## Related Issues / 关联 Issue

<!-- Link related issues: Closes #123, Fixes #456 -->
<!-- 关联 Issue: Closes #123, Fixes #456 -->

## Checklist / 检查清单

- [ ] Code follows project conventions (`AGENTS.md`) / 代码符合项目规范
- [ ] No `console.log` / `println!` / `fmt.Println` / debug statements / 无调试语句
- [ ] No hardcoded secrets or credentials / 无硬编码密钥
- [ ] Proto changes use `model/domain/*.proto` as source of truth / Proto 变更以 proto 文件为准
- [ ] Generated files are NOT manually edited / 未手动编辑生成文件
- [ ] Error handling includes context and typed error codes / 错误处理包含上下文和类型化错误码
- [ ] `make review` or equivalent review framework checks passed / 已通过 Review Framework 检查
- [ ] If a bug/invariant/playbook was discovered, `docs/knowledge/` was updated or explicitly waived / 如发现缺陷经验、不变量或流程，已更新知识库或说明无需更新
- [ ] If review rules changed, `tooling/scripts/review/skill-check.sh` passed / 如 Review 规则变化，已通过 Review Skill 保鲜检查

## AI Traceability / AI 溯源

<!-- If AI-assisted, list tools/models used -->
<!-- 如果使用了 AI 辅助开发，请列出工具和模型 -->

- Tool / 工具: <!-- e.g., Trae, Cursor, Claude Code -->
- Model / 模型: <!-- e.g., Claude-4-Sonnet, GPT-4.1 -->
