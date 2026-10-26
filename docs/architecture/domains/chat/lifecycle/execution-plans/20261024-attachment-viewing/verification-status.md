# 文件预览实施与验证状态

本轮按用户指令限定为：消息状态行布局修复与文件预览验证，通过后提交 PR。
源码 `d2e1a7521` 的 macOS Native 文件预览功能检查为 `PASS_LOCAL_FIXTURE`。
合并最新 master 后的 Native 复验为 `UNPROVEN`：后台测试窗口被完全遮挡时，
WebKit 暂停绘制帧，PDF 无法完成该环境中的像素检查。当前 PR 保持草稿。
完整原计划双方传输、系统文件动作与 Mobile Native 仍为 `UNPROVEN`。

实际截图与逐项结果：

- `deliverables/chat-attachment-preview/repair-verification-20261025/review.html`
- `deliverables/chat-attachment-preview/repair-verification-20261025/result.json`
- `deliverables/chat-attachment-preview/repair-verification-20261025/source.json`

## 已实现

Desktop/Mobile 共用一个 selected-resource 预览入口；Messaging Runtime 拥有
选择、文件访问和传输生命周期；Native 拥有完整性检查、路径与 revocable grant。
没有建立第二套传输或权限所有者。

PDF 页码在实际 render promise 完成后发布，canvas 受 4 megapixel 预算约束；
width/page/actual 模式与单一滚动区分离，加载超时明确降级。
Word 保留本地 SDK 样式和页面尺寸，字体排除策略下把 Symbol 项目符号转换为
Unicode；固定页面 transform 缩放避免 WebKit 小字号重排。PPT 只保留惰性
本地图片数据和 SVG fragment 引用，整页适配阅读区。Office 隔离 frame 保持
空 sandbox 与禁止网络的 CSP；尺寸变化触发重新适配，响应以 revision 阻止迟到覆盖。

工作表保留源行号、列字母、合并单元格、位置范围、数字格式和有界原始列宽。
图片始终使用同一 grant 的 Native 缩小表示，卡片文件名在自身消息背景上可读。
媒体预载首个解码样本后才发布 ready；视频画面与控制条适合预览区。
元数据显示简短文件类型，系统预览与应用内阅读入口区分。

Native 相同 window/account/PTID/JWT 的后台验证保留 activation generation；
authority 变化与重新登录仍生成新标识。授权校验没有放宽。
Desktop 原生退出在 worker 清理前撤销 grant；清理失败与 retained Engine
回归通过。Mobile 取消记录在上限处压缩至 issuance watermark，1024 次释放后
新操作可用，旧操作仍拒绝；Swift/Kotlin 源码逻辑编译检查通过。
已完成下载优先恢复 verified plaintext staging，远端不可用和 promotion 再次失败
仍保留完成记录。损坏缓存首次显式重试可直接 READY 或排队 Downloading。

正文、时间/状态、反应栏、下一条消息按此顺序排布。状态行距正文 4px，
消息之间 8px（compact 为 6px），空反应栏不挂载，失败重试允许状态行增高。
图片标签有明确对比背景并受 240px 附件宽度约束。

## 当前现场证据

源码 `d2e1a7521` 构建的 Desktop Debug Native，复用 sixwin 原有 Bob 测试身份进入 Chat。
使用精确隔离的离线消息投影夹具；文件字节、Native hash 校验与授权读取真实。
这类检查不证明文件通过 Station 收发。

14 类文件检查通过：PDF、DOCX、XLSX、PPTX、4800×3200 图片、中文/英文/emoji
文本、65 MiB DOCX、旧 XLS/PPT、4 秒 M4A、1280×720 MP4、损坏 DOCX、
横向含 BMP 的 Word 和 A2 PDF。
`d2e1a7521` 原生构建验证 14 类文件；24 张逐文件截图已按文件名、
格式、页面、实际内容与弹窗审查。另有两张消息布局截图与两张大图侧栏/弹窗截图。
消息行和 geometry 源码未变，原消息布局证据仅按这两个依赖的源码等价复用。
Word/PPT 图片与布局可见；工作表末视口为 U101:Y110；视频控制条与播放进度真实。
大 DOCX 含未使用填充，只证明该文件可预览，不能推导复杂大文档的性能。

每类均验证同一会话后台 auth validation 后原 grant 仍返回 206；
关闭后旧 grant 返回 404，重新打开显示原始文件。A2 实际尺寸保持
1191×1684 CSS 像素，raster 仍在 4 megapixel 以内，宽度模式与第二页通过。
原生消息行实测正文到状态 4px、状态到下一正文 8px，无空反应栏。
该离线夹具没有真实接收方已读事件，不据此宣称收发或已读业务通过。
12 MiB PNG 在详情侧栏使用同一 grant 的 1600px 表示，实际内容和弹窗截图通过。
原生 logout 后旧 asset 返回 404；恢复原测试身份成功。该项不证明系统导出面板。

