# Applet 独立架构设计文档

## 架构概述
我们采用了完全独立的Applet架构，Applet和主程序完全解耦，支持独立开发、独立构建、独立分发，同时保持跨端一致性。

## 目录结构

### 整体结构
```
peers-touch/
├── packages/
│   ├── applet-sdk/          # Applet标准开发SDK（所有Applet都依赖这个SDK）
│   └── applets/             # 所有Applet的根目录
│       ├── agent-pilot/     # 单个Applet（独立项目）
│       ├── remote-cli/      # 单个Applet（独立项目）
│       ├── web-search/      # 单个Applet（独立项目）
│       ├── shared/          # Applet共享库（可选）
│       ├── build.js         # 统一构建脚本
│       ├── dev-sync.js      # 开发时热更新同步脚本
│       └── package.json
├── apps/
│   ├── desktop/
│   │   ├── src/
│   │   │   └── applet/       # 仅包含Applet运行时框架，不包含任何具体Applet代码
│   │   └── applets-dist/     # Applet构建产物目录（Git忽略，构建时自动生成）
│   ├── mobile/
│   │   └── applets-dist/     # 移动端Applet加载目录
│   └── station/
```

### Applet 独立项目结构
每个Applet都是完全独立的项目，有自己的依赖、构建配置、版本管理：
```
applets/agent-pilot/
├── src/                    # Applet源码
├── index.html              # 入口HTML
├── package.json            # 独立依赖配置
├── vite.config.ts          # 独立构建配置
├── tsconfig.json           # 独立TS配置
└── applet.json             # Applet清单配置
```

## 核心设计原则

### 1. 完全解耦
- Applet和主程序没有任何代码依赖
- Applet之间也互相独立，没有依赖
- 只通过标准API契约通信

### 2. 面向分发
- 开发模式和分发模式完全一致
- 未来Applet可以独立发布到应用市场，用户下载后自动安装到applets-dist目录
- 支持Applet独立更新，不需要升级主程序

### 3. 跨端一致性
- 一套Applet代码可以同时运行在桌面端、移动端
- 标准API由各端原生实现，Applet不需要关心平台差异
- 统一的构建工具链，一次构建多端分发

## 开发流程

### 1. 开发Applet
```bash
# 进入具体Applet目录
cd packages/applets/agent-pilot

# 安装依赖
pnpm install

# 独立开发模式（浏览器中开发）
pnpm dev
```

### 2. 构建并同步到主程序
```bash
# 方式1：构建所有Applet并同步到各端加载目录
pnpm applets:build

# 方式2：开发模式，修改代码自动构建同步
pnpm applets:dev
```

### 3. 主程序加载Applet
主程序启动时自动扫描applets-dist目录，加载所有可用Applet，支持：
- 动态扫描发现Applet
- 权限校验
- 沙箱隔离运行
- 生命周期管理

## 核心组件

### Applet SDK
提供标准API接口，所有Applet都通过这个SDK调用主程序能力：
- 系统信息API
- 存储API
- 网络API
- 通知API
- 设备API
- UI组件API

### Applet运行时（主程序端）
- **AppletManager**：负责Applet的扫描、加载、卸载、生命周期管理
- **LynxContainer**：Applet渲染容器，支持iframe和Lynx引擎两种模式
- **JSAPI Bridge**：实现Applet SDK调用到原生能力的映射
- **安全沙箱**：权限控制、资源隔离、API调用审计

## 安全机制

### 1. 权限控制
- 每个Applet在applet.json中声明需要的权限
- 主程序在加载时校验权限
- 敏感API调用需要用户授权

### 2. 隔离机制
- 每个Applet运行在独立的沙箱中
- 存储隔离：每个Applet有独立的存储空间，互相不能访问
- 网络隔离：网络请求经过主程序代理，可以审计和过滤

### 3. 安全校验
- Applet包签名校验，防止篡改
- 恶意代码检测
- API调用频率限制

## 性能优化

### 1. 构建优化
- 按需构建，只构建修改过的Applet
- 公共依赖分包，减少重复加载
- 资源预加载和缓存策略

### 2. 运行时优化
- Applet实例池，减少重复创建开销
- 内存自动回收，长时间不使用的Applet自动卸载
- 渲染性能优化，和原生体验一致

## 未来扩展

### 1. 多端支持
- 后续将支持Android、iOS、HarmonyOS等移动端
- 各端只需要实现对应的JSAPI和渲染容器，Applet代码不需要修改

### 2. 生态建设
- Applet应用市场
- 第三方开发者接入
- Applet审核和分发机制
- 支付和变现体系

### 3. 能力开放
- 更多开放API
- AI能力开放
- 硬件能力开放
- 社交关系链开放
