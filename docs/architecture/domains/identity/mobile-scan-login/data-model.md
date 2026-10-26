# Device Link — Protocol and State

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-27 | **Updated**: 2026-10-27
> **Owner**: Identity and Access

以下为已审查的目标合同，定义于 `model/domain/auth/device_link.proto`；
peer 网络扩展仍由 `model/domain/peer/` 拥有。不能先写手工 TS/Go/Rust wire DTO。

## 1. 二维码与签名

`DeviceLinkOfferStatement` 包含：

- `offer_id`、随机 `offer_nonce`、预期 `station_peer_id` 与 root公钥；
- `actor_ref`、原 Desktop device ID、Actor 身份公钥指纹；
- Desktop HPKE接收公钥、issued/expires、业务协议版本；
- bounded connection bundle、允许能力与当前链接 revision。

`SignedDeviceLinkOffer` 包含 exact statement bytes、Node signature与现有
root→Node authorization。使用独立 domain separator，签名覆盖完整 statement；
摘要验证不能把解析后重编码当成原签名材料。通用 Schema外壳不签发业务权限。

`DeviceLinkLocator` 是短码候选：预期 root PeerID、locator随机值、解封密钥、
offer digest、retrieval endpoint的最小 trust、Desktop临时公钥与expires。
二维码的带外来源认证此引导；单靠下载文档的自签名不能证明操作者身份。

`ConnectionBundle` 最多4个候选，引用当前生成的
`PublicEndpointConnectionMaterial`/`StationConnectionEnvelope`。
私有 grant各自绑定 Relay/route/generation；Mobile使用自己的 scoped transport key
签署既有 `AccessEndpointSourceProof`，同源兑换幂等。扫码前的引导grant最多4个
source名额，与claim上限一致；获批source的后续材料不与其他扫码者共享。

网络引用使用独立 `SealedBootstrapBlob`：随机 locator、blob bytes/digest/TTL、
上传源 Node授权与 source proof；其中没有 Session或Actor私钥明文。
完整解封 offer不允许再引用下一层。
实际peer合同为`BootstrapBlobStatement`和publish/retrieve消息；
声明只含locator摘要，hosting owner不持久化明文locator或解封密钥。

sealed offer格式固定为`PTSO1\0 || nonce[12] || ciphertext || tag[16]`，
使用ChaCha20Poly1305和每offer独立的随机32字节解封密钥。
AAD为`peers-touch/device-link/sealed-offer/v1\0 || SHA256(signed_offer_bytes)`；
加密前执行16KiB总长度上限，解封后再校验完整offer摘要与Node签名。

## 2. Claim 与加密 transcript

`DeviceLinkClaim` 包含 offer/claim ID、Mobile device ID、平台、客户端版本、
用户可读设备名、Mobile临时HPKE公钥与设备签名公钥、nonce、Access attempt、
PoP签名。平台/设备名是未验证声明，只供识别，不能代替核对码和密钥 proof。

HPKE候选 suite：RFC 9180 DHKEM(X25519, HKDF-SHA256) /
HKDF-SHA256 / ChaCha20Poly1305；使用维护中的实现与标准向量，禁止自造握手算法。
Desktop和Mobile分别为接收方持有独立临时私钥。每份密文使用新的 sender
encapsulation，绑定用途、offer/claim、root、Actor、双方公钥、attempt和revision。
接收方同时验证来自事务授权方的 transcript签名，不以Base模式加密代替来源认证。

offer的crypto context在出码时固定；选定claim的approval transcript在批准时固定。
后续state revision只用于CAS，不能改变已交付密文的AAD。Credential交付另绑定其
Access decision revision。改变目标key/claim必须生成新授权，不能复用旧密文。

`IdentityTransferMaterial`：Actor seed与指纹、目标scope、profile revision、
选定Mobile公钥/设备ID、密文用途。不得包含Desktop设备私钥、token、数据库密钥。
指纹必须是 Actor Identity 已使用的公钥 SHA-256；解封后验证派生 Ed25519 公钥，
不以 seed 摘要或客户端自报 PTID 替代已签名 offer 的绑定。

`MobileCredentialDelivery`：Mobile专属 `LoginResponse`、Session/device绑定、
Access decision revision、delivery ID、期限，独立加密给Mobile。身份交付与
Session交付分开，不能使用同一密文或nonce表达多个用途。

