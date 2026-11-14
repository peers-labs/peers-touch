# Device Login Approval — 集成与映射

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-11-12 | **Updated**: 2026-11-12
> **Owner**: Identity and Access

## 1. 与现有模块的映射

| 现有模块 | 关系 | 映射方式 |
|---|---|---|
| Mobile Scan Login（device_link） | 部分替代 + 部分保留 | 发起方向与审批 UX 由本模块接管；QR/扫码保留为私有 Station 网络引导的备用入口；HPKE/CAS/ack 语义直接复用 |
| Station Access Gate | 扩展 | 新增 `DEVICE_APPROVAL_REQUIRED` 决策要求；审批前后两次求值，GRANTED 终裁权不变 |
| Session DBStore | 复用无改造 | per-device 唯一索引已满足多设备并存；本模块只经既有 Session 准备/激活端口工作 |
| Actor Identity | 复用 | claimant enrollment、profile revision、设备撤销仍由其裁决；seed 交付后的设备证书走既有校验 |
| device-link-core | 复用 | 唯一密码学实现；新增 login-approval purpose 域分隔，不复制代码 |
| Messaging Recovery | 定位调整 | 24 词短语服务与 Settings 管理保留；chat 硬门禁删除，短语输入迁登录兜底面 |
| Mobile push bridge / Desktop user-notifications | 复用 | v1 前台弹窗 + 本地通知；Station 推送扇出后置（DLA-D08） |
| identityLifecycle（Desktop）/ launch kernel（Mobile） | 接入 | claimant 等待态是登录面的新 stage，全部身份状态变更仍经既有状态机闭合 |

## 2. 影响面分析

### Station

- 新增 `app/subserver/login_approval/` 与三张表、一组迁移；组合根注册一次。
- Access Gate 求值链新增一种设备授权要求及对应 proto 枚举；需要同步
  `access_gate.proto` 与访问决策的契约测试。
- 无会话面的限流接入现有 Access 限流桶；审计事件进 `login_approval_audit`。
- 不改动 Session 索引与 Actor Device 表结构。

### Desktop

- 新增 native application、Tauri 命令、TS runtime/store 与两个表面
  （Shell 审批弹窗、登录卡等待面）。
- LoginPage 登录状态机新增 waiting stage，接入 `identityLifecycle`，
  遵守“身份投影只经状态机闭合” invariant。
- 删除 `MessagingRecoveryGate` 及其 chat 路由挂载；恢复短语的文案与 i18n 键
  迁移到登录兜底面与 Settings，不保留死键。
- 设置页 DeviceLinkPanel 保留为二维码备用入口与已授权设备管理，不再承担日常审批。

### Mobile

- 新增 native runtime 与两个表面（claimant 等待卡、approver 弹窗）。
- `AccessGateHost` 增加 waiting 渲染分支；`DeviceLinkScreen` 扫码入口降级为
  station-selection 页面的次要操作。
- approver 密封/签名能力是移动端新增（此前 mobile 只实现 claimant 侧）。

### Model / packages

- 新增 `login_approval.proto`；`access_gate.proto` 增加决策要求枚举。
- `device-link-core` 只允许增加 purpose 常量与 transcript 构造辅助，不得引入
  Station 事务依赖。
- locales 新增登录等待、审批弹窗、兜底入口三类键；禁止硬编码文案。

## 3. 迁移策略

1. **协议先行**：新 proto 与 Station subserver 以 additive 方式落地，旧 Device Link
   流量不受影响；两套事务并存期各自独立审计。模块治理 registry 只接受 active 且
   governedPaths 已存在的模块，因此 `device-login-approval` 的 registry 登记与
   文档 Status 转 active 在实现落地的同一变更中完成；draft 阶段不进 registry。
2. **Access 策略灰度**：`DEVICE_APPROVAL_REQUIRED` 先以 Station 策略开关发布，
   默认关闭时行为与现状一致；开启后新登记设备走审批，存量会话不回溯。
3. **客户端切换**：登录卡等待态与 Shell 弹窗上线后，将扫码入口降级为次要入口；
   `mobile-scan-login` 文档状态在该阶段调整为“网络引导备用路径”，其 MSL 决策
   除发起方向相关段落外继续有效。
4. **chat 门禁移除**：在“审批登录后引擎 active”原生 Journey 证明通过后删除
   `MessagingRecoveryGate`；未证明前不得先删门禁（fail-closed）。
5. **兜底能力解耦**：邮箱挑战（DLA-D07）作为独立能力排期；未落地前折叠入口只暴露
   密码 + 短语恢复，文案不得宣称邮箱直登。
6. **文档回写**：`mobile-scan-login/design.md` §1 关于活跃索引为
   `(user_id, device_type)` 的过时表述必须在同一变更中更正为当前
   `(station_peer_id, user_id, device_id)` 事实。

## 4. 失效与禁止关系

- 换 Actor/Station、登出、sessionEpoch 变化：撤销本 scope 的 claimant 持票缓存、
  approver 监听与临时密钥；迟到结果不得重新激活等待态。
- approver 在批准前被撤销：事务归 DENIED/APPROVER_REVOKED，claimant 卡片显示
  明确原因并允许重新发起或走兜底。
- Station 重启：事务从 PostgreSQL 恢复，内存不持状态；TTL 回收幂等。
- 禁止：无会话端点枚举账号设备、审批绕过 Access 重裁、平行 Session/Actor Device 表、
  chat 路由挂载审批或恢复卡片、第二套 HPKE 实现、组件 mount 内轮询。

## 5. 既有 invariant 遵守说明

- Device Link COMMITTED≠GRANTED：本模块 COMMITTED 后 claimant 仍走普通 Access
  重验证与 PIN/Shell pipeline，审批事务不替代生命周期。
- Session 与 Messaging 共享 device_id：claimant 全程使用安装实例唯一 device_id，
  Session 绑定与 Actor Device enrollment 同源。
- Desktop identity 状态机闭合：waiting stage 的进入/退出与用户投影全部经
  `identityLifecycle`/`identityRuntime`，页面不自 patch。
