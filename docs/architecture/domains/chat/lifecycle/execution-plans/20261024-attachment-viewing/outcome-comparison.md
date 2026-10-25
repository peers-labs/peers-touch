# 文件查看：预期与实际效果

## Outcome Comparison Contract

```json
{
  "kind": "peers-touch-outcome-comparison-contract",
  "schemaVersion": 1,
  "planId": "CAV-20261024",
  "plannedSectionDigest": "sha256:3bcb6c2bb2c82944a1a71a1ff8a67f4bfcdd6129b3b2d1f96eff5ea6ebc2fa6a",
  "criteria": [
    {"id": "CAV-O01", "dimension": "user-experience", "title": "文件点击可见可恢复", "taskIds": ["CAV-02", "CAV-03"], "gateIds": ["chat-lifecycle-rich-voice-e2e"]},
    {"id": "CAV-O02", "dimension": "product-capability", "title": "双方预览打开保存", "taskIds": ["CAV-01", "CAV-02", "CAV-03"], "gateIds": ["chat-lifecycle-rich-voice-e2e"]},
    {"id": "CAV-O03", "dimension": "architecture", "title": "现有 Runtime 与 Native ownership", "taskIds": ["CAV-01", "CAV-02"], "gateIds": []},
    {"id": "CAV-O04", "dimension": "technology", "title": "共享契约与 verified copy", "taskIds": ["CAV-01"], "gateIds": []},
    {"id": "CAV-O05", "dimension": "quality-operations", "title": "真实结果与清理边界", "taskIds": ["CAV-03"], "gateIds": ["chat-lifecycle-rich-voice-e2e"]}
  ]
}
```

## Planned Outcome Comparison

### CAV-O01: 文件点击可见可恢复

- Before: 源码中通用文件走 window.open；Mobile Pending 不继续读取完成状态。
- Target: 立即详情、真实状态、progress/cancel/retry、无迟到外部打开。
- Expected effect: 用户知道正在发生什么，失败后能继续同一文件操作。
- Non-claim: 源码事实不替代现场复现和真实客户端证明。

### CAV-O02: 双方预览打开保存

- Before: 下载字节能力存在，完整文件消费流程缺失。
- Target: 支持媒体/PDF/text 预览、Office Native preview 和原生打开/保存副本。
- Expected effect: sender 和 receiver 完成相同文件使用任务。
- Risk: OS 文档格式和可用外部应用不同；unsupported 必须可操作。

### CAV-O03: 现有 Runtime 与 Native ownership

- Before: 附件 access 状态在消息组件中，页面离开中断观察。
- Target: 共享 headless 状态受 Messaging Runtime 生命周期约束；Native owns paths。
- Expected effect: 组件重挂载与 scope 切换不产生重复请求或泄漏。
- Unchanged: Station ciphertext truth、Chat 授权和加密不变。

### CAV-O04: 共享契约与 verified copy

- Before: cache 使用不带扩展名的 attachment identity；浏览器 URL 被当作系统文件。
- Target: protobuf local access contract，安全文件名、hash-verified 隔离副本。
- Expected effect: 系统识别正确文件类型，外部修改不破坏加密附件 cache。
- Risk: 复制大文件有 I/O 成本，需要后台执行和预算。

### CAV-O05: 真实结果与清理边界

- Before: 既有历史 Gate 不证明新增查看、导出、关闭和 scope fencing 行为。
- Target: 当前源码双方 Native Journey 与 regression，逐平台明确证据。
- Expected effect: 产品结果可复核，保存副本不受 cache eviction 影响。
- Non-claim: 未运行 OS/cross-Station cell 不继承 PASS，不自动发布或部署。

## Actual Outcome Results

```json outcome-comparison-results
{
  "kind": "peers-touch-outcome-comparison-results",
  "schemaVersion": 1,
  "planId": "CAV-20261024",
  "sourceIdentity": "attachment-source-files-sha256:34bfd1dd0b9e1be53ff709736b1da82713fb292a6420738674abadb17177dbce",
  "items": [
    {"id": "CAV-O01", "status": "UNPROVEN", "actualEffect": "双端详情和 Runtime 恢复已实现；关闭详情与离开 Chat 的真实 grant 撤销路径已注入", "evidenceRefs": ["verification-status.md", "/tmp/pt-attachment-checks/native-file-progress.json"], "deviation": "Native Development 准入停在 station-four commit mismatch；产品步骤未执行，clean source 与隔离 GUI 也未满足"},
    {"id": "CAV-O02", "status": "UNPROVEN", "actualEffect": "Native 文件消费适配已落地；Android arm64 Debug APK 编译通过并包含文件适配器，双方 macOS 系统操作 oracle 已接入", "evidenceRefs": ["verification-status.md", "/tmp/pt-attachment-checks/native-file-progress.json", "/tmp/pt-attachment-checks/android-current-ranlib/result.json"], "deviation": "APK 编译及共享 renderer 不能证明双方系统文件任务；Android 无连接设备，Native OS 路径未执行"},
    {"id": "CAV-O03", "status": "PARTIAL", "actualEffect": "共享 controller 和 Native epoch/取消 ownership 已检查；挂起、迟到 grant 与 Quick Look 具有撤销路径", "evidenceRefs": ["/tmp/pt-attachment-checks/final-source-checks.json", "/tmp/pt-attachment-checks/shared-behavior-final.log"], "deviation": "源码与有界复审不能替代 Native 生命周期和隐藏树性能证明"},
    {"id": "CAV-O04", "status": "PARTIAL", "actualEffect": "六项文件系统与 36 项传输检查通过；验证、私有副本、取消屏障和恢复保持明确 ownership", "evidenceRefs": ["/tmp/pt-attachment-checks/final-source-checks.json", "/tmp/pt-attachment-checks/native-filesystem-current.log"], "deviation": "文件系统与 Core 结果不能替代系统预览、外部应用和目的地面板证明"},
    {"id": "CAV-O05", "status": "UNPROVEN", "actualEffect": "三项系统文件 oracle 与关闭详情、离开 Chat 的局部 scope 路径已注入；当前类型、契约和结构检查通过，Development provisioner 清理通过", "evidenceRefs": ["verification-status.md", "/tmp/pt-attachment-checks/native-file-progress.json"], "deviation": "conversation/account/Station 切换尚未注入；Native 产品运行被 source mismatch 阻塞，mandatory scope aggregate 没有被局部边界代替"}
  ]
}
```

sourceIdentity 是 `native-file-progress.json` 列出的 84 个本任务源码/配置文件摘要，
不包含文档、无关目录和生成的 build output；它只标识局部检查的源码范围。
先前检查保留各自的 `final-source-checks.json` 和单项日志范围，不提升为本轮整体 PASS。
这不是完整 workspace/runtime attestation，也不提供正式 Acceptance PASS。
状态依据与运行资源 disposition 见 [verification-status.md](./verification-status.md)。
