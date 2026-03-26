# Station/Desktop 接口对齐审计 Spec

## Why
`apps/desktop` 是新前端代码，当前是否完整承接 `apps/station/app` 对外能力尚不清晰。需要先建立一份可复用的“接口对齐基线”，用于后续补齐与排期。

## What Changes
- 梳理 `apps/station/app` 对外开放接口清单（按业务域分组）。
- 梳理 `apps/desktop` 现有调用入口与命令/服务封装清单（按业务域分组）。
- 产出“已对齐 / 未对齐 / 不在范围”三类映射结论。
- 明确本次审计范围排除项：`applets` 相关接口、`llmbox` 相关接口。
- 给出未对齐项的影响级别（高/中/低）与建议补齐优先级。

## Impact
- Affected specs: 前后端能力对齐基线、接口治理、迭代排期输入
- Affected code: [apps/station/app], [apps/desktop], [apps/desktop/src-tauri]

## ADDED Requirements
### Requirement: 非 Applets/LLMBox 接口对齐基线
系统 SHALL 提供一份覆盖 `apps/station/app` 与 `apps/desktop` 的接口对齐基线，并明确未对齐差异。

#### Scenario: 生成对齐视图
- **WHEN** 对 `station` 与 `desktop` 代码进行接口盘点
- **THEN** 输出按业务域组织的接口映射清单，并标记“已对齐 / 未对齐 / 不在范围”

#### Scenario: 范围控制
- **WHEN** 审计流程执行
- **THEN** 自动排除 `applets` 与 `llmbox` 相关接口，不将其计入未对齐缺口

#### Scenario: 输出可执行结论
- **WHEN** 识别到未对齐接口
- **THEN** 为每项记录代码证据位置与影响级别，形成后续补齐优先级建议

## MODIFIED Requirements
### Requirement: 前后端能力对齐认知
原“口头判断”方式改为“证据化审计”方式：必须基于代码位置与接口映射输出结论，不再依赖经验判断。

## REMOVED Requirements
### Requirement: 一次性全量实现补齐
**Reason**: 当前阶段目标是先建立上下文与差异基线，而非直接开发补齐。
**Migration**: 审计完成后，在下一变更中按优先级逐项实现缺口对齐。
