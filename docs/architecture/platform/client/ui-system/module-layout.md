# Peers UI — Module Layout

> **Status**: active
> **Created**: 2026-10-28 | **Updated**: 2026-10-29
> **Owner**: Client Platform / UI System
> **Target Design**: draft — 沿现有模块扩展，不新增平行设计框架

```text
packages/ui/
  contracts/  纯语义类型、Definition/Composition/Resolution形状、唯一有限目录
  tokens/     数值与 CSS 变量派生
  assets/     图标与品牌来源登记
  semantics/  瞬时交互算法与组合闭包纯解析（解析部分proposed）
  web/        React/DOM renderer、slot binding、平台recipe、事件与样式
packages/prototypes/shared/ui-system/ 既有 Portal 内的可运行设计表达
docs/client/common/ui-identity/       基础含义、Grammar与平台共用政策
docs/architecture/platform/client/ui-system/ 架构、能力规范与集成
tooling/scripts/experience-design/   既有 EDX 校验、推理和评审入口
```

## 源与派生

设计架构与决策在本目录；基础和Grammar含义在UI Identity；
能力目录JSON是唯一索引真源；tokens/assets保存数值和资源；
renderer落实合同；Gallery保存样本源码；EDX/Quality持外部证据与评审。
文档通过引用连接，不互相复制规则、状态schema或检查流程。

Definition 的槽位与合法空间仍由既有能力规范/目录表达；
Composition 来自实际组件调用数据，Resolution 是派生结果，三者形状进入contracts。
有限纯解析进入semantics，平台recipe与UI组合renderer进入web。
业务Pattern和Page在原业务模块消费这些合同，
不为每个控件、槽位、规则、状态或设计阶段新增一个包。

整体体验输入继续在Product/EDX；使用决策引用原Experience Case/trace，
usage policy归能力规范，Pattern归原共享/业务Pattern Owner；
designBasis只是上述合同的引用视图。整体制作沿Development Workflow，
不在UI包中增加Product Intent、Designer Session、事件或证据Store。

## 依赖

web依赖contracts/tokens/assets/semantics及已登记底层engine；
semantics只依赖纯合同与注入的定义/绑定/投影，不直接读取token文件或业务Store；
contracts/tokens/assets不依赖web、原型、业务或平台宿主。
原型和生产消费者只能向公共UI入口依赖，不能让共享UI反向导入原型。
平台资源/环境port由已有平台Owner注入，UI不建立network/runtime服务。

## 边界内的状态与扩展

纯解析不维护状态、不执行命令、不移动焦点、不测量DOM；
局部瞬时状态仍由现有交互算法拥有，DOM效果和卸载由web/OverlayHost管理。
公共语义槽位接收可辨识能力绑定；不让任意ReactNode成为未声明的交互插件。
跨Surface完整性与证据归EDX；不在UI中新增全局注册Store或第二套Case模型。

新Pattern留在原业务Owner；新变体扩展原Definition；新平台绑定进入对应renderer；
只有新的共用语义才修订原Grammar。构图、图标和材质的合法层次由相应合同表达，
不按DOM深度划分包或新增“一层一组件”的包装链。

架构与Grammar的新提案先在原规范Owner审定，再修改派生类型、renderer、
sample和验证绑定。本轮没有创建新目录层、公共API或兼容转发。
