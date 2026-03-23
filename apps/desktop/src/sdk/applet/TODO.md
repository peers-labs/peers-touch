# Applet SDK 迁移说明

## 当前位置

SDK 当前位于 `web/src/sdk/applet/`，作为主应用子模块。

## 后续计划

- 迁移到 `packages/applet-sdk/` 或发布为 `@agent-box/applet-sdk` 独立包
- 便于独立版本管理、单元测试与复用
- 主应用通过 `import { createAppletSDK } from '@agent-box/applet-sdk'` 使用

## 相关文档

- `external/gdpa-agent-box/docs/agent-applet-design.md` 第 0 节「小程序四层架构」
