# Station 接入生命周期 - 产品定义

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-09-26 | **Updated**: 2026-09-26
> **Owner**: Identity and Access

---

## 1. 产品命题

新用户在 Desktop 或 Mobile 上选择一个 Station 后，必须先确认它是谁，再按该
Station 发布的准入流程完成登录。两端可以有不同布局，但不能拥有不同登录路径、
信任标准、scope 或错误结果。

## 2. 硬约束

- 没有正式用户或历史数据，不保留兼容 route、alias、fallback、dual parser、旧 key
  或 migration reader。
- URL 和 reachability 只用于连接，签名 `station_peer_id` 才是身份。
- Access Gate 是普通客户端唯一准入 owner。
- Relay 不成为客户端业务 API；Federation membership 由 Station 运维面治理。
- 普通客户端只查看或选择 Station 已提供的 Federation context。
- 双端统一衡量语义、状态、错误与持久结果，不要求组件或宿主命令同构。

## 3. 能力

| ID | 能力 | 产品结果 |
|---|---|---|
| SAL-C01 | 可信 Station 选择 | 凭据提交前验证签名 identity，并显式确认首次固定或身份替换 |
| SAL-C02 | 统一 Access Gate | 四个 canonical protobuf endpoint 驱动全部登录方式 |
| SAL-C03 | Scope 隔离 | Session、Messaging、Federation 与本地投影共享 Station/Actor/Device scope |
| SAL-C04 | Federation context | 用户可查看或选择 context，并用于 search/resolve/Chat |
| SAL-C05 | 基础设施收口 | 普通客户端无 Federation 治理和 Relay token/mount/invite 入口 |
| SAL-C06 | 能力与遗产治理 | capability 有唯一 owner/consumer，旧接口和测试九维归零 |

Desktop 与 Mobile 均为 `required`；Browser 不在本模块声明范围。

## 4. 用户可见结果

1. 选择或输入 Station 地址。
2. 客户端验证并展示 Station 名称与身份摘要。
3. 用户确认后进入 Access Gate。
4. Gate 完成后才建立 Session 并启动业务 runtime。
5. 登录后显示当前 Station 与 Federation context。
6. 账号或 Station 切换不会显示旧 scope 的头像、Chat、context 或本地统计。

## 5. 非目标

- 不让普通用户创建、加入、离开或删除 Federation。
- 不展示或管理 Relay token、invite、mount、seed、forward endpoint。
- 不设计 Dashboard/CLI 运维流程。
- 不修改 Conversation authority、Chat 删除语义或本机存储。
- 不兼容旧 Station 或旧客户端 wire。

## 6. 成功指标

| 结果 | 目标 |
|---|---|
| 双端接入语义差异 | 0 |
| 凭据提交前未验证 Station identity | 0 |
| 普通客户端可达的旧登录或 fallback | 0 |
| 普通客户端 Federation/Relay 治理入口 | 0 |
| 未登记或无生产消费者的接入 wrapper | 0 |
| 接入遗产九维扫描残留 | 0 |
| required 原生 E2E 覆盖 | 100% |

## 7. 产品门

当前状态：`PRODUCT_READY_FOR_OWNER_REVIEW`。

Owner 进入执行前确认：

- 零兼容与开发数据重置；
- Federation 普通客户端只消费 context；
- 旧 Station 不在兼容承诺内。
