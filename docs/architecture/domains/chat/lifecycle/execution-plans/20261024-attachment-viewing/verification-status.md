# 文件查看实施与验证状态

目标为 `attachment-viewing.md` 中双方文件查看、恢复及 Native 副本使用。
当前处于 Development iteration；尚未进入产品闭环或交付。

## 已落地的路径

双方文件卡片选择立即进入详情，原始名称、大小和类型先于异步读取显示。
Messaging Runtime 拥有单次读取、下载观察、取消重试和 scope 失效；页面只订阅和派发。
Native 提供独立 opaque grant、受控 Range 字节读取及完整性验证。
旧 `messaging_open_attachment` 和 UI `window.open` 文件消费入口已移除。

共享预览器按选择挂载。PDF.js worker 按需加载，单页画布有像素上限；文本和图片
有字节上限。关闭、格式变更和 PDF 加载/渲染失败都释放资源，异常不移除详情操作。
Desktop 保存直接从 grant 取得安全文件名，取消文件面板不会创建 handoff 副本。
iOS/Android 文件操作使用既有平台插件，独立副本保留扩展名。

## 具体检查与观察

- 双端 TypeScript 与共享包类型检查通过。
- 共享状态机九个行为检查覆盖去重、取消、scope 变化、迟到结果、关闭/重开、
  显式动作、字节上限及超过背景保留时间的选中文件。它们不证明 Native 产品操作。
- Native filesystem 六个行为检查通过，包括独立副本、保存留存、完整性拒绝、
  独立 grant、私有副本清理以及挂起/恢复后的 epoch 撤销。
- Core transfer 36 个检查通过，覆盖分块中断、完整性、取消、超时后保留屏障、
  显式重试和缓存恢复，包含 100 MiB 数据的分段恢复；不代表产品传输证明。
- 双端 Rust host 检查通过；Mobile 的 host 检查不等同于 iOS/Android 产品构建。
- 真实 headless Chrome 加载十类本地文件，观察图片尺寸、WAV/M4A 和视频解码元数据与
  controls、双页 PDF 字形/翻页、文本及 Office/压缩包/主动内容/超限文本的
  明确 fallback。损坏 PDF 后重新打开和关闭卸载通过，页面异常为零。
  音视频结果不证明播放任务。使用共享源码，无 Chat/Station/OS 文件操作；
  证据类别是共享 renderer
  `FUNCTIONAL_CHECK`，不能升级为 CHAT-J03 `ACCEPTANCE_PROOF`。
- iOS `NativeFileActions.swift` 通过 iOS 13 类型检查；插件整体及新增文件通过
  项目实际 iOS 15 target 类型检查。依赖为真实 Tauri 2.12.2 与 SwiftRs 1.0.8
  源码模块。没有构建或运行 iOS 产品。
- Mobile 原型详情保持在 390px 设备容器内，模拟下载、保存取消和 Escape
  卸载已观察。真实格式和 Native 动作不由原型证明。
- Chat Domain 23 个 capability 的结构校验通过；这不是各 capability 产品证明。
- 既有 rich-voice Gate 契约八项检查通过；新增 UI 路径只完成语法和契约检查，
  未运行原生 Gate。Android 目的地回调迟到时会清理新建文档，
  Kotlin 适配器已通过实际 Android 产品编译；回调行为仍未运行。
- Android arm64 Debug APK 构建通过，包内包含 `NativeFileActions`、
  `ChatFileProvider` 和 arm64 Rust 动态库。使用真实 SDK/NDK、Tauri Android
  工程及 Gradle 依赖；没有初始化覆盖已有 Android 定制工程。
  Tauri 的 tracked Manifest 生成变动已按原字节恢复，XML 语义没有改变。
- 当前 Desktop 类型检查、rich-voice 八项契约检查、九段 macOS OS 脚本语法编译
  和 Chat Domain 23 个 capability 结构校验通过。脚本语法不证明 OS 动作。

本轮局部源码与编译证据为 `/tmp/pt-attachment-checks/native-file-progress.json`，
sourceIdentity 为
`attachment-source-files-sha256:34bfd1dd0b9e1be53ff709736b1da82713fb292a6420738674abadb17177dbce`。
它标识 84 个列出的任务源码/配置输入，包含新业务 oracle 和 grant observation。
Android 构建日志及结果为 `/tmp/pt-attachment-checks/android-current-ranlib/`；
APK 位于 `apps/mobile/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`。
这些证据不提供 Native 产品 PASS。

