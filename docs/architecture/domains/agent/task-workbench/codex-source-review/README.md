# Codex 源码研究与工作台落地提案

状态：accepted 设计输入（Owner 2026-11-02 确认；外部 runtime 适配本身仍无运行证明，证据门见 integration-contract.md）。研究日期：2026-11-01。

推荐：**以完整任务工作台落地UI/UX、任务、浏览器、插件、文件/Diff、Profile、Memory和验收；复用Codex执行及交互机制，保留Peers现有Owner。** 在已有设备worker中接持久协议，工作台真实消费活动/成果/介入；Browser与插件沿现有MCP/Capability/Connector贯通，避免并列业务真源。

官方源码研究副本保存在研究机本地工作区（不随仓库分发），来源为 `https://github.com/openai/codex`。研究固定提交 `67f0994b532b8740f14b5b738af7b7b2a915b1d6`；完整文件工作树、浅历史。该提交不代表 Dashboard 当前安装的 CLI 版本。

按下列顺序阅读：

1. [完整能力复审](./capability-review.md)：UI/UX、任务、连续对话与宿主thread恢复、搜索、Browser/Computer Use、插件生命周期、文件/Diff与配置消费，每项有源码、Owner和实际验收链。
2. [源码设计与实现](./source-analysis.md)：状态、控制、恢复、Memory、资料、成果、Skills 和复用边界。
3. [设计复审](./design-review.md)：从源码反例推导出的硬约束，以及仍需实证的条件。
4. [具体接入合同](./integration-contract.md)：命令、事件、身份、宿主连接、上下文和故障处理。
5. [验证计划](./validation-plan.md)：真实任务、权限、恢复、Memory、迁移与源版本证明。
6. [架构设计](../design.md)：上述约束已原位纳入架构、数据、复用删除与模块归属；实施顺序与切片见执行计划 TW-20261102。

这次实际完成的是下载、源码与测试规格阅读、既有宽窄原型截图观察、交叉核对、方案改写、引用及摘要校验。没有构建或运行Codex模型，没有执行其测试，没有实施生产代码。TUI源码能支持交互机制分析，不能证明商业GUI视觉实现；截图不替代真实流式/浏览器/插件验证。实现、协议、测试同属一个仓库，不冒称三个独立来源。

[source-evidence.json](./source-evidence.json) 固定文件摘要及行锚；本地校验工具（保留于研究工作区） 可重新检查本包和方案引用、源版本及既有源码摘要。源码研究范围不包含闭源 Codex 客户端、云服务或未下载的商业插件。
