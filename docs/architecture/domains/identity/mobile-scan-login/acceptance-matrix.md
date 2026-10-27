# Mobile Scan Login — Acceptance Contract

> **Status**: accepted
> **Version**: v1.0
> **Created**: 2026-10-27 | **Updated**: 2026-10-27
> **Owner**: Identity and Access

所有项目目前 `UNPROVEN`。这些是待实现的业务验收合同，不是当前registry中已有Gate。
业务注入复用Station Access、Mobile Native、Chat生命周期的受控隔离Suite；
构建/账户/Station/Relay/设备在Suite层复用，不能每个场景重复部署。

- **MSL-A01 / C01,C02 / J01**：在真实Desktop生成码，Android/iOS App内相机扫描，
  无手输站点/账号/密码；Desktop批准后Mobile进入同root、同Actor Shell。
  读回Session、Actor Device与profile revision，Device ID一致，Desktop未退出。
  基础为connection material/Access/Session；缺口是Device Link与camera解码闭环。
- **MSL-A02 / C05 / J02**：Desktop走LAN Direct、Mobile走独立网络Relay；
  私有grant、错误Relay、过期、重扫、Direct失败转Circuit、Node换签均覆盖。
  手机可用业务请求与新消息证明连接；不能只用`/health`或源码解析PASS。
- **MSL-A03 / C03 / J01**：两个端Actor身份指纹一致，Mobile签名密钥不同；
  双向发新私聊消息并验证收件可见/可解密；重启Mobile后同scope恢复。
  删除Mobile设备后不得继续业务访问。历史恢复单列，不纳入登录成功承诺。
- **MSL-A04 / C02,C04 / J04**：两台手机抢扫、并发批准、旧码、旧revision、
  错误root/SPKI/PoP、公钥替换、Desktop登出/撤销、Replay。
  未被选中或未通过Gate的设备不得取得明文身份、有效Session或进入Shell。
- **MSL-A05 / C04 / J04**：Station/Client重启、网络中断、批准/ack响应丢失、
  安全存储失败。读回同事务不重复创Session，pending超时清理，旧事件不回写。
  verify原Session/current policy在交付及ack时的再次校验。
- **MSL-A06 / C04 / J03**：本设备Session冲突、显式设备数量策略、不同账号切换、
  长名称、PIN/terms、
  identity conflict。用户明白影响，取消保留当前账号，不隐式覆盖密钥。
- **MSL-A07 / C01,C04 / J01—J04**：Schema两种风格、头像缺失、过长材料、
  dark mode、窄屏、读屏、权限拒绝、后台相机释放、重扫抖动。原生扫描必须解出
  原始payload，不能用假码图或注入deep link替代相机证明。
- **MSL-A08 / C01,C04,C05**：引用模式私有Station先取blob再兑换grant；
  hostile locator、任意URL、redirect、DNS变化、超限body、HTTP凭据泄露、
  TTL清理与Relay role隔离。无引导服务时明确降级，不出现循环依赖。
- **MSL-A09 / C02,C03 / J01,J03**：至少两台不同Mobile安装实例分别扫描独立offer，
  使用同账号同时在线，互不踢出且Desktop保持有效。每台设备ID、签名密钥、
  Session、inbox独立；新消息及来电遵循现有多端投递/仲裁合同。
  一台重登、刷新、退出或被撤销后，其他手机仍能收发；已撤销设备不得继续访问。
  覆盖不同登录方式混用、并发激活、跨Node、重复ack及Session索引迁移。
  原生设备和数据库读回不可被两个WebView或同一device_id的模拟会话替代。

候选测量：每个OS各30次、固定屏幕/码尺寸/距离/照度，记录payload字节、
QR版本、ECC、头像比例与扫码结果。无头像与头像码分开统计。
目标首次解码P95≤2秒、成功率≥29/30；网络接入P95≤15秒；
批准后的自动流程P95≤5秒，不含用户Gate输入及已有PIN。它们是待测预算，
没有现场证据时不得自动放宽或宣称通过。

源检查证明proto/core/owner一致；UI原型证明意图；
正式PASS还需要当前源码的原生相机、真实路线、Receiver效果、真源读回与清理。
日志/证据禁止留QR秘密、账户seed与token。仅需要跨scope关联摘要。