本轮使用 1200×769 WebView；实际暗色 Native 主题、最小移动设备、
最新候选窄窗口与任意复杂文档仍未证明。

## 可复用检查与源码证据

Chat 文件夹具使用 python-docx、openpyxl、python-pptx 与 Pillow 生成真实
图文、表格、分页、多工作表和高分辨率文件；媒体使用真实 ffmpeg。
Office/PDF 的 macOS 像素 oracle 截取实际阅读区域并核对内容，避免依赖
WKWebView 不可访问的隔离 frame 或仅检查 decoder 节点。截图和 OCR 记录在
Suite 清理前通过既有 evidence owner 保存。正式 Gate 本轮未运行。

像素证据分别绑定实际弹窗标题、内容、页码与捕获前后选择；
独立回归拒绝错误文件、捕获中换页和空白内容。逐个源码路径选择专用 Gate，
避免聚合路径掩盖遗漏；保存的 JSON 和图像链接通过夹具删除后验证。
共享预览回归使用真实 PDF.js worker 处理 9 MiB 合并需求，保留单回调契约；
改名 ZIP 使用 archive admission，文本分页保留内部 FEFF。
Native 7 项图像回归覆盖撤销、编码输入、RGBA16、渐进 JPEG、WebP、
EXIF 旋转/镜像和缩图内容。

共享 TypeScript、Desktop/Mobile TypeScript 与当前 Native Vite/Cargo 构建通过。
Chat 夹具 OOXML/XML 有效，相关 Python 模块编译检查通过。
Office preview 的当前源码结构审查无阻断；完整范围的功能结论由上述现场证据支撑，
不能从单文件结构结果推导整体代码通过。

源码清单标识：
`attachment-source-files-sha256:86b87dd508c153d306644a912a97c0d4732ee8172bfa6775ec122bd6b5176266`。
该清单逐项记录当前任务源码和配置；证据保留 Native binary SHA-256、Git HEAD
及每张截图摘要。历史批次未被升级为当前证明。

## 当前 master 集成范围

已合入 `b8c5414f0`。注册表在同一身份写锁内同时维护文件 activation 与 Search
publication revision；同一 account/PTID/JWT 后台校验不失效，真实身份变更使
读请求失效。原文件授权测试和 master Search revision 测试均保留，9 项通过。
Mobile 保留统一搜索入口并挂载文件阅读 host，Chat/Search 双语资源同时加载；
原型保留统一搜索和 canonical self identity。

当前 Desktop/Mobile TypeScript、Mobile Rust、文件格式回归、35 项文件/像素
契约测试和 38 项 Desktop 消息服务测试通过。Desktop 实际 Engine 的损坏缓存
首次重试及 retained Engine 退出撤销回归通过。101 个 authored 文件的完整结构
审查无阻断，strict review framework 通过。

master 的 Native 启动输入策略保留。测试中前台进程没有改变，输入焦点未被
抢占；完全遮挡窗口的 WebKit document visibility 为 hidden，PDF render
等待绘制帧。此环境观察由 Native 验证环境负责，不能改写为当前候选预览通过。
上述 14 类文件证据仍绑定原源码，不提升为集成后全客户端或传输 Acceptance。

远端 Station 仅文件/认证接口源码与预览基线等价；Search/X-config 变更没有
随本轮预览部署到远端，因此完整 Station source equivalence 为 `UNPROVEN`。

## 原型与清理

Mobile 原型缩放、翻页和关闭按钮卸载已在现有 Portal 观察。
Desktop/Mobile 设计样本补上缩放及行列导航；Desktop 原型交互尚未单独运行。
整包原型 TypeScript 受现有共享依赖解析与 ContactsBook 类型错误影响，
未报告为通过。缩放后 Escape 行为仍未证明。

任务 Native、WebDriver、renderer 已退出，4722/5230/5410 均释放；
离线消息和精确文件缓存已删除，原身份和密钥保留。
Portal 3200 按用户约定保留。未创建或切换 worktree、修改 env、
部署或发布。用户已授权提交 PR；提交与流水线结果由交付记录单独说明。

## 提交检查

完整提交流水线在 539.634 秒内结束，29 个 CI Gate 中 18 个通过、11 个失败。
缺失完整 Station/Relay/跨平台证据的聚合 Gate 保持 UNPROVEN；存量 storage、
Mobile identity、provisioning 与 reset 检查仍有缺口。
本次变更对应的 Messaging owner、文件访问、消息排序和 Native Driver 边界
检查已修复，当前 86 项聚焦契约检查通过，完整源码结构审查无剩余阻断。
完整流水线没有被报告为通过，交付使用列出上述缺口的草稿 PR。
