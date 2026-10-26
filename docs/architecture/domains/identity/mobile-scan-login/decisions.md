# Mobile Scan Login — Decisions

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-27 | **Updated**: 2026-10-27
> **Owner**: Identity and Access

以下决策已接受；module active、设计接受与原生产品证明分别管理。

## Decision Index

| ID | Decision | Status |
|---|---|---|
| MSL-D01 | 同一逻辑 Station，允许不同路线 | accepted |
| MSL-D02 | Station 协调授权，Access 决定准入 | accepted |
| MSL-D03 | 独立设备密钥与加密 Actor 身份传递 | accepted |
| MSL-D04 | 私有 Station 接通前取得短引用 | accepted |
| MSL-D05 | 选择 claim、核对与单事务 CAS | accepted |
| MSL-D06 | 登录与历史恢复分离 | accepted |
| MSL-D07 | 账号允许多设备，Session 按设备隔离 | accepted |

## MSL-D01：同一逻辑 Station，允许不同路线

**Status**: accepted
**Date**: 2026-10-27

### Context

peer proto与station-trust将Station root身份和Node/Relay路由分开。
Desktop可达的URL并不能证明手机侧可达。

### Decision

使用同root下验证通过的Direct/Circuit候选，Mobile独立完成fresh discovery与
grant兑换；不以相同URL、Node或Relay作为同源条件。

### Rationale

手机不输入站点，并可使用不同于Desktop的网络路线，保持同一逻辑Station。

### Alternatives Considered

复制Desktop URL、维护隧道或已消费grant会把桌面可达性误当手机可达性。
强制两端使用同一Relay也会丢失合法的Direct与故障切换路径。

### Consequences

必须管理fresh grant、候选期限和route lease；全部候选不可达时不能登录。
上游root或路由合同变化时重新审查。

## MSL-D02：Station协调授权，Access保留最终决定

**Status**: accepted
**Date**: 2026-10-27

### Context

Access拥有GRANTED，Session owner拥有会话激活；Desktop批准不等于Station准入。

### Decision

Device Link协调器验证Desktop批准、Mobile设备proof与当前Access策略。
Mobile专属凭据先交付到安全存储，ack后通过同一事务激活Session和Actor Device。

### Rationale

设备撤销、policy、本设备Session与幂等规则仍从原owner真源读取。

### Alternatives Considered

二维码内放token、扫码即自动授权或先激活后下载凭据都会扩大账号接管边界。
独立Session/Actor Device表会产生第二套授权真源。

### Consequences

Desktop需要明确确认；当前policy与原Session在交付及ack再次验证。
若产品要求无人确认授权，必须重新审查安全和产品合同。

## MSL-D03：独立设备密钥，加密传递当前Actor身份

**Status**: accepted
**Date**: 2026-10-27

### Context

现有enrollment连续性与prekey签名需要Actor seed。只复制Session或设备证书
不能使当前Messaging身份闭合。

### Decision

使用标准HPKE固定suite向选定Mobile传递Actor seed。Mobile签名、传输与数据库
密钥独立；身份指纹保持SHA-256(Ed25519 public key)。
Desktop注册设备签署immutable approval transcript，Mobile验证来源及派生公钥。

### Rationale

复用现有身份与消息加密合同，不把HPKE Base模式当作来源认证。

### Alternatives Considered

复制Desktop全部私钥、生成不同Actor seed冒充同账号，或只传证书都不能满足
设备隔离及现有消息身份的要求。

### Consequences

新增可信设备获得Actor身份签名能力；撤销不能抹掉已经交付的seed。
非导出/委托身份必须另立架构。

## MSL-D04：短引用必须能在私有Station接通前取回

**Status**: accepted
**Date**: 2026-10-27

### Context

完整route、grant、delegation与TLS材料可能超过二维码密度预算。
私有Station不能要求先连接或登录，才取得连接自身所需的材料。

### Decision

使用受验证Station/已绑定Relay的短时sealed bootstrap blob。二维码保留最小
endpoint/root trust、locator、解封key和offer digest。无引用能力时使用预算内
单路线内联，仍超限则拒绝出码。

### Rationale

解封key不发给hosting endpoint，只有网络引导blob到达Relay；账号授权留在Station。

### Alternatives Considered

中心短链、任意URL下载、redirect、递归引用或Schema HTTP服务都会扩大信任边界。

### Consequences

Node Connectivity承担固定路径、TLS、源proof、TTL与配额验收。
原生端必须现场验证endpoint；稳定的安全内联可使用，但不能放宽密度预算。

## MSL-D05：选择claim与核对码，禁止first-scan-wins

**Status**: accepted
**Date**: 2026-10-27

### Context

公开显示的二维码可被多台手机扫描；最快扫码者不一定是预期设备。

### Decision

每offer保留有限独立claim；Desktop核对完整transcript派生的短码并选择一台，
通过CAS批准。未选中claim失效，只有选定设备取得身份密文与独立Session交付。

### Rationale

抢扫只造成有限干扰；Mobile公钥不由一段未核对的Station投影决定。

### Alternatives Considered

first-scan-wins与所有扫码者领取Session都无法表达操作者对目标设备的选择。
用短码作兑换凭证也会把人眼核对误作授权能力。

### Consequences

增加claim列表与核对一步；短码不能防全部社会工程。
一事务选一台不限制账号总设备数，独立offer可添加其他手机。

## MSL-D06：当前只承诺登录与新设备可用

**Status**: accepted
**Date**: 2026-10-27

### Context

Recovery archive、ratchet、MLS和Social recovery是独立资源。

### Decision

登录不复制聊天数据库、ratchet、MLS state或恢复master，也不保证全历史可读。
历史恢复继续走现有Recovery与群组加入合同。

### Rationale

登录的身份与新消息能力可独立验证，避免授权流程承担未经接受的恢复语义。

### Alternatives Considered

把完整历史迁移嵌入扫码登录会扩大密钥、数据与生命周期范围。

### Consequences

部分历史需要原Recovery入口；扩大恢复承诺需要单独产品确认。

## MSL-D07：账号允许多设备，Session按设备隔离

**Status**: accepted
**Date**: 2026-10-27

### Context

设计基线按(user_id, device_type)限制一个active Session，而Actor Device已有
独立device_id与撤销语义；产品要求多部手机同时使用同一账号。

### Decision

Session唯一性按同Station、同Actor、同device管理；类别只作策略元数据。
同device重登或轮换替换自己，不同device互不替换。所有登录方式共用Session owner。

### Rationale

每台手机拥有独立Session、inbox、签名密钥及撤销边界，Desktop与其他手机保持可用。

### Alternatives Considered

扫码特例、mobile类别唯一槽与隐式踢掉其他设备都不能满足多手机并发。
从IP/User-Agent推断缺失device绑定也不可信。

### Consequences

Session/Access合同、唯一索引、事务替换与迁移一并修订；无法可信绑定的历史会话
要求重新认证。跨设备投递、来电仲裁与撤销仍依据真实device。
多设备并发不等于历史迁移完成，继续服从MSL-D06。
