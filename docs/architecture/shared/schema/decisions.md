# Schema — Decisions

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-27 | **Updated**: 2026-10-27
> **Owner**: Shared Client Interaction

## Decision Index

| ID | Decision | Status |
|---|---|---|
| SCH-D01 | DeepURL、Link 和 QR 收敛同一共享能力 | accepted |
| SCH-D02 | 标准 QR 加受限 Peers 表达 | accepted |
| SCH-D03 | 外观不能削弱协议 | accepted |
| SCH-D04 | 引用归业务与网络 owner | accepted |

## SCH-D01：DeepURL、Link和QR收敛一个能力

**Status**: accepted
**Date**: 2026-10-27

### Context

当前导航、连接外壳和码图分别由多个 helper 与消费者处理，输入规则容易漂移。

### Decision

使用一个 registry、strict codec 和 encoder，保留存量链接的业务语义。
Rust/TS 由同一 proto 和同一测试向量约束，移除重复 helper。

### Rationale

统一恶意输入边界、错误分类、标准扫描与展示质量，调用者只分派自己拥有的 kind。

### Alternatives Considered

拒绝页面专用二维码、runtime 下载 schema 和可执行的任意 action 注册。

### Consequences

注册动作需要集中维护；Schema 不得签发登录材料、联网发现或执行业务副作用。

## SCH-D02：标准QR加受限Peers表达

**Status**: accepted
**Date**: 2026-10-27

### Context

品牌样式和头像需要保留标准解码能力，功能区域不能按普通数据模块装饰。

### Decision

classic 与 peers 使用 MIT 的 `qrcode-generator` 1.5.2公开API作为唯一标准编码引擎。
Schema自行生成SVG/PNG并保护定位、timing、alignment、format/version功能模块；
需要Alphanumeric压缩时使用公开分段API，不访问私有矩阵状态。

### Rationale

复用成熟编码和纠错算法，保持标准扫描兼容性及低维护成本。

### Alternatives Considered

拒绝私有码制、绘画假码、两套 encoder、手写纠错或通过 ECC 百分比推导头像面积。

### Consequences

不保留装饰型QR SDK的私有适配层。编码库版本升级需要独立解码、分段编码与功能区验证；
样式和头像的降级不能改变载荷内容。

## SCH-D03：外观不能削弱协议

**Status**: accepted
**Date**: 2026-10-27

### Context

显示尺寸、长载荷、暗色主题和头像可能令视觉上完整的二维码无法扫描。

### Decision

profile 强制 quiet zone、最低 ECC、显示模块密度和功能区完整性。
按实际显示尺寸计算预算，头像必须由受控 bitmap 提供且避免功能区域。

### Rationale

可扫描质量由同一组件保证，不能依赖每个页面单独设置参数。

### Alternatives Considered

拒绝任意遮挡、未知透明背景、裁 quiet zone 和通过缩模块容纳长载荷。

### Consequences

部分外观请求会被拒绝。密度失败交由 owner 提供短引用或扩大显示；
独立 decoder 与原生相机证据可校准预算，截图不能证明阈值。

## SCH-D04：引用归业务/网络owner

**Status**: accepted
**Date**: 2026-10-27

### Context

Device Link 的完整 Station 网络材料可能超过显示预算，并存在可达性与秘密边界。

### Decision

Schema 接受 owner 提供的已验证 inline offer 或 locator；引用取回归业务与网络 owner。

### Rationale

保持协议、网络信任和授权边界稳定，让展示能力不成为第二登录或路由控制面。

### Alternatives Considered

拒绝 Schema 默认中心短链、任意 fetch、私有登录代理和递归引用解析。

### Consequences

消费者必须提供可达的引用能力并验证真实 endpoint、Station 根身份及期限。
Schema 只编码最终载荷，不把“成功出码”声明为“可登录”。
