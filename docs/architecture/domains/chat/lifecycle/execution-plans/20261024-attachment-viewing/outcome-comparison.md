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
  "sourceIdentity": "attachment-source-files-sha256:86b87dd508c153d306644a912a97c0d4732ee8172bfa6775ec122bd6b5176266",
  "items": [
    {
      "id": "CAV-O01",
      "status": "PARTIAL",
      "actualEffect": "Native Desktop 14 类代表性文件的内容、导航、关闭重开与授权撤销通过；24 张文件截图和消息4px/8px布局及图片标签检查通过",
      "evidenceRefs": [
        "verification-status.md",
        "deliverables/chat-attachment-preview/repair-verification-20261025/result.json",
        "deliverables/chat-attachment-preview/repair-verification-20261025/source.json"
      ],
      "deviation": "用户将本轮范围收敛到进入程序与文件预览；使用离线本地投影夹具，下载中断恢复及完整双方 Journey 仍未证明"
    },
    {
      "id": "CAV-O02",
      "status": "PARTIAL",
      "actualEffect": "Native Desktop 真实图文 Word/PPT、带坐标和列宽的工作表、1536 万像素图片、720p 视频、分页 PDF/文本、大 Word、旧格式及损坏降级通过",
      "evidenceRefs": [
        "verification-status.md",
        "deliverables/chat-attachment-preview/repair-verification-20261025/result.json",
        "deliverables/chat-attachment-preview/repair-verification-20261025/source.json"
      ],
      "deviation": "Native 本地预览不证明双方传输、移动端运行、系统打开或保存；这些仍为 UNPROVEN，不纳入本轮完成判断"
    },
    {
      "id": "CAV-O03",
      "status": "PARTIAL",
      "actualEffect": "共享预览与 Native grant ownership 保持单一；当前原生14类文件的后台验证、关闭及logout后旧grant拒绝通过；1024次取消后的新操作、离线完成缓存恢复和首次完整性重试回归通过",
      "evidenceRefs": [
        "deliverables/chat-attachment-preview/repair-verification-20261025/result.json",
        "deliverables/chat-attachment-preview/repair-verification-20261025/source.json"
      ],
      "deviation": "真实预览关闭、会话验证与原生logout已检查；移动系统动作、完整跨Station切换和隐藏树性能没有证明"
    },
    {
      "id": "CAV-O04",
      "status": "PARTIAL",
      "actualEffect": "共享预览保留有界 Range 和可终止 worker；65 MiB Word 的图文内容、第二页及重开通过，完整性仍由 Native 校验",
      "evidenceRefs": [
        "deliverables/chat-attachment-preview/repair-verification-20261025/result.json",
        "deliverables/chat-attachment-preview/repair-verification-20261025/source.json"
      ],
      "deviation": "该大文档含未使用填充，不代表复杂大文档性能；系统副本及目的地面板仍未执行"
    },
    {
      "id": "CAV-O05",
      "status": "PARTIAL",
      "actualEffect": "当前 Native 内容像素、读取、授权与关闭重开检查通过，源码/二进制/截图摘要已收集；夹具改为代表性文件并补区域像素 oracle，任务资源已精确回收",
      "evidenceRefs": [
        "verification-status.md",
        "deliverables/chat-attachment-preview/repair-verification-20261025/result.json",
        "deliverables/chat-attachment-preview/repair-verification-20261025/source.json"
      ],
      "deviation": "这是用户收敛范围内的 FUNCTIONAL_CHECK，原计划完整 formal Acceptance 仍为 UNPROVEN，mandatory assertions 保持原要求"
    }
  ]
}
```

sourceIdentity 标识交付目录 `source.json` 中的当前任务源码/配置输入。
本轮 Native 客户端预览检查使用真实文件与离线本地消息投影，不提供消息传输、
OS 面板或移动端 Native 证明。原计划五项结果按完整目标仍为 PARTIAL；
用户本轮收敛的 macOS 文件预览范围为 FUNCTIONAL_CHECK/PASS_LOCAL_FIXTURE；
实际暗色主题、Mobile Native 和任意文档忠实度未证明。计划的预期段保持不变，见
[verification-status.md](./verification-status.md)。
