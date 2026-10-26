# Schema — Design

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-27 | **Updated**: 2026-10-27
> **Owner**: Shared Client Interaction

## 1. 组件边界

Schema有三个独立职责：

- Link codec：传统HTTPS URL、现有Peers链接、typed Peers action的构造与严格解析。
- QR codec：将**已经由owner生成**的payload编码为标准QR矩阵，输出尺寸/密度信息。
- QR presentation：用同一矩阵生成classic/peers码图、头像与可访问控件。

Schema不能请求grant、签发offer、联网发现Station、保存Session、批准设备。
业务owner通过生成的typed合同注入连接/登录材料；网络“注入算法”的业务决定归
Node Connectivity与Device Link，Schema只控制最终载荷与可扫描表示。

当前Client/Station关系保持上游[运行拓扑](../../runtime-topology.svg)。
Schema属于Client共享能力，不增加运行时节点或将Model变为中间层。

## 2. 候选公开API

`Schema.encode(input)` / `Schema.parse(value)` 返回typed link结果；
`Schema.prepareQr(input, constraints)`返回qr artifact或typed错误；
`Schema.QRCode`是React展示组件；同artifact可导出SVG/PNG。
下面为参数语义，不是已存在的SDK接口：

- `content`：`url`、registered typed action，或指定 owner 的
  `external-protocol` QR 输入；不能是任意`string + unknown`。
- `representation`：link / qr；`delivery`：inline / reference / auto。
  reference resolver由owner注入；Schema不创建短链服务。
- `style`：classic / peers；`size`、`pixelRatio`、`format`：SVG/PNG。
- `color`：auto / token / explicit；`foreground/background`、`transparent`。
- `errorCorrection`：M/Q/H；登录或头像码不能低于用途规定的安全profile。
- `quietZoneModules`：至少4；`maxVersion`、`minModulePixels`、`maxPayloadBytes`。
- `avatar`：受控asset/blob、形状circle/rounded、尺寸上限、净空；
  `fallback`为无头像。不接受组件自行fetch任意头像URL。
- `title/description`：读屏；`onError`：结构化原因；
  `diagnostics`：version/modules/bytes/ECC/fallback，不能回传秘密payload。

`scene/page`的可取之处是payload与目标分离，`width/color`的可取之处是显式外观；
取舍与证据见[参考资料](../../domains/identity/mobile-scan-login/benchmark-disposition.md)。

安全核对现有 `peers-touch:safety/v1?...` 与外部频道 provider 载荷属于
presentation-only 协议，由各自 owner 校验并提供原始字节。Schema 可生成其码图，
不得自动打开、登录或执行；不会将它们重编码成 Device Link 或通用导航外壳。

## 3. Peers风格

底层仍是标准QR，系统相机/标准decoder可以识别；不自造微信圆形私有码算法。
采用受限圆角数据模块、清楚的三个定位区、单一深色品牌色、稳定亮底，
中心头像小而有净空，码外围可显示账户名与Station友好名。

定位、timing、alignment、format/version功能模块必须完整保留；主题不得任意
绘制网络拓扑或裁掉角点。Avatar覆盖功能模块则缩小/移位或取消avatar；
不能凭“ECC H有30%”宣称中心30%面积可遮挡。

不设置装饰性gradient、呼吸动画、随机外围点或颜色变换；
dark UI仍使用可扫描亮底码。头像未加载不阻止出码；payload和事务期限不随外观改变。

## 4. 密度与质量

先序列化业务材料，使用实际encoder计算版本，不能按JSON字符估计容量。
模块数为`21 + 4 × (version - 1)`；含quiet zone尺寸为
`(modules + 8) × modulePixels`。SVG也必须按**显示尺寸**满足密度预算。

候选展示profile：默认320CSS px、最少3CSS px/module、四边4modules；
标准码ECC Q、头像码ECC H；头像边长起始上限为symbol边长12%。
这些是待真机校准的预算，不是安全证明。完整offer超预算优先owner提供的短引用；
再去头像、增大允许显示尺寸；仍不满足则报PAYLOAD_TOO_DENSE。
不能降低最低ECC、裁quiet zone、缩模块或伪造“扫码可用”。

二维码render使用单一`qr-code-styling` SDK，classic也走同一个引擎；
Schema封装功能模块保护/密度校验和avatar降级。若SDK不能安全保留功能模块，
Peers风格在该profile降级为标准码，不能靠页面手工挖空矩阵。
不维护自己的Reed–Solomon、mask或finder算法。

## 5. 生命周期、错误与验收

component只持有展示状态；业务runtime持有有效期、取消和授权。
新payload取代旧payload时旧render任务失效；卸载释放blob URL、图片与worker，
倒计时不触发重新编码。敏感码不进入全局LRU、截图历史或localStorage。

错误：INVALID_LINK、UNREGISTERED_ACTION、PAYLOAD_TOO_LARGE、
PAYLOAD_TOO_DENSE、UNSAFE_STYLE、AVATAR_UNAVAILABLE、BACKGROUND_UNKNOWN。
avatar问题可降级；安全/长度失败不可静默改内容。

所有消费者验证encode→decode字节相同；classic/peers/头像/无头像/深色背景、
高DPI和长载荷分别测试。独立decoder与Android/iOS真机必需；
算法库build通过或SVG好看不能证明可扫描性。