文件查看实施阶段的局部源码快照、执行记录和日志收集在 `/tmp/pt-attachment-checks/final-source-checks.json`，
覆盖 78 个列出的任务源码/配置文件。原有 `source-checks.json` 保留原始检查快照，
不作为当前完整源码证明。后续 Mobile 原型消息布局与文件焦点修正改变了源码，
上述快照不能提升为当前整个任务的 PASS；新证据仅证明
[原型阅读布局与模拟交互](../../prototype/README.md)，Native 结论不变。

已做 Engine/filesystem、Mobile OS、frontend 和业务 Gate 分组源码阅读及跨组复审；
最终复审的三个具体问题均为 source-resolved，该有界范围没有剩余 P0-P2。
报告位于 `/tmp/pt-attachment-checks/review/`。这不是全 workspace 的正式结构决策、
产品证明或合并判断。Gap Detector 因专用 evidence root 缺少
Acceptance plan/run pointer 拒绝判定；上面的人工逐断言缺口仍为当前结论，
不能将检测工具未运行作为通过。

## Acceptance 注入与缺口

Mode 为 `UPGRADE`，沿用 `chat-rich-media-recorded-voice` Feature/Capability、
`chat` Domain 和 `chat-lifecycle-rich-voice-e2e` Gate。Truth owner 为双方
Device Messaging Engine；receiver 为真实客户端中的 sender/receiver。
Feature、Capability 和 Registry 已关联新增文件路径。新增 Gate 组合属于
Chat business injection，没有修改 Acceptance Infra 或证明语义。

`lifecycle_file_viewing.py` 已提供双方真实卡片选择、原始元数据、文本预览、
关闭重开和系统保存取消路径，主 Gate 使用真实 `.txt` 文件。真实 transport
中断期间经 UI 关闭/重开、取消、再次重开与显式重试的路径也已注入。它们仍未运行。
十类格式的双方真实卡片/解码/fallback 路径已经注入；M4A 的 SDK MIME 名称
`audio/m4a` / `audio/x-m4a` 在分类、asset 响应和 Android Intent 适配为 `audio/mp4`。
超限文本必须观察明确
unavailable 标记并拒绝内联 decoder。语音 eviction 故障同时移除 cache 路径、
撤销实际 asset grant，并要求真实 404，随后只通过可见 retry 控件恢复。
这些业务路径尚未在 Native Chat 运行。

`lifecycle_file_native.py` 已接入双方 macOS 三项业务 oracle：从真实详情动作打开
Quick Look，绑定新私有副本、进程、窗口与 PDF 内容；从真实外部打开进入系统
默认 TextEdit，观察同名文档后由外部应用修改并保存副本，检查 cache 未变；
使用真实目的地面板导出，再注入精确 cache eviction，检查导出留存及可见预览恢复。
外部编辑当前要求默认文本应用为 TextEdit；其他应用不改变系统默认配置来冒充验证。
OS 截图在 Fixture 回收前通过既有 Evidence owner 保存，清理限定到动作所属副本、
Quick Look 子进程和外部文档。这三项路径尚未执行。

关闭详情和离开 Chat 的 scope 路径也已接入。Acceptance Harness 只观察当前详情
已经持有的 grant，不创建、更新或释放 grant；真实 UI transition 后要求旧资源
返回 404，重放三种 Native intent 均拒绝且不新增 OS 资源。
切换 conversation、account、Station 的业务路径仍未注入。
`rich_file_scope_fencing` 保持 mandatory 且没有由局部边界代为发出 PASS；
其他三项 Native assertions 同样必须实际运行。

每个 Native runtime cell 当前都是 `UNPROVEN`；macOS Development Journey
为环境 `BLOCKED`，不是产品失败。iOS、Android、Windows、Linux 和跨 Station
没有本任务运行证据；不能继承历史同 Station iOS 结果。

## Runtime 资源与阻塞

