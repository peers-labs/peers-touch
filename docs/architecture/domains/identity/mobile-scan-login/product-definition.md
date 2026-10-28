# Mobile Scan Login — Product Definition

> **Status**: accepted
> **Version**: v1.0
> **Created**: 2026-10-27 | **Updated**: 2026-10-27
> **Owner**: Identity and Access

产品承诺：已登录电脑的用户，用手机扫一扫即可自动接入同一站点，授权后使用同一
账号，不必输入Station地址、Relay参数、账号或密码。

目标用户是有一台已解锁、可信Desktop的新Mobile用户或重登用户。
没有已登录Desktop的用户继续使用原登录方式。扫码不提供账号创建、站点管理、
任意网络穿透或全历史恢复。

## 能力范围

- `MSL-C01 required`：Mobile无需手输站点即可验证并连接目标Station。
- `MSL-C02 required`：Desktop明确批准一台新设备，Mobile建立独立账号会话，
  同账号允许多台手机分别授权并同时在线，Desktop及已有手机保持有效。
- `MSL-C03 required`：身份连续且新消息可用，设备可从原管理入口独立撤销，
  不影响其他已授权设备。
- `MSL-C04 required`：过期、取消、抢扫、不可达、存储失败均可理解和恢复。
- `MSL-C05 required`：同网络Direct与异网络Circuit保持相同账号结果；
  Circuit仅在Station已有可用且允许新设备的Relay时宣称支持。
- `MSL-C06 optional-advertised`：系统相机/通用扫码唤起App；
  需要分别验证Android/iOS OS link能力。App内扫一扫是必需入口。
- `MSL-C07 degraded`：暂无可达路线，提示同网络重试或管理员配置连接。
- `MSL-C08 deferred`：旧消息、群组密钥与私密历史完整迁移。

## 当前基础与闭合缺口

连接材料、signed discovery、Access、设备证书、Session、安全存储已有源码基础；
还没有连接这些基础的Device Link、原生QR解码和Schema组件；现行Session按
client class唯一，还需由其owner修订为按设备并发，不能只改扫码UI。
每个required能力的实际闭环与证据要求在
[acceptance-matrix.md](./acceptance-matrix.md)，当前全为UNPROVEN。

Browser仅用于Schema码图与交互预览，不宣称Native登录或扫码可用。
用户已授权源码审查通过后实现；UI 工艺与 Native Journey 必须独立验证。
