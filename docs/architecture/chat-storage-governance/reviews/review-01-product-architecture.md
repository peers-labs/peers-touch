# Review 01：Chat 存储产品与架构

> **Status**: passed-after-correction
> **Reviewed**: 2026-09-26
> **Scope**: Product + Architecture
> **Reviewer Mode**: independent findings-first

## Findings 与修正

| 严重度 | Finding | 修正 |
|---|---|---|
| blocker | 原文档以“客户端平台”名义混入 Access/Federation | 拆为独立 `chat-storage-governance` 模块 |
| blocker | 曾承诺按会话从 Station 恢复旧明文，但 authority 不保存该明文 | 删除普通重下载承诺；仅保留独立完整加密 Recovery |
| blocker | 时间戳不足以表达可靠 pruning 边界 | 改为 authority sequence/hash，时间只选候选 |
| blocker | cleanup journal 无 immutable item | 增加逐项 item、digest/size、状态与恢复点 |
| blocker | Hide/Retract 未闭合 transaction、ACK、文件失败和 Recovery | 明确 commit 后 ACK、异步文件回收与 archive redaction |
| blocker | Rust Core 无法统计 Web localStorage | 将非 Chat Web cache 排除 |
| high | `compaction_pending` 可被误算成功 | 只允许真实物理字节下降进入 succeeded |

## 复审

- 模块只回答“当前设备 Chat 空间如何统计、治理与证明”。
- Station authority、其他设备和其他参与者不受本机清理影响。
- accounting、floor、journal、redaction 与 Recovery 责任闭合。
- 产品保持少量预设和直观入口，没有扩展成策略平台。

## 结论

`passed`
