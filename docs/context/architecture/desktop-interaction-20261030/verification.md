# 原生诊断与验收

状态：以下均为待执行验证合同，没有 native PASS。corpdebug 已绑定但未部署。

## 环境及执行原则

主运行单元是当前 peers-android build 的 `desktop-macos-native`，后端仅 corpdebug。
启动、原生窗口、Station binding、actor/session 和源码版本必须相互吻合。
先准备日志与监控点，再由 Agent 主动操作真实产品 Journey。

Browser shell、直接调 store/harness、数据库读回分别只能证明其自身层次。
Social 媒体验收必须经过真实 picker、Composer、发布、刷新和第二账号读取；
不能用绕过 UI 的明文 harness action 代替用户路径。

媒体、互动、头像所需发送者/接收者账号和 runtime 在同一 Suite 中复用，
scenario attach-only；不每项重建账户、设备密钥、进程或登录。
当前只主张 Desktop 范围。协议生成、共享核心变更需跑受影响编译和既有合同回归；
跨 Station、Android、iOS 的未运行 cell 保持 `UNPROVEN`。

## 观察点与关联

Search：query intent generation、mode/filter、admission timestamp、各来源 start/complete/cancel、
query/hydrate 次数、cache reuse、source/policy revision、coverage、displayed query、viewport、Open/Return。
不得记录私密 query/结果明文来替代用户证据。

Media：picker intent、每个选中文件的精确 preview grant、验证、实际上传 bytes/progress、CID/MIME、
Post commit/readback、public resolver 或 private grant、下载/解密/decoder、typed error stage。
不打印密钥/token 或用户完整 home 路径。

Moments：event/reconcile reason、scope、first window/tail、资源 content/interaction revision、
单卡片 render/mount/unmount、textarea focus/selection、media src/grant 和 paint mutation。
重复无变更事件与真实变更必须可区别。

Identity：认证 edge、current binding、profile sync、account projection、canonical avatar identity、
local path、asset resolution、decode、entry readiness、first painted avatar。记录 opaque asset ID。
连续帧和 DOM `complete/naturalWidth` 同时确认图片，不能只看 img src 非空。

## 诊断门

**DIAG-MEDIA**：真实选择 PNG/JPEG → 预览 → PUBLIC 发布 → 检查上传 object MIME/bytes/hash →
解码并由第二账号读取；再独立走 PRIVATE → grant → 解密读取。
明确区分文件 scope 403、错误编码、OSS/配额/网络和私密授权。已知源码错配修正后仍需证明实际失败消失。

**DIAG-FLASH**：保留多个已分页帖子与一个输入中的评论，覆盖两个 45s reconcile，
同时采集 native frames、mount 次数、projection changes、tail IDs、grant/src 与 paint mutation。
只有观察到具体状态替换和可见闪动的时间对应才归因；React rerender 本身不是闪动证据。

**DIAG-AVATAR**：空 cache OAuth 登录、命中 cache 的 password/PIN、同 actor profile 更新、
不同 actor 切换、renderer reload；对齐 edge、profile/path、decode、ready/paint。
没有 profile 与 decoder 时间戳不能宣称 OAuth 服务未及时返回头像。

## 业务 Journeys

### J01 找回和复制

从 Chat 打开 Search，逐字输入但无需按 Enter：200ms stable 后 FIND 启动，已完成来源先发布 progressive frame，
全部来源完成/失败/到 5s deadline 后发布最终 RRF frame；当前 Station 公开 Post/Comment 与已获得且当前可读的私密 Social
在同一 intent 的不同来源 frame 内补齐。大小写变体命中相同 ResourceKey 集合；中文 IME composition 不提交半成品 query。
快速输入、退格、清空、切 filter 时每个 stable draft 每来源最多一个 operation，旧请求取消且旧结果不覆盖新 intent。
Progressive frame 无分页、不入 reusable cache；最终 frame 后翻页，后到来源不改变已选 ResourceKey 的身份和 viewport anchor。
progressive 阶段按 Enter 不另发 query，只等待同一 request 的 final frame。

结果片段可鼠标拖选并 ⌘/Ctrl+C，不跳转；无输入选区时 ⌘/Ctrl+C 复制 active row；
Tab 可到达 labelled copy button；右键复制不跳转。ArrowDown/roving focus、Enter 打开原资源和历史评论，
第一行 ArrowUp 或可打印字符回到 input 且继续更新 draft；Back/Return 恢复 query、filter、active row 和 viewport。
`?` 支持 hover、click、Tab/Enter/Esc，展示真实 coverage、当前 Station 实时检索和私密逐次核权说明。
离线、timeout、source change、退出、换账号、删帖/Block 后遮蔽旧结果并拒绝旧 Open/复制。

### J02 图片完整生命周期

取消 picker 后再选；选择 1 张和多张，删除其中一张，失败重试，窄窗口 preview/control 均可见。
有效 PNG/JPEG/GIF/WebP 必须预览 HTTP 200 并实际解码；HEIC 只有在原生转码/解码支持时接受。
每个选中文件精确授权，未选邻近文件返回 403。

