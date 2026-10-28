# E2E 执行前的能力复用与依赖检查

> Status: accepted
> Owner: Acceptance Infra
> Scope: Development Functional Run 与正式 Acceptance 的明确 E2E 请求

## 目标与已验证问题

同一项目周期中，Agent 不应重新研究已有登录、原生输入、异步调用和页面操作。
现有 Gate、Driver、Harness、Fixture 与预算 owner 已提供这些能力；
`acceptance-run.py` 已解析 `dependsOn` 并去重。当前 Host Hook 只注入通用上下文，
未将 E2E 意图连接到能力清单与缺口检查。临时脚本因此重复启动、重新摸索已存在的
操作，并未把增强留在原 owner。

这次增加的是项目 E2E 执行器的准备回调。IDE Hook 仍是可选的宿主适配，
不能获得运行权限，也不能阻断普通工具。`make desktop` 保持独立启动。

## 唯一来源与调用位置

Gate Catalog 声明该 Gate 的 E2E Journeys 与所复用实现的引用；源码文件、
方法和实际 Driver/Fixture 是实现来源。Catalog 不存储第二份操作脚本。
未定义产品操作的 Gate 返回业务注入缺口，不能从可见按钮或历史运行补造语义。

项目 runner 的顺序固定：

```text
明确 Gate 选择及验证模式
  -> 现有 compile_graph 解析必要依赖闭包
  -> 当前源码与 Catalog 身份
  -> E2E 准备 Hook：能力、依赖、缺口、成本和失效范围
  -> 原输入资格、Provisioner、Runtime Cell 与 Suite owner
  -> 原 Gate 的业务动作与断言
  -> 原清理、报告和证据 owner
```

Hook 必须先于构建、Fixture 重置、客户端启动及登录。它只读源码和合同，不导入
业务模块执行代码，不探测网络，不安装依赖。`--dry-run` 展示同一准备结果而不分配
运行资源。Development 与 Acceptance 共享准备逻辑，保留各自证据语义。
独立 Gate 入口也验证该准备合同；子 Gate 消费父执行器已生成的同一选择，不能扩大
作用域。该合同描述将执行什么，不是 OWNER、授权或第二条回执准入链。

## 能力与依赖

`e2e` 是 Gate 的明确声明，包含 Journey ID 和所使用实现的引用。每个引用声明
用途、生命周期、必要实现依赖和失效轴。实现引用使用仓库内源文件及稳定公开符号；
同一实现的生命周期语义不能在不同 Gate 中分叉。

当前源码检查支持公开 Python 函数、类和方法，以 `.py#Class.method` 引用；
其他语言的产品能力通过其已有 Python Gate/Driver 公开入口描述，
不从任意文本匹配推断符号。结构检查由 `validate_e2e_definition` 共享，
运行前源码观察由 `prepare_e2e` 唯一实现。引用缺失或空 Journey 不获得就绪状态。

例如，一个 Gate 的单 Journey 声明如下：

```json
{
  "e2e": {
    "journeys": [{"id": "first-message", "uses": ["path/to/gate.py#JourneyGate.run"]}],
    "implementations": [{
      "ref": "path/to/gate.py#JourneyGate.run",
      "purpose": "执行原有产品动作与接收端断言",
      "lifetime": "scenario",
      "dependsOn": [],
      "invalidatedBy": ["source", "oracle", "action-plan"]
    }]
  }
}
```

Development 依赖只接受本次结果集合中的原 `developmentManifest`，
核验 inventory、source、功能结果及 cleanup，保留 `NOT_APPLICABLE`。
正式依赖仍核验原 `runManifest` 的完整证明；两者没有互相提升通道。

Hook 逐项检查引用存在、符号存在、依赖完整、无环及生命周期方向。结果区分：

- `REUSE_IMPLEMENTATION`：源码实现可用；并不宣称设备、会话或产品证据已通过。
- `ENHANCE_REQUIRED`：实现或必要操作缺失；返回原业务/基础设施 owner 及确切引用。
- `QUALIFY_AT_OWNER`：构建、环境、Fixture、客户端和会话是否可复用，由已有 owner
  核对真实输入、资源及租约后决定。不能根据相同环境名称或命令字符串推断复用。

资源 Gate 的已有 Environment、Provisioner、Runtime Cell、临时 capability 和
输入资格要求同样显示在准备结果中。它们不能被代码引用存在这一观察代替。
单个 Journey 也执行该检查；多 Scenario 的真实资源复用仍遵守
`RuntimeReuseContract` 和 `SuiteRuntimeLedger`，不创建第二个生命周期账本。

## 范围、失效与失败

执行上限是明确选择的 Gate 与 Catalog 已声明的必要依赖闭包。影响扫描和缺口报告
只提供候选，不派发其他 Gate，不转成 completion、full 或全模块验收。
引用其他模块的一项实现不等于执行该模块的 Gate。

准备结果绑定源码、Catalog、Gate 选择、依赖及验证模式。输入变化须重新解析；
结果不得跨源码继承 PASS。已经失效的实现、构建、环境、Fixture 或会话由各自
owner 更新，未受影响资源可在已有生命周期内复用。

缺口在原 owner 增强后回到同一入口。临时诊断只能取证；不得长期替代正式实现。
新增 Gate 超过原选择或依赖闭包属于范围变化，不自动执行。
首次超时或准备失败停止下游，保留阶段、owner 和日志；修复后重跑受影响部分。
不扩大预算以制造通过，清理与报告仍使用原有保留时间。

## 验证标准

- 无 IDE Hook、无历史上下文的独立进程执行明确 E2E，仍经过准备 Hook。
- 普通启动和源码 Gate 不被误判为 E2E。
- 预览无网络、安装、进程启动、Fixture 或 Evidence Store 分配。
- 准备事件先于第一次资源操作；缺失、循环、跨范围和源码失效阻止该 Gate 派发。
- Development、正式模式和独立 Gate 对同一合同的解析一致。
- 增强原 owner 后再次运行可完成，不重复生成登录或输入脚本。
- 合并共享依赖只执行一次；准备失败和重跑不派发无关 Gate。
- 框架合成案例仅证明流程合同，产品 Gate 仍需当前源码的真实 UI 与接收端证据。
