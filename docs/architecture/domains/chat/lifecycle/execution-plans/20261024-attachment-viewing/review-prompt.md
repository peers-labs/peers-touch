# 文件查看计划评审

> **Status**: active
> **Created**: 2026-10-24 | **Updated**: 2026-10-24
> **Owner**: Chat Product Team

评审 [plan.md](./plan.md)、[outcome-comparison.md](./outcome-comparison.md) 与
[文件查看设计](../../attachment-viewing.md)。从具体源码与用户结果判断：

1. CAV-01 的 local protobuf、字节验证、scope handle 和原生副本是否构成完整边界；
   是否向 Station 或 Web 透露密钥、原生路径或可写 cache。
2. CAV-02 是否在点击帧立即进入详情，Runtime 是否拥有 dedupe、pending、事件、
   reconcile 和 scope teardown，是否完整删除 window.open 的文件路径。
3. Preview/Open externally/Save copy 是否不同；Office、archive、unsupported
   是否仍可操作；媒体与文件的下载状态是否共享同一 checkpoint。
4. CAV-03 的 Gate 是否真正覆盖新增行为、sender/receiver、平台差异和恢复，
   是否把旧 Desktop 或单 Station 证据误用为 Mobile/mixed-client PASS。
5. 文件名、扩展名、hash、取消重试、迟到回调、缓存清理和原生 staging 是否有
   owner 层验证；所有资源是否有预算与清理责任。
6. Outcome 五维基线是否是源码事实，所有任务/Gate 是否映射，实际结果是否保持
   UNPROVEN 直到当前源码证据成立。

## Findings-first design review

结论：计划可实施。用户两次确认覆盖现有方案的非破坏性本地实施，不授权外部交付。

- Native file capabilities 必须扩展既有 Mobile plugin；Tauri Mobile URL opener
  不支持文件，不能作为文件打开能力。
- 已存在的 rich-media Gate 不能直接证明新增导出和 scope fencing。CAV-03 必须
  增加相应业务断言并逐平台记录；缺失 cell 继续 UNPROVEN。
- Native Core 保持 Host-neutral：安全文件名和 verified stream copy 可以共享，
  路径、FileProvider、Quick Look、destination picker 留在 Host adapter。
- 判定 cache Ready 必须校验字节，不能继承 Complete checkpoint；保存的用户副本
  必须位于 cache retention owner 之外。

机械校验：`planctl validate` 已通过，当前计划摘要
`62b40625bdb7de02dc422380ef835263cbedf63ce2c2abe87c3efe85cfd9db39`。
架构模块治理校验已通过。上述结论是设计评审，不是产品验收。