当前分支为 `feat/chat-attachment-viewing`，HEAD 为
`3424bcbe0883dd826675290970652b7c6e16bd90`。已通过标准 `make env-update` 修正绑定。
`make env-check`、`make config` 与远端 Station health 检查通过；
按用户指定执行 `make profile sixwin`，reviewed Profile 为 `sixwin`、slot 为 22、
capability 为 `station.connect` 与 `station.deploy`。`three` 属于 Android worktree，
本任务不使用。没有修改环境仓库。
机器资源登记中只有当前 worktree 对 sixwin 的有效登记，另有路径已不存在的
历史登记；没有活动 lease。标准部署前建立仅含任务文件的本地 checkpoint，
使 Windows Station source sync 获得当前附件契约和客户端一致的 Git 快照。
该 checkpoint 不表示产品验收或交付。

已通过 canonical `acceptance-run.py --execution-policy development --work-item
attachment-viewing --gate chat-lifecycle-rich-voice-e2e --runtime-cell desktop-macos-native`
执行有界 Development 准入。项目声明的 Python 依赖位于任务专用外部环境。
本次首个观测阻塞为 `source-identity:station-four:commit`：
`station-four` build `100b42e720285f9eea6fea7293da4f528976eec8`
与当前 client HEAD 不匹配。产品步骤未执行，客户端未分配，provisioner cleanup
为 passed。证据在 `/tmp/pt-attachment-checks/native-development-dependencies-ready/`，
canonical Development artifact 在
`~/.peers-touch/dev/workspaces/fa00849b96554f2c/workflow/attachment-viewing/artifacts/`。

源码事实中另有未满足的准入：工作区含任务改动及用户无关未跟踪资料，
`desktop-macos-native` 要求完整 clean source；没有验证 `isolated-gui-session`。
本次尚未走到这两项的执行检查。没有修改准入条件或使用旧 Station
结果冒充当前源码证明。实施和验证均限定在当前
`feat/chat-attachment-viewing` worktree，不新增验证 worktree。
正式驱动要求 clean source 是源码身份约束，并不要求新建 worktree；
开发期原生功能验证、正式证明的源码快照和 GUI 资源隔离分别处理。
本地 checkpoint 不得包含用户无关资料，也不能通过移动或提交这些资料制造 clean。

现有 `native-tauri-embedded-webdriver` 环境契约要求 `station-four` 与 `station-five`
两个独立 service attestation；当前 `sixwin` Profile 并未令这两个服务自动变为
当前源码。后续供应需由既有 Runtime owner 明确这套拓扑与 reviewed Profile 的映射，
复用双方隔离账户/客户端及固定 Fixture Epoch；不修改环境契约来跳过一个服务。
系统面板输入要求 `isolated-gui-session`。
构建、登录、两客户端及 Station attestation 属于 Suite owner；各场景 attach-only。
预算沿用 CAV-03：functional 1800 秒、cleanup 180 秒，不自动延长或扩大 Gate。

Android SDK binding 已确认，Tauri build 已生成实际 Gradle/Tauri source bindings。
Android 编译为 `PASS`，产品运行仍为 `UNPROVEN`；adb 当前无连接设备。
没有使用 stub 或另一 worktree 的构建。

独立 renderer 检查的 headless 浏览器和端口 3212 已由 helper 收回。
Prototype Portal 3200 已为当前分支的消息布局查看重新启动，仅提供 mock 原型；
独立 renderer 端口 3212 已停止。浏览器矩阵的各个 headless browser 均已关闭。
本任务新建的两个 package `target/` 在确认无打开进程后清除，保留现有客户端
build 缓存及外部验证日志；没有删除用户保存文件、用户数据或其他任务资料。
本次传输和文件系统检查复用已有 Desktop target；没有新增独立 package target。
任务专用 Python 依赖环境、外部检查日志和 Debug APK 保留用于继续验证，没有运行
Python/Native 客户端进程。发现的既有 Gradle daemon 不属于本轮，保留。
完成 Mobile 前端与 Android Debug APK 构建。sixwin 部署及运行版本核对待执行；
没有 push 到协作远端、PR 或环境仓库改动。

## 当前结论

CAV-01/CAV-02 实现主体与局部源码/renderer 检查为 `PARTIAL`；
CAV-03 已补三项系统文件 oracle 与两项局部 scope 边界，Native 产品运行因
Station source mismatch 为 `BLOCKED`；完整 scope 注入仍未完成。
完整文件查看、外部打开和保存结果为 `UNPROVEN`，不满足交付条件。
