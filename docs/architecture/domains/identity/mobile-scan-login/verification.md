# Mobile Scan Login — 验证状态

> **Status**: native development iteration; product UNPROVEN
> **Date**: 2026-10-27
> **Worktree**: peers-relay / feat/mobile-scan-login
> **Base**: b6e481c69b718c40644fe3c922a1a73daa38ca16

## 源码范围

Station 设备授权事务、Desktop 发码与批准、Mobile 原生扫描和账号接纳、
按设备独立 Session，以及统一 Schema codec/QR 消费者已接入源码。
COMMITTED 后仍由当前 Access 决策、Session、PIN 和 lifecycle kernel 控制入口。
模块 active 和源码检查不代表扫码登录或多手机业务已验收。

## 当前检查

- Mobile Device Link、Session 和真实 descriptor 生命周期测试：26 项通过。
- Desktop 原生取消接纳、终态恢复与原请求 lookup 回归测试：11 项通过；
  Station Device Link application 模块测试通过，覆盖终态持久化、摘要冲突
  拒绝及新登录清理失效原 Session 的旧 offer。
  只读 Go source overlay 恢复修复前的分配逻辑后，撤销、过期、删除原
  Session 三个回归格均因 CAPACITY_EXCEEDED 失败；当前源码全部通过。
- Mobile 前端生产构建及 iOS simulator Rust 检查：通过。
- Xcode 使用明确的 iPhone 17 / iOS 26.5 destination，编译并链接原生
  `Peers.app`：通过。使用 SDK 27.1；没有安装新的 Simulator runtime。
  这是模拟器打包结果，未启动账号 Journey，也不是签名真机包。
- 独立原生 iPhone 17 / iOS 26.5 图片解码探针：CoreImage
  `CIDetectorTypeQRCode` CPU 路径 4 项通过。输入为当前 Schema renderer
  导出的 PNG，覆盖普通 URL、Peers 风格 UTF-8 URL、测试 Device Link
  locator 和空白负例；三个有效码逐字匹配，空白图无结果。
  这是模拟器图片解码能力检查，不是 `Peers.app` 扫码或登录证明。
  当前插件使用 `AVCaptureMetadataOutput`，同一模拟器的摄像头枚举为 0，
  插件没有图片输入接口；完整模拟扫码需要原生图片输入适配或兼容虚拟相机。
  探针及结果位于 `/tmp/peers-relay-msl-simulator-20261027/`，
  `report.json` 引用图片和 renderer 源码指纹，`cleanup.json` 记录资源释放。
- 路由 owner 的选择、恢复、更新及取消释放测试：20 项通过；
  包括显式重选相同 binding 后旧事务不得覆盖选择。
- `one` Station 已部署本地 checkpoint
  `c17bff3dadcef1cbf397ae026e872badab23b06f`；
  `/app-meta/version` 的 `build_commit` 与其逐字相同。
  原生 Desktop 经 `make desktop` 启动，使用嵌入式 WebDriver 操作：
  添加并验证当前 Station、Alice 密码登录、创建/确认本地 PIN、
  进入 Shell 与全局 Settings Account 均已现场执行。
  这些前置步骤不等于 Mobile 扫码接纳通过。
- 原生 Desktop 发码失败已复现：收到的 Schema action 是完整
  `deviceLinkOffer`，链接 1,892 字节，固定 360 像素的 QR 生成返回
  `PAYLOAD_TOO_DENSE`。去掉头像、扩大至 720 像素/版本 40 仍因
  当前 Q 纠错容量失败；没有降低纠错要求。
  当前响应未提供 locator。`one` 的 Direct origin 为 HTTP，而原生
  sealed-blob retrieval 要求 HTTPS；Relay HTTPS 健康检查通过，
  当前 Dashboard attachment 列表为空。部署包含 Relay pool overlay
  与 CA 文件挂载；受认证邀请导入返回 503，Station 日志明确报
  `x509: certificate signed by unknown authority`。失败邀请已通过
  Relay owner 撤销。尚未证明 reservation 或短引用可用。
