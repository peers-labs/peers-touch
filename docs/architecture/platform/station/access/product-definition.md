# Station 接入生命周期 - 产品定义

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-09-26 | **Updated**: 2026-10-06
> **Owner**: Identity and Access

---

## 1. 产品命题

新用户在 Desktop 或 Mobile 上选择一个 Station 后，必须先确认它是谁，再按该
Station 发布的准入流程完成登录。两端可以有不同布局，但不能拥有不同登录路径、
信任标准、scope 或错误结果。

## 2. 硬约束

- 接入层只接受 capability registry 登记的当前 route、contract、parser 和 storage key。
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
| SAL-C06 | 能力完整性治理 | capability 有唯一 owner、contract 与双端 consumer |
| SAL-C07 | 客户端类别会话 | 同一账号可同时保留一个 Desktop 和一个 Mobile Session；同一客户端类别的新登录必须接管并撤销旧 Session |

Desktop 与 Mobile 均为 `required`；Browser 不在本模块声明范围。

## 4. 用户可见结果

1. 选择或输入 Station 地址。
2. 客户端验证并展示 Station 名称与身份摘要。
3. 用户确认后进入 Access Gate。
4. Gate 完成后才建立 Session 并启动业务 runtime。
5. 登录后显示当前 Station 与 Federation context。
6. 账号或 Station 切换不会显示前一 scope 的头像、Chat、context 或本地统计。
7. 同一账号的 Desktop 与 Mobile 可同时使用；第二个 Desktop 或第二个 Mobile
   登录后，旧同类端收到 `kicked` 并回到登录态，异类端保持可用。

## 5. 非目标

- 不让普通用户创建、加入、离开或删除 Federation。
- 不展示或管理 Relay token、invite、mount、seed、forward endpoint。
- 不设计 Dashboard/CLI 运维流程。
- 不修改 Conversation authority、Chat 删除语义或本机存储。
- 不支持 registry 之外的 Station 或客户端 wire。
- 不允许用运行时、窗口或构建标签创建额外 Session 类别；类别只允许
  `desktop`、`mobile` 和已明确声明的 `web`。

## 6. 成功指标

| 结果 | 目标 |
|---|---|
| 双端接入语义差异 | 0 |
| 凭据提交前未验证 Station identity | 0 |
| 普通客户端可达的未登记接入接口 | 0 |
| 普通客户端 Federation/Relay 治理入口 | 0 |
| 未登记或无生产消费者的接入 wrapper | 0 |
| 当前接口 inventory 缺口 | 0 |
| required 原生 E2E 覆盖 | 100% |

## 7. 产品门

当前状态：`accepted`。

Owner 已确认：

- 当前接口唯一性与开发数据重置；
- Federation 普通客户端只消费 context；
- registry 之外的 Station 不在兼容承诺内。
