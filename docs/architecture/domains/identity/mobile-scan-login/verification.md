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

## 当前源码与构建检查

- Mobile Device Link、Session 和真实 descriptor 生命周期测试：29 项通过。
  Desktop 原生取消接纳、终态恢复与原请求 lookup：11 项通过。
  Station Device Link application 测试通过，覆盖终态持久化、摘要冲突、
  失效原 Session 的 offer 回收；只读 source overlay 的三个容量回归格
  已复现原失败并在修复源码上通过。
- Mobile native 路由测试：21 项通过。真实 Ed25519 证明覆盖过期传递材料
  拒绝、已接纳 source 的持久恢复、当前路线证明、TLS pin、选择/取消 fence
  和并发更新。首轮回归复现 `publicMaterialInvalid`；修复后的原生 Journey
  独立验证恢复效果。
- Mobile 前端生产构建、iOS simulator Rust 检查与 iPhone 17 / iOS 26.5
  原生 `Peers.app` 编译链接通过。iOS 图片解码探针 4 项通过；
  `CIDetectorTypeQRCode` 能读取生产 Schema PNG，但模拟器摄像头枚举为 0，
  当前 `AVCaptureMetadataOutput` 插件没有图片输入接口。未启动 iOS 登录
  Journey，也未安装到已配对真机。
- Android 使用 AGP 8.9.1、Gradle 8.11.1、compileSdk 36、Cargo 2.12.5、
  CameraX 1.5.1、barcode-scanner 2.5.3 与 APK 内置 MLKit 17.3.0；
  锁文件、AAR metadata、Kotlin 和完整 APK 构建通过。

## 当前原生 Development 实测

验证策略为 `development`，结果仅是限定 Journey 的 `FUNCTIONAL_CHECK`，
没有正式 Acceptance run。原生 Desktop 使用嵌入式 WebDriver；
两部任务专属 Android API 35 Emulator 使用 Appium 和生产 CameraX/MLKit。

APK 源码 checkpoint：
`9d151a90aa64760b0a5986e1a51330cefcbba7b9`。两部设备拉回的已安装 APK
均与构建摘要逐字一致：
`4298b09cbb426b0eaa90bb11c7e8408b37ce6bd520e7c6b0eff3c70080bfe4cd`。
`one` Station 的当前 `/app-meta/version` 为
`4e8341e1dd4379b018b314af4394fc1eb9c7ace5`。该 checkpoint 到 APK
checkpoint 只改变 Mobile native 路由 owner 和文档，Station、Relay、
Desktop 及共享协议源码无差异。

- Desktop 已执行 Station 验证、Alice 密码登录、本地 PIN 创建/确认、
  Shell 和全局 Account Settings。生产二维码使用 534 字节 locator、
  Q 纠错、版本 22；当前原生截图包含真实弹窗和生产二维码。
- 同一生产 SVG 导出 720 像素 PNG，经 Emulator `imagefile` 虚拟相机
  送入生产 CameraX/MLKit。两部手机均通过真实 `device_link_scan`、
  短引用读取和原生 Claim；没有将 locator 直接注入 native intake。
- 两端核对码逐字一致，实际点击 Desktop 的 `Allow sign-in` 按钮批准。
  Desktop 正常可见，生产 store polling 自行更新；没有伪造 visibility
  或通过 native approve 诊断替代本轮批准。两部手机均获得当前 Access
  GRANTED 并进入 `shell.chat-tab`，Actor/Station 相同，device/Session
  摘要不同，证明本轮独立会话共存。
- 第一部手机交付后经过 407 秒再终止并重启 App，回到 GRANTED/Shell。
  Actor、Station、device、Session 和认证 generation 均保持；
  新路线证明的期限晚于当前时间和原证明期限。
- 第一部手机在 Me 页面执行 `Sign Out` → `Log Out` 后，原生 Session
  absent，界面回到登录入口；第二部手机保持原 Session 和 GRANTED/Shell，
  Desktop 的已认证设备查询仍成功。
- 第二部手机的过期重启及重新登录后定向撤销：待本轮后续结果写入。

本轮升级前的试验存储没有 source 接纳时刻，按合同拒绝旧 source。
第一部新接纳后曾保留 Station runtime failed，界面 Retry 才进入 Shell。
第二部旧 Session 未由失败的 renderer runtime 接纳，直接重扫被
`sessionScopeChanged` 拒绝；经产品界面取消并删除该设备的旧保存连接，
原生清理后新扫码直接进入 Shell。冷启动失败时的旧 Session 退出与
重接纳体验仍存在缺口；不能把上述恢复步骤计入无中断登录成功。