`node_credential_signature`签署domain
`peers-touch/device-link/credential/v1\0`加完整确定性
`DeviceLinkHpkeEnvelope`字节，覆盖ciphertext和其中的exact transcript。
不能只签transcript后接受另一份同AAD密文；接收方同时验证
`LoginResponse.session_id`与transcript以及`actor_ref`与approval的绑定。
`AuthTokens.refresh_token`沿用当前登录合同，允许为空；接收端不得凭空要求
Station签发独立刷新凭据。`access_token`与其兼容别名必须保持一致。

`DeviceLinkStatus.current_profile_revision`提供当前Actor Identity fence，
供Mobile在profile变化后重新签署同一设备证书。它不修改已批准transcript的
`profile_revision`或加密AAD；新证书通过owner校验后淘汰旧的inactive凭据交付。

## 3. Station 持久化真源

候选表 `device_link_offers`：

- offer/Actor/Station/原Session与Desktop device绑定、issued/expires、revision；
- bounded claim集合、selected claim、Access attempt/candidate引用；
- 授权与交付状态、密文摘要/密文、delivery/ack摘要、终态原因；
- 所有秘密 locator/claim凭证仅保存哈希；需要恢复的密文有独立TTL。

Station使用现有keyring和独立用途domain，以随机offer/claim ID为输入派生32字节
scan、claim、locator与解封capability；持久化其哈希和key ID，不保存明文秘密。
offer公开存储去掉scan字段，完整签名offer仅在sealed blob内保留。
同request重试重建原始字节；keyring退休或hash不匹配时拒绝恢复，不能重新生成
同ID的授权秘密或续期。终态保留24小时幂等窗口，然后按有限批次删除本事务记录。

Session与Actor Device仍写原真源，禁止另建登录用户、设备注册或active session表。
临时私钥存在端安全存储；TS/store、二维码缓存、日志、遥测、Evidence Store不保存秘密。

允许的状态：

`OPEN → CLAIMS_PENDING → APPROVED → IDENTITY_DELIVERY → DEVICE_PROVED →
ACCESS_PENDING → CREDENTIAL_DELIVERY → COMMITTED`。

任一未COMMITTED状态可进入`DENIED/CANCELLED/EXPIRED/REVOKED`；
这些终态不能复活。Access阻断保留typed reason；可恢复action继续同一attempt。
`COMMITTED`后取消码不等同撤销设备，后者使用原设备/Session管理流程。

批准基于`offer revision + selected claim + Desktop session/device` CAS；
Access与原Session在准备凭据及ack时再次检查。准备inactive Session和交付密文、
ack激活与设备绑定各自是共享数据库事务，使用现有owner端口暴露事务参与能力。
不能先激活再下载token，也不能靠异步跨表补写实现“原子”。
事务遵循 Actor → offer → Access attempt → device → Session 锁序；
当前策略、profile、approver 与目标设备撤销状态都从同一事务读取并校验。
Actor Identity 提供限定授权 scope 的 enrollment 事务端口，
pending certificate 不写成活跃设备；ack 成功才提交设备与 Session。

## 4. API 权限与幂等

- `create`：原Actor已授权且设备可信的Desktop Session；服务端推导Actor/root。
  `request_id`精确重试先恢复同一offer，不要求旧证书的profile revision仍为当前值，
  不重新消耗grant。新request先校验当前证书，再在同一事务中撤销该原Session
  的未提交旧offer并分配；其他Session的offer拒绝替换，已提交设备不受影响。
- `claim`：扫码秘密对应的受限 claim capability加Mobile PoP，不能访问业务API。
  同`offer + mobile key digest + request_id`返回同claim；其他设备独立排队。
- `status`：Desktop原Session或一个claim capability；Mobile只看自己的claim。
  不向任意扫码者枚举其他设备、账号详情或全部claim。
- `approve/deny`：Desktop Session和设备proof；指定claim与observed revision。
  approve携带给目标key的身份密文及transcript签名；CAS成功才原子保存。
  审批幂等；不同claim的并发批准只有一个胜者。profile revision由Station
  的受限claim结果提供；无Session的Mobile不能绕过认证直接访问actor/profile。
- `material`：选定claim及目标key PoP；未批准不可取身份密文。
  凭据交付还必须有当前Access GRANTED。
