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

- Mobile Device Link、Session 和真实 descriptor 生命周期测试：29 项通过，
  覆盖扫码失败反馈保留、显式重扫与持久化 Claim 恢复。
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
  `0fc8de6b9c309f290cc701d6f5d6f26201f7bfb6`；
  `/app-meta/version` 的 `build_commit` 与其逐字相同。
  原生 Desktop 经 `make desktop` 启动，使用嵌入式 WebDriver 操作：
  添加并验证当前 Station、Alice 密码登录、创建/确认本地 PIN、
  进入 Shell 与全局 Settings Account 均已现场执行。
  这些前置步骤不等于 Mobile 扫码接纳通过。
- Relay 已通过 Make 部署与公开 TLS 健康检查，本任务 attachment 为 active。
  原生 Desktop 生成 `deviceLinkLocator`：534 字节、Q 纠错、版本 22、
  360 CSS 像素，生产 SVG 为 ready。原生 DOM 导出的 PNG 经独立
  解码器逐字验证；Desktop 屏幕截图未包含当前弹窗，因此光学屏幕证明
  仍为 UNPROVEN。
- Android host 使用 AGP 8.9.1 / Gradle 8.11.1 / compileSdk 36、
  Cargo 2.12.5、barcode-scanner 2.5.3 / CameraX 1.5.1，以及 APK 内置
  MLKit barcode-scanning 17.3.0。依赖锁 preflight、AAR metadata、
  Kotlin 与完整 APK 构建通过。两个本任务 Android API 35 Emulator
  的已安装 APK 与构建摘要逐字一致：
  `d5145690d16a04b1d096d4e7ecce9a876a59d01c0954398862e5c72bd28b1214`。
- Emulator 36.6.11 的 `imagefile` 输入已送入生产相机。使用原生 DOM
  的同一生产 SVG 导出 720 像素 PNG，置于 RGBA 1280×960 图像的
  `(0,40)`，相机原始帧中的码图为 840×840、8 像素/module。
  独立解码器和已安装 APK 内的 MLKit 均读出完整 534 字节载荷。
  同 APK 的 MLKit 对原始授权码 PNG、低密度 URL 和两个旋转方向均
  解码通过。该原生诊断不替代 App 登录 Journey。
- 生产 `device_link_scan` 已通过真实 CameraX/MLKit 读取 locator，
  原生接纳在短引用 source proof 阶段返回
  `MOBILE_DEVICE_LINK / deviceLink.sourceProofUnavailable`。
  Desktop 未收到 Claim；批准、Access/PIN/Shell 与双手机共存尚未执行。
  源码定位到 transport identity key 的 `/` 和 `:` 不符合 Android
  SecureStorage 的键字符合同；原生存储命令对该格式现场返回
  `MOBILE_INVALID_INPUT`，dot 格式探针返回 absent。
  已将 scoped key 转为 dot 格式，并将其命名空间限制为 Rust owner。
  扫码失败被后台 idle 读取清除的源码回归已复现并修复；
  新 APK 尚待重建，完整生产 Journey 仍未证实。
  当前诊断与源码身份见工作区外
  `/tmp/peers-relay-msl-native-20261027/native-camera-source-proof-failure.json`。
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
Android 本需求 App 已执行虚拟相机扫码，短引用接纳仍失败。

## 运行边界与清理

当前工作区已按用户授权选择 `one` Profile。机器控制面确认 remote
Station、`station-1` 部署绑定、slot 18，以及 `station.connect` /
`station.deploy` 能力；Profile 定义为 tracked-clean。
用户已授权本地 checkpoint 和继续实测，Station 当前 live build 已核对。
当前 APK、Desktop 与 Station 绑定上述 checkpoint；修改源码后应重新绑定
构建身份，并按受影响 owner 重建/部署，不继承本轮前置步骤的结果。
完整扫码登录 Journey 尚未通过。

本轮 Desktop 已通过 `make desktop-stop` 停止，WebDriver session 已关闭；
发码弹窗已关闭并交还取消 owner。两个本任务 Android Emulator 已停止，
Appium 服务已停止；保留任务专属 AVD 和构建缓存供后续迭代复用。
远端 Station 保持本次已核对的部署；不删除账户数据库、安全存储或证据。
Xcode 构建已退出。独立图片探针已终止，三个本任务 Simulator 已关闭并删除；
没有启动 `Peers.app`、占用真实相机或修改既有模拟器。
本地 checkpoint 已获授权；无协作分支 push、PR、merge 或发布。