当前诊断目录为 `/tmp/peers-relay-msl-native-20261027/`：
`android-installed-a.json` / `android-installed-b.json` 绑定安装摘要，
`gui-fresh-claim-b.json`、`gui-recovered-a.json`、`gui-admitted-b.json`
记录界面与 scope 摘要，`coexist-result.json`、`expired-restart-a-result.json`
及 `logout-isolation-result.json` 记录限定断言。二维码、密钥、bearer、
安全存储和原始运行材料留在工作区外，不进入 Git。

五客户端 Suite 仅完成复用合同审查，runtime NOT_RUN；正式 Evidence Store
没有本次 acceptance-plan/run。实施计划、源码测试和 Development 记录
均不能替代 MSL-A01—MSL-A09 的正式业务证据。

取消恢复保留原请求的 opaque lookup，失败后不丢失。Station 仅在原 Actor、
Session、设备签名与请求摘要匹配时返回终态元数据；已过期记录先在事务内
终止并提交，摘要冲突不给恢复身份。普通 Create/扫码的签名与有效期验证
保持独立，取消恢复不产生可用登录材料。
旧 JWT 不可用的回收保持 pending，只阻塞原授权 scope；单项失败
仍尝试释放后续可清理项。新 Session 的发码由自身认证决定，
Station 事务可清理已证明失效的原 Session offer，不恢复旧授权。
未知结果最多保留 32 个 retired Flow，达到上限仍显式拒绝新分配。

独立分组与跨组代码审查覆盖原生、Station、Schema 和返回值/生命周期边界。
源码审查、指纹和构建日志保存在本工作区外的
`/tmp/peers-relay-msl-review-20261027/` 及
`/tmp/peers-relay-msl-*.log`；这些是 Development 诊断，不是正式证据。
最终完整 source snapshot 与 outcome 文件摘要由该目录的
`source-snapshot.json`、`verification-summary.json` 引用。

## 未证实的产品范围

正式 MSL-A01—MSL-A09 继续 UNPROVEN，当前未覆盖：

- Android/iOS 相机读取真实 Desktop 屏幕码，包括权限拒绝、后台释放和扫码测量。
- Direct/Circuit 与多 Relay 现场可达性、失败迁移及真实业务请求。
- 非当前 allowlist 策略的 policy gate 显示/提交、Mobile PIN 和消息双向
  可见/可解密；Shell 仅有上述 Development 观察。
- 多个 Desktop 共存、独立 inbox、完整 Session 轮换和设备证书撤销。
- 真实 PG 并发事务、重启、丢失 claim/approval/ack 和安全存储故障恢复。
- 原生窄屏、键盘/读屏、字体放大、暗色及性能采样。

现场资源核查发现一台已配对可用 iPhone；未对该 iPhone 安装或启动本需求 App。
Android SDK 位于 `/opt/homebrew/share/android-commandlinetools/`，包含 Emulator、
API 35 system image 和 NDK；Emulator 提供虚拟场景 poster 图片输入选项。
Android 本需求 App 已执行虚拟相机扫码、Desktop 界面批准与账号接纳；
物理摄像头拍摄真实屏幕的光学链路尚未执行。

## 运行边界与清理

当前工作区已按用户授权选择 `one` Profile。机器控制面确认 remote
Station、`station-1` 部署绑定、slot 18，以及 `station.connect` /
`station.deploy` 能力；Profile 定义为 tracked-clean。
用户已授权本地 checkpoint 和继续实测，Station 当前 live build 已核对。
当前 APK、Desktop 与 Station 的身份和源码等价范围如上；修改源码后应重新绑定
构建身份，并按受影响 owner 重建/部署，不继承本轮前置步骤的结果。
本轮仅验证上述限定 Development Journey，不声明完整产品验收。

Desktop、两部 Android Emulator、Appium 和任务日志侦听仍用于本轮后续检查；
结束后需按 owner 释放并写入清理结果。保留任务专属 AVD 和构建缓存供复用。
远端 Station 保持本次已核对的部署；不删除账户数据库、安全存储或证据。
Xcode 构建已退出。独立图片探针已终止，三个本任务 Simulator 已关闭并删除；
没有启动 `Peers.app`、占用真实相机或修改既有模拟器。
本地 checkpoint 已获授权；无协作分支 push、PR、merge 或发布。
