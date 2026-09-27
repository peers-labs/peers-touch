# Review 03：批量会话清理产品、架构与计划

> **Status**: passed-after-correction
> **Reviewed**: 2026-09-27
> **Scope**: Product + Architecture + Plan
> **Reviewer Mode**: independent findings-first

## Findings 与修正

| 严重度 | Finding | 修正 |
|---|---|---|
| high | 新建跨会话原子事务会扩大锁范围并复制单会话治理 owner | 改为串行编排 canonical `chat_storage_clear_conversation` |
| high | scope 变化后继续队列可能清理新账号或设备的数据 | 冻结 scope revision；变化后停止未开始项并丢弃旧结果 |
| high | 部分失败若只显示总成功会掩盖数据未清理 | 明确成功/失败集合、实际释放量及失败项重试 |
| medium | “全选”可能隐式包含过滤外会话 | 限定为全选当前搜索结果 |
| medium | 直接增加“删除全部”会扩大不可逆操作范围 | 保持显式选择，不提供无范围全局删除 |
| medium | 只用静态测试不能证明危险动作 | 要求 Desktop 与 Mobile 原生 Journey、重启读回及发布构建 |

## 复审

- 产品 Journey 覆盖选择、确认、进度、成功、部分失败、重试和 scope 变化。
- 架构保持 Shared Rust Core 与单会话 journal/floor 为唯一删除真源。
- 双端只共享批量编排语义，保留平台适配，不新增 Proto 或持久化表。
- 三个 Task 分别闭合 Desktop、Mobile 与最终 Acceptance，没有技术层拆分。
- Browser、跨设备删除、Station 历史删除和全局删除均明确不声明。

## 结论

`passed`