- 两个本任务 Android API 35 Emulator 已成功启动，虚拟相机支持
  `virtualscene-image` 动态图片输入，WebView 124 与 ChromeDriver 124
  版本匹配。尚未安装本需求 APK，也未执行生产插件扫描。
  原生构建先遇到 NDK `ranlib` 选择错误，使用已有的 `TARGET_RANLIB`
  配置后通过 Rust 编译；随后发现未锁定的 CameraX/MLKit 依赖。
  Android host 已同步至 AGP 8.9.1 / Gradle 8.11.1 / compileSdk 36，
  对齐 barcode-scanner 2.5.3 的 SDK 36 和 CameraX 1.5.1 要求。
  root/buildSrc 与应用、原生插件 classpath 的依赖锁已重新解析，
  原生 build owner 同步 Cargo 2.12.5、扫码与 secure-input 插件输入。
  `checkUniversalDebugAarMetadata` 与生产插件 `compileDebugKotlin`
  均通过；完整 APK 构建和生产相机扫码尚未通过。
- Suite 复用合同审查：PASS / runtime NOT_RUN。五客户端只在 Suite 预置一次、
  场景 attach-only 的合同成立，未执行该 Suite。
- 正式 gap detector 未生成有效结果：外部 Evidence Store 没有本次正式
  acceptance-plan/run。不得把冻结实施计划或上述测试替代正式业务证据。

取消恢复保留原请求的 opaque lookup，失败后不丢失。Station 仅在原 Actor、
Session、设备签名与请求摘要匹配时返回终态元数据；已过期记录先在事务内
终止并提交，摘要冲突不给恢复身份。普通 Create/扫码的签名与有效期验证
保持独立，取消恢复不产生可用登录材料。
旧 JWT 不可用的回收保持 pending，只阻塞原授权 scope；单项失败
仍尝试释放后续可清理项。新 Session 的发码由自身认证决定，
Station 事务可清理已证明失效的原 Session offer，不恢复旧授权。
未知结果最多保留 32 个 retired Flow，达到上限仍显式拒绝新分配。

独立分组与跨组代码审查覆盖原生、Station、Schema 和返回值/生命周期边界。
最终审查与源文件指纹、构建日志保存在本工作区外的
`/tmp/peers-relay-msl-review-20261027/` 及
`/tmp/peers-relay-msl-*.log`；这些是 Development 诊断，不是正式证据。
最终完整 source snapshot 与 outcome 文件摘要由该目录的
`source-snapshot.json`、`verification-summary.json` 引用。

## 未证实的产品范围

MSL-A01—MSL-A09 继续 UNPROVEN：

- Android/iOS 相机读取真实 Desktop 屏幕码，包括权限拒绝、后台释放和扫码测量。
- Direct/Circuit 与多 Relay 现场可达性、失败迁移及真实业务请求。
- 当前 policy gate 显示/提交、PIN/Shell 接纳及新消息双向可见/可解密。
- 两部手机与多个 Desktop 同账号共存、独立 inbox、重登/轮换及定向撤销。
- 真实 PG 并发事务、重启、丢失 claim/approval/ack 和安全存储故障恢复。
- 原生窄屏、键盘/读屏、字体放大、暗色及性能采样。

现场资源核查发现一台已配对可用 iPhone；未对该 iPhone 安装或启动本需求 App。
Android SDK 位于 `/opt/homebrew/share/android-commandlinetools/`，包含 Emulator、
API 35 system image 和 NDK；Emulator 提供虚拟场景 poster 图片输入选项。
Android 本需求 App 的虚拟相机扫码尚未执行。

## 运行边界与清理

当前工作区已按用户授权选择 `one` Profile。机器控制面确认 remote
Station、`station-1` 部署绑定、slot 18，以及 `station.connect` /
`station.deploy` 能力；Profile 定义为 tracked-clean。
用户已授权本地 checkpoint 和继续实测，Station 当前 live build 已核对。
本轮 Android 依赖锁修改尚未形成下一 checkpoint；修改源码后应重新绑定
构建身份，并按受影响 owner 重建/部署，不继承本轮前置步骤的结果。
完整扫码登录 Journey 尚未执行。

本轮 Desktop 已通过 `make desktop-stop` 停止，WebDriver session 已关闭；
发码弹窗已关闭并交还取消 owner。两个本任务 Android Emulator 已停止，
Appium 服务已停止；保留任务专属 AVD 和构建缓存供后续迭代复用。
远端 Station 保持本次已核对的部署；不删除账户数据库、安全存储或证据。
Xcode 构建已退出。独立图片探针已终止，三个本任务 Simulator 已关闭并删除；
没有启动 `Peers.app`、占用真实相机或修改既有模拟器。
本地 checkpoint 已获授权；无协作分支 push、PR、merge 或发布。
