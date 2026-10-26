# Mobile Scan Login — Integration

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-27 | **Updated**: 2026-10-27
> **Owner**: Identity and Access

## 1. 保留的真源

- Node Connectivity / station-trust：endpoint、Station root、Node授权、route、
  TLS、scoped transport key、grant兑换与租约取消。
- Station Access：attempt、准入、policy和最终GRANTED。
- Session DBStore：actor_sessions真源、Session激活、失效与撤销；
  按device管理独立Session，类别仅作策略元数据。
- Actor Identity：公钥连续性、设备证书、当前profile revision和设备撤销。
- 客户端identity/PIN/runtime pipeline与安全存储。
- Messaging/Recovery/secure-content：消息及历史恢复本身。

## 2. 新增的窄能力

Station `app/subserver/device_link` 加入事务协调器，调用现有owner端口，
按业务资源域注册一次；Relay role 不加载该 subserver。
Node Connectivity增加actor-policy约束的新连接材料请求，以及sealed bootstrap
blob引用。Dashboard原管理入口保留；不能将普通账号升级为Dashboard管理员。
生产注册的Relay Runtime通过同一ConnectionMaterialIssuer端口提供单路线、
独立多Relay候选和sealed blob发布。不能用仅在StationControl上存在的可选接口
替代Runtime实际注册。共享native bootstrap负责固定HTTPS路径、现场endpoint签名、
DNS地址约束与密文核验；连接owner随后独立验证并兑换路线。

从OAuth finalizer抽取普通Session准备/ack内部端口，保留原OAuth provider语义；
不能让Device Link依赖第三方OAuth登录代理。

Session owner统一修改active唯一索引、替换/轮换、恢复与撤销scope，
覆盖密码/OAuth/扫码全部登录路径。保留client class分类，但不把它当设备数量限制。
对应上游 Access/Session 文档与验收同步修订；多手机原生 Journey 仍须独立证明。
存量无可信device绑定的Session需重新认证。
待审批claim的profile fence由授权后的Status读取在共享事务中刷新并推进offer
revision；Desktop据此重算核对码。已批准请求按完整命令摘要幂等，
后续资料更新只影响设备enrollment与凭据，不能改变原approval transcript。
终态Mobile投影来自自己的claim，另一个claim成功不改变该手机的拒绝或取消结果。

Mobile在camera host adapter增加成熟QR解码能力。Android与iOS只分化Host；
载荷解析、安全状态、重试、claim与网络决策在共享Rust/core完成。
相机帧不上传，不依赖WebView `BarcodeDetector`作为两端唯一生产实现。

Mobile 原生请求使用固定 Station/root、route ID/generation/revision 的
libp2p HTTP 路线对象提交，不通过随全局选择变化的 loopback proxy 提交敏感正文。
连接转换先保存原生安全存储中的转换意图，再准入专用路线和暂存 Session，
支持转换中断或存储 readback 失败后的同 root 恢复。无凭据交付的过期取消
先完成本地安全清理，不依赖网络恢复。

Mobile 登出先 fence 扫码器和事务，随后必经原 OAuth Session revoke/purge；
相机关闭失败单独投影，不得阻止凭据清理和认证 generation 推进。
已确认扫码事务的 Session 投影每次从原 Session owner 读取，不能保存成独立
轮换真源。持久化 Flow 仅用于恢复同一事务；renderer 不持有 bearer 或密钥。
COMMITTED 不再投影临时 Access attempt；Mobile 用已确认的规范 Session
进入原 Station Access 重验证，当前 GRANTED 才激活 Session runtime。
后续 policy 要求新 gate 时由普通 Access 流程接管，不能复用交付前的 grant。
提交后的 Device Link 页面释放入口所有权，普通 Access、PIN 与 Shell 按现有
launch state 显示。Session owner 在恢复、轮换与撤销的异步发布前检查当前
admission epoch；fence、suspend 与 teardown 后的旧响应不能重新开放写权限
或创建 refresh timer。
Session descriptor 在等待 Station registry 前捕获 lifecycle epoch，等待后
再次检查 running/epoch；迟到的成功或失败都不能进入 controller 获得新准入。
登出后，丢失 Claim 响应的取消恢复可在原设备/旧 generation 下保存已核验的
cleanup metadata，仍受 cancellation epoch 与原路线所有权约束。该能力只用于
恢复并取消原请求，不能 prove、ack 或重新安装已清除的 Session。