- `ack`：delivery ID、目标设备proof、持久化凭据摘要；唯一Session条件激活。
  同proof重试返回原结果，不重复创建Session或踢其他设备。
- `cancel`：原Desktop或claim owner，仅取消授权范围内对象。
  失败的未知写结果必须先`status`读回，不能盲目重发。

Token准备逻辑应从现有 `PrepareOAuthSession`抽出auth-method-neutral内部能力，
保留OAuth现有安全/ack语义；Device Link不冒充OAuth provider。

active Session唯一性属于Session owner：同Station、同Actor、同device最多一个
当前活跃Session，不同device可并发。client class不参与唯一槽判断；
重复ack按delivery幂等，重新认证/轮换按device替换。设备撤销失效其全部Session；
全账号撤销是独立操作。当前client-class索引及旧替换入口必须统一改动，
不能只在Device Link的ack路径绕过。

## 5. 有限预算与恢复

候选默认值：offer 5分钟；最多4个claim；每Actor最多1个开放offer；
每连接普通协议体64KiB，sealed bootstrap最多16KiB，身份传递明文最多4KiB。
频率、源限额、整体容量和批量TTL清理均由Station/Relay owner执行；超限typed拒绝。
Station创建预算独立计算所有保留offer：每Actor每分钟8次、保留64条；
全站每分钟128次、同时开放256条、总保留4096条。幂等重试不新占名额，
取消不能释放频率或保留预算。分配前在共享事务中锁定并求值，不从进程内计数。
终态24小时后由offer owner按Actor→offer→Access锁序退休；
Access删除未提交attempt与submission，已提交Session的Access审计继续保留。
QR输入最大8KiB；引用深度1；QR密度/显示尺寸限制由Schema再收紧。

单candidate握手预算5秒，最多2个并发、整个接入预算15秒；到期取消全部pending dial。
重试不自动延长期限。连接grant一source兑换、重复同source幂等；
引导grant全局最多4个source，选定设备的后续grant为单source用途；
切换Relay需要该Relay独立材料，重扫旧码不会增加max_uses。
耗尽名额只可由Desktop显式刷新新offer，不能first-scan自动授权或无限补发。

事件仅作唤醒提示；客户端按revision读回，前台期间bounded poll可补丢事件。
后台关闭相机，暂停轮询；恢复后重新握手与查询Station，不用缓存在线状态。
相机解码只保留最新任务；首次接收后暂停，扫码抖动不能重复生成claim。

Station重启从共享真源恢复；Desktop临时接收密钥丢失则取消旧offer；
Desktop新Create通过原Session认证定位及撤销遗留offer，不依赖持久化临时私钥。
Mobile持有原claim/key可重取相同密文并ack。安全存储失败不ack；
COMMITTED ack丢失按原delivery读回。取消/过期后的暂存身份可清除，
但仅清除本事务创建且未提交的material，不能覆盖已有账号密钥。

设备证书可在pending事务中完整校验，但未提交前不得成为活跃Device。
事务过期清理inactive Session、pending设备及密文，不触碰已提交设备。
授权撤销只阻止后续交付，不能撤回Mobile已经解封的seed。
引导permit短TTL不产生业务Session；码取消后的残余permit不能绕过Station认证，
不得对该transport承诺即时远程擦除。

## 6. 错误与可观察性

候选typed错误：
`OFFER_EXPIRED`、`OFFER_CANCELLED`、`CLAIM_LIMIT`、`CLAIM_NOT_SELECTED`、
`STATION_UNREACHABLE`、`STATION_ROOT_MISMATCH`、`BOOTSTRAP_UNSUPPORTED`、
`GRANT_EXPIRED`、`GRANT_REPLAYED`、`PROFILE_STALE`、`IDENTITY_CONFLICT`、
`APPROVER_REVOKED`、`ACCESS_BLOCKED`、`DEVICE_SESSION_CONFLICT`、`DEVICE_LIMIT`、
`SECURE_STORAGE_FAILED`、`DELIVERY_PENDING`。

日志只记录事务关联摘要、阶段、错误类型、route kind、耗时与revision；
不得记录码载荷、fragment、locator、seed、核对码、token或解封后的material。
计时分别归因decode、retrieval、discovery、dial、授权等待、Access与ack；
人类等待不计入网络延迟。资源释放保留独立清理证据。