PUBLIC 发布后检查对象为明文图片 MIME，payload 不含 AES descriptor；
作者和第二账号在 feed/detail/lightbox 看到相同图，重载/重启仍可读。
PRIVATE 仅受众账号可读，非受众、错误/过期 grant 拒绝；中断下载可重试，撤权/删除清理展示和能力。
失败保留文字、audience、成功附件与失败附件；没有确认 commit 不显示发布成功。
真实 Composer 路径与 harness 断言均调用明文 PUBLIC 上传，加密 social 命令无生产调用。

### J03 反应和评论

选 LIKE 后 picker 仍可打开，再选 LOVE 后 LIKE 保留；逐项取消，chip 计数只属于对应 kind。
连续点击、超时、未知提交、重连和第二账号观察都收敛；pending 只禁用对应 kind。
公开 Add/Delete 重试不产生重复反应；客户端 operation id 只做 fence，不要求服务端 exact replay。

评论输入 `@` 后，键盘上下/Enter 与鼠标可选择真实 actor；IME candidate Enter 不误提交。
提交后 readback 保留 PTID、display 和正确 UTF-16 ranges；重名不靠显示名猜身份。
草稿内编辑/删除文本正确调整或移除 mention；裸 `@文本` 是普通文本；已发布评论编辑不在本次范围。
被 mention 且可读父帖的接收者收到 notification Center 的 `CategorySocial` 通知并可跳到原评论；
公开通知含允许摘要，私密通知静态数据只含 IDs，无权读父帖的人不收到标题、正文或摘要。
软删除评论不再触发通知或搜索。PUBLIC 与 PRIVATE 语义一致。
失败保留 text/mentions/reply，committed-pending-readback 不重复发送。
Shift+Enter 换行；Post 按钮位于输入框边界内；Back 属于线程卡片头部；详情无无用途 Open/comment 控件。

### J04 稳定阅读

home 与 explore 首页各分页至少两页，展开长文并输入未提交评论。周期 reconcile、同帖 reaction/comment event、
重复 event 和后台恢复后保留两个 feed 的 tail、scroll anchor、展开状态、输入选区和已解码媒体。
未变化卡片 remount=0、媒体 src/grant 不变；reaction 变空正确归零；新内容按权威顺序进入 first window。
权限撤销/真实删除立即遮蔽，tail verification 有界完成。当前页与 hidden Social 的 render 成本分别采样。

### J05 登录与头像

OAuth 空 cache 首次登录在 pending completion 内完成 profile、account cache、local avatar materialize
和 decode；进入业务 Shell 第一帧就是照片或确定无头像，不出现字母→照片。
生产密码登录必须经 Identity Runtime fresh edge，只等待登录响应中的 local path decode，不等待额外网络。
取消/失败 OAuth 不创建错误会话。PIN set/skip/relink、PIN unlock、account switch、
logout/relogin、冷启动和 renderer reload 分别按 edge matrix 验证。

同一 actor 的 Shell、账号选择器、Profile 使用同一 canonical identity；
新 actor 不显示旧 actor 图片，迟到 profile/asset 响应被 epoch fence 丢弃。
下载/解码失败显示可观察 degraded，恢复网络后可重试，不被永久 null cache 封死。
applet launch 不等待头像。same-URL 换图只有在 profile revision 可区分时声称生效。

## 预算及质量判定

以下为提议 Gate 目标，执行前在 corpdebug 实测校准：

- Search stable admission 200ms；progressive local frame 从输入停顿到可读结果 P95 ≤300ms。Station 来源记录 P50/P95/P99；
  最终 frame 保持 5s deadline 和最后 100ms 发布储备，慢源不得重排已提交的打开动作。
- 一段 10 个 stable drafts 的打字轨迹中，每个 draft 每来源至多一个 operation；退格取消不产生迟到发布。
  未到期 no-store lease 不因 2s focus/reconcile 重读；无事件公开源最长陈旧窗口等于 cursor TTL。
- fresh OAuth/completed entry asset 准备 P95 ≤2s；fresh password 本地 decode ≤250ms；restore/PIN/switch 本地 decode ≤250ms。
- 成功 fresh login 零字母→照片中间帧；新 actor 零旧头像帧；degraded 路径必须可观察。
- 一次等价 reconcile：可见卡片 remount=0、稳定媒体 src 变化=0、输入/viewport 丢失=0。
- 20/100/200 帖数据规模下，单 interaction 不产生 >50ms 主线程长任务；hidden Social 不随无关投影重绘。
- native 单动作 wait/capture 最多 30s；媒体传输单对象最多 60s；稳定性采样 110s，含清理的 scenario 最多 150s。

UI 正向校准是选图即时本地预览、完整原帖/评论内容、常驻 reaction picker、一体 composer 和连续身份；
负向校准是 Enter 才召回、重复 tips、无法复制、表情入口消失、输入外按钮、错误媒体和身份闪动。
遵循 quiet UI tokens，验证 narrow/localization expansion/keyboard/focus/reduced-motion。

## 完成及清理

业务 PASS 需要所选 Journey 的当前源码 native sender/receiver、immutable frames、关联状态
和正常/失败/恢复证据齐全。任何 diagnostic gate 未归因或所选 Journey 未跑均保持 UNPROVEN。
停止任务拥有的进程、订阅和录制器，释放 fixtures/grants/temp files；
保留用户授权保持的 corpdebug 数据和证据，不影响 corpstable。
用户亲自测试前不创建 MR；应用代码不提交、不推送。
