# Station 接入生命周期 - 体验契约

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-26 | **Updated**: 2026-09-27
> **Owner**: Identity and Access

---

## 1. Journey 索引

| ID | Journey | 能力 |
|---|---|---|
| SAL-J01 | 首次选择 Station 并进入应用 | SAL-C01-C03 |
| SAL-J02 | 冷启动、renderer reload 与恢复 | SAL-C02-C03 |
| SAL-J03 | 切换账号或 Station | SAL-C01-C04 |
| SAL-J04 | 选择 Federation context 并找人 | SAL-C04 |
| SAL-J05 | 接入失败与恢复 | SAL-C01-C06 |

## 2. SAL-J01：首次接入

1. 用户输入或选择 Station URL。
2. 客户端探测可达性，但不建立信任。
3. 客户端获取并验证签名 Station identity。
4. 用户确认首次固定的 `station_peer_id`。
5. 客户端调用 `access/start`，按返回的 gate chain 渲染。
6. 用户完成一个 Station 明确提供的 gate。
7. 仅当 Access Decision 为 `granted` 时建立 Session 并启动 runtime。
8. Session、Messaging 和本地投影绑定同一 Station/Actor/Device scope。

## 3. SAL-J02：恢复

- 冷启动和 renderer reload 走同一 identity/access 状态机。
- 已授予且未过期的 Session 恢复后重新校验 scope，再开放业务页面。
- Access Attempt 过期、未知 gate 或错误响应进入 typed failure。
- 任一失败均不得调用 capability registry 之外的入口。

## 4. SAL-J03：切换

1. 停止前一 scope 的长生命周期 runtime。
2. 清空前一 scope 的前端 projection。
3. 验证目标 Station identity。
4. 完成目标 Access Gate。
5. 新 scope 完整 ready 后才开放业务页面。

已固定 URL 返回不同 `station_peer_id` 时，必须要求显式替换；不得自动接受。

## 5. SAL-J04：Federation context

- 登录后读取 Station 提供的可用 context。
- 只有一个时明确选中；多个时要求用户选择。
- search、resolve、Direct/Group 创建始终携带明确 `federation_id`。
- 用户可查看网络名称与连接状态。
- 用户不能在普通客户端管理 Federation membership 或 Relay topology。

## 6. SAL-J05：失败与恢复

| 失败 | 用户结果 |
|---|---|
| URL 不可达 | 保留输入，允许重试或修改 |
| 签名/challenge/PeerID 不匹配 | 凭据提交前 fail closed |
| Gate 不支持 | 显示 unsupported，不改用未登记入口 |
| Attempt 过期 | 重新开始 canonical Access Attempt |
| Federation context 缺失 | 阻止 scoped action，不猜默认 ID |
| Scope 切换中断 | 前一 projection 不得重新进入新 scope |
| Relay 不可用 | 显示连接诊断，不暴露 Relay 管理 |

## 7. 禁止体验

- probe 成功即视为可信 Station。
- Desktop 和 Mobile 对同一 gate 产生不同终态。
- 接入失败后自动调用未登记接口。
- 切换账号后短暂显示前一用户或前一 Federation context。
- 普通客户端出现 Federation Join/Leave 或 Relay token/mount。
