# Agent 架构

## 当前源文档

| 文档 | 定位 |
|---|---|
| [agent-kernel/README.md](./agent-kernel/README.md) | **当前目标架构** — Agent Kernel 的模块设计、数据模型、Provider 策略、Desktop UI/UX 集成、建设阶段 |

## 参考资料

以下文档只作为设计素材和历史分析参考，不约束当前 Agent Kernel 的模块边界、API、数据模型或交付顺序。

| 文档 | 可复用价值 |
|---|---|
| [agent-self-growth-architecture.md](./agent-self-growth-architecture.md) | Memory freeze、Skill guard、Growth 归因、Dogfood、自成长闭环 |
| [hermes-agent-self-improving-analysis.md](./hermes-agent-self-improving-analysis.md) | 外部 self-improving Agent 的分层思想 |
| [a2a/README.md](./a2a/README.md) | A2A 协议结构、Agent Card、Task 状态机 |

## 当前结论

- Agent Kernel 是 Peers-Touch 当前目标架构，不是对旧 Agent 子服务的兼容层。
- 历史代码、历史 API、历史数据都不是约束；阻碍目标架构时可以删除或替换。
- thirdparty 是参考源，不是实现源；不要修改 thirdparty，也不要复制它的 UI/UX。
- Provider 分两层建模：`AgentProvider` 负责 Turn 编排，`ModelBackend` 负责模型来源；Eino-native 底层同样使用 vendor/model backend，CLI-wrapped 只按能力矩阵选择性可控。