## 3. Schema 收敛

链接、二维码参数和codec以[Schema](../../../shared/schema/README.md)为唯一入口。
Schema解析后向业务owner交付类型明确的载荷，业务owner完成权限验证与执行。
移动deep-link、冷启动、应用内扫码、连接文件粘贴使用同一个严格解析结果。

现有`pt://`内容导航与`peers-touch://connect#`的语义可保留在一个registry；
OAuth callback的严格匹配保留在专门OAuth handler。
不能通过generic dispatch绕过其state/attempt校验。

## 4. 禁止关系与失效影响

Schema不导入Session/store/network controller；UI不直接调Relay或Station HTTP；
Relay不接受登录凭据；Station不读取Actor seed明文；
Desktop不能指定另一个Actor、强制新设备通过policy或修改Mobile已存密钥。

换Actor/Station、锁定或登出：撤销本scope的审批、临时key与listener；
route替换：保留账号，只取消旧lease；Node撤销：失效该Node材料，重取同root路线；
Session撤销：未提交offer失效；扫码器关闭：释放相机，保留可恢复claim。

Desktop Create 先认证当前已注册设备，再按原 Session/request 精确恢复已分配
offer；profile 后续变化不使既有请求永久失效。只有确认未分配的
`PROFILE_STALE` 才释放签名请求，下次读取当前 profile 重新生成。
新 request 在同一 Actor 事务中撤销该原 Session 的未提交旧 offer 后分配，
因此 Desktop 重启丢失临时接收私钥时无需保存可转移私钥，也能刷新二维码。
其他有效 Session 的 offer 保留；已提交设备和 Session 不属于刷新撤销范围。
原 Session 已撤销、过期、删除或不再匹配绑定时，新认证请求在 Actor
事务内终止该未提交 offer，释放 live slot，再分配自己的 offer；不返回
旧二维码或授权材料，原凭据仍被拒绝。Session 读取异常保持失败，
不能当作已撤销。请求的当前设备、完整签名与证书必须先通过验证。
Desktop Create/cancel 在同步 IPC 入口预留或撤销同一 native slot，再调度
阻塞 worker；worker 不能重新申请 slot。取消按 Station 的当前终态裁决，
不以发请求前的本地时间加五分钟作为完成依据。丢失 Create 响应后，取消
可从原 Station 认证的同请求响应恢复 opaque offer ID，再读取状态/签名取消；
这条路径不创建 VerifiedOffer 或 QR、不兑换路线、不交付或批准凭据，
普通 Create 与扫码仍须通过完整签名、root 和有效期验证。
取消 lookup 保留在原 Flow 内，失败重试不必重新分配。Station 的原请求终态
恢复先匹配 Actor/Session/签名与完整请求摘要；过期转移先提交原事务，再返回
仅含 offer ID、终态、revision 和期限的错误投影。摘要冲突仍无 lookup metadata。
本地回收按 Actor、Station/root 与 activation scope 隔离阻塞。
旧 JWT 已不可用的 Flow 保留为 pending，不假定其远端结果；新登录
不能继承它的授权，也不因它的 RPC 失败而无法发码。未解决的 retired
Flow 总数上限仍为 32，达到上限显式返回 cancellationPending。
全量回收在有界调度预算内处理后续项，单项失败或忙锁不跳过其他可释放项；
新发码只同步等待同 scope 的回收。窗口失效与显式关闭仍尝试全量回收。

Device Link 原生路线在握手和 secure-storage readback 完成后通过 cache/active
同锁序 CAS 接纳，不先改变全局路线来探测。selection epoch 同时保护空状态，
不会越过用户的 select/remove。恢复意图只可接纳本事务的同 root 路线，
用户选择的新路线不能被未完成的恢复覆盖。
取消与过期清理也检查 selection epoch 的 Device Link 所有权；即使用户显式
重选同一 route/revision，旧事务也不能恢复 previous route 或关闭所选 transport。
真实 transport 失败后，状态 driver 使用原 offer 或选定设备的后续 bundle
重新握手；每个 Relay 继续使用其端点私钥。迁移后下一次状态读取核对写结果，
transport 不重发不确定的 mutation。各候选 discovery/probe 最多5秒，
整个接入最多15秒；界面等待不计入此预算。
另一部手机的登录/刷新/退出不得撤销当前手机；撤销按选定device及其Session执行。

这是目标关系说明，不是代码迁移阶段或已完成事项。
